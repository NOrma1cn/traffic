from __future__ import annotations

import math

import torch
from torch import nn


def _reshape_output(out: torch.Tensor, out_horizon: int, out_dim: int) -> torch.Tensor:
    out = out.view(out.shape[0], out.shape[1], out_horizon, out_dim)  # [B,N,H,C]
    if out_dim == 1 and out_horizon == 1:
        return out.squeeze(-1).squeeze(-1)  # [B,N]
    if out_dim == 1:
        return out.squeeze(-1)  # [B,N,H]
    if out_horizon == 1:
        return out.squeeze(-2)  # [B,N,C]
    return out


class GCNLayer(nn.Module):
    def __init__(self, in_dim: int, out_dim: int, dropout: float) -> None:
        super().__init__()
        self.lin = nn.Linear(in_dim, out_dim)
        self.act = nn.ReLU()
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor, a_norm: torch.Tensor) -> torch.Tensor:
        # x: [B,T,N,F]
        x = self.lin(x)
        x = torch.einsum("nm,btmf->btnf", a_norm, x)
        x = self.act(x)
        x = self.drop(x)
        return x


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 512) -> None:
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(1), persistent=False)  # [T,1,D]

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [T,B,D]
        t = x.shape[0]
        return x + self.pe[:t]


class ContextGatedDiffusionBlock(nn.Module):
    def __init__(
        self,
        *,
        hidden_dim: int,
        context_dim: int,
        diffusion_steps: int,
        adaptive_rank: int,
        num_nodes: int,
        dropout: float,
    ) -> None:
        super().__init__()
        self.hidden_dim = int(hidden_dim)
        self.diffusion_steps = int(diffusion_steps)
        self.num_nodes = int(num_nodes)
        if self.hidden_dim < 1:
            raise ValueError("hidden_dim must be >= 1")
        if self.diffusion_steps < 1:
            raise ValueError("diffusion_steps must be >= 1")
        if adaptive_rank < 1:
            raise ValueError("adaptive_rank must be >= 1")

        self.self_lin = nn.Linear(hidden_dim, hidden_dim)
        self.fwd_lins = nn.ModuleList([nn.Linear(hidden_dim, hidden_dim) for _ in range(self.diffusion_steps)])
        self.bwd_lins = nn.ModuleList([nn.Linear(hidden_dim, hidden_dim) for _ in range(self.diffusion_steps)])
        self.adaptive_lins = nn.ModuleList([nn.Linear(hidden_dim, hidden_dim) for _ in range(self.diffusion_steps)])
        self.context_gate = nn.Sequential(
            nn.Linear(context_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, 4),
        )
        self.context_scale = nn.Sequential(
            nn.Linear(context_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim),
        )
        self.src_gate = nn.Linear(context_dim, 1)
        self.dst_gate = nn.Linear(context_dim, 1)
        self.node_emb_src = nn.Parameter(torch.randn(num_nodes, adaptive_rank) * 0.02)
        self.node_emb_dst = nn.Parameter(torch.randn(num_nodes, adaptive_rank) * 0.02)
        self.norm = nn.LayerNorm(hidden_dim)
        self.act = nn.GELU()
        self.drop = nn.Dropout(dropout)

    def _adaptive_adj(self, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
        scores = torch.relu(self.node_emb_src @ self.node_emb_dst.transpose(0, 1))
        adj = torch.softmax(scores, dim=-1)
        return adj.to(device=device, dtype=dtype)

    def _propagate(self, adj: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
        return torch.einsum("nm,btmf->btnf", adj, x)

    def forward(self, x: torch.Tensor, a_fwd: torch.Tensor, context: torch.Tensor) -> torch.Tensor:
        # x/context: [B,T,N,F]
        if x.shape[:3] != context.shape[:3]:
            raise ValueError("x and context must align on batch/time/node dims")
        a_fwd = a_fwd.to(device=x.device, dtype=x.dtype)
        a_bwd = a_fwd.transpose(0, 1).contiguous()
        a_adp = self._adaptive_adj(x.device, x.dtype)

        gates = torch.sigmoid(self.context_gate(context))  # [B,T,N,4]
        scale = torch.sigmoid(self.context_scale(context))
        src_gate = torch.sigmoid(self.src_gate(context))
        dst_gate = torch.sigmoid(self.dst_gate(context))

        self_term = self.self_lin(x)

        fwd_term = torch.zeros_like(self_term)
        fwd_state = x * dst_gate
        for step in range(self.diffusion_steps):
            fwd_state = self._propagate(a_fwd, fwd_state)
            fwd_term = fwd_term + self.fwd_lins[step](fwd_state)

        bwd_term = torch.zeros_like(self_term)
        bwd_state = x * src_gate
        for step in range(self.diffusion_steps):
            bwd_state = self._propagate(a_bwd, bwd_state)
            bwd_term = bwd_term + self.bwd_lins[step](bwd_state)

        adaptive_term = torch.zeros_like(self_term)
        adaptive_state = x
        for step in range(self.diffusion_steps):
            adaptive_state = self._propagate(a_adp, adaptive_state)
            adaptive_term = adaptive_term + self.adaptive_lins[step](adaptive_state)

        mixed = (
            gates[..., 0:1] * self_term
            + gates[..., 1:2] * fwd_term
            + gates[..., 2:3] * bwd_term
            + gates[..., 3:4] * adaptive_term
        )
        mixed = mixed * scale
        return self.norm(x + self.drop(self.act(mixed)))


class GCNTransformerEarlyWarning(nn.Module):
    def __init__(
        self,
        *,
        num_nodes: int,
        in_feat: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
    ) -> None:
        super().__init__()
        self.num_nodes = num_nodes
        self.out_horizon = int(out_horizon)
        if self.out_horizon < 1:
            raise ValueError("out_horizon must be >= 1")
        self.out_dim = int(out_dim)
        if self.out_dim < 1:
            raise ValueError("out_dim must be >= 1")
        self.in_proj = nn.Linear(in_feat, gcn_hidden)

        gcn = []
        for _ in range(gcn_layers):
            gcn.append(GCNLayer(gcn_hidden, gcn_hidden, dropout=dropout))
        self.gcn = nn.ModuleList(gcn)

        self.to_model = nn.Linear(gcn_hidden, d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.tf = nn.TransformerEncoder(enc_layer, num_layers=tf_layers)
        self.out = nn.Linear(d_model, self.out_horizon * self.out_dim)

    def forward(self, x: torch.Tensor, a_norm: torch.Tensor, *_) -> torch.Tensor:
        # x: [B,T,N,F]
        b, t, n, _ = x.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")

        h = self.in_proj(x)
        for layer in self.gcn:
            h = layer(h, a_norm)
        h = self.to_model(h)  # [B,T,N,D]

        # temporal transformer per node: [T, B*N, D]
        h = h.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        h = self.pos(h)
        h = self.tf(h)
        last = h[-1]  # [B*N, D]
        last = last.view(b, n, -1)
        out = self.out(last)  # [B,N,H*out_dim]
        return _reshape_output(out, self.out_horizon, self.out_dim)


class GCNTransformerWeatherCrossAttention(nn.Module):
    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_in_feat: int,
        exo_feat: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
    ) -> None:
        super().__init__()
        self.num_nodes = num_nodes
        self.out_horizon = int(out_horizon)
        self.out_dim = int(out_dim)
        if self.out_horizon < 1:
            raise ValueError("out_horizon must be >= 1")
        if self.out_dim < 1:
            raise ValueError("out_dim must be >= 1")

        self.traffic_proj = nn.Linear(traffic_in_feat, gcn_hidden)
        self.gcn = nn.ModuleList(
            [GCNLayer(gcn_hidden, gcn_hidden, dropout=dropout) for _ in range(gcn_layers)]
        )
        self.to_model = nn.Linear(gcn_hidden, d_model)
        self.exo_proj = nn.Linear(exo_feat, d_model)
        self.pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.cross_norm = nn.LayerNorm(d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.tf = nn.TransformerEncoder(enc_layer, num_layers=tf_layers)
        self.out = nn.Linear(d_model, self.out_horizon * self.out_dim)

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # x_traffic: [B,T,N,Ft], x_exo: [B,T,Fe]
        b, t, n, _ = x_traffic.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")
        if x_exo.shape[:2] != (b, t):
            raise ValueError("x_exo must align with batch/time dims of x_traffic")

        h = self.traffic_proj(x_traffic)
        for layer in self.gcn:
            h = layer(h, a_norm)
        h = self.to_model(h)  # [B,T,N,D]

        q = h.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)  # [T,B*N,D]
        q = self.pos(q)

        exo = self.exo_proj(x_exo)  # [B,T,D]
        kv = exo.unsqueeze(2).expand(-1, -1, n, -1)  # [B,T,N,D]
        kv = kv.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)  # [T,B*N,D]
        kv = self.pos(kv)

        attn_out, _ = self.cross_attn(q, kv, kv, need_weights=False)
        h = self.cross_norm(q + attn_out)
        h = self.tf(h)
        last = h[-1].view(b, n, -1)
        out = self.out(last)
        return _reshape_output(out, self.out_horizon, self.out_dim)


class HeteroGraphFusionForecaster(nn.Module):
    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_feat_dim: int,
        accident_feat_dim: int,
        exo_feat: int,
        static_feat_dim: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
    ) -> None:
        super().__init__()
        self.num_nodes = int(num_nodes)
        self.traffic_feat_dim = int(traffic_feat_dim)
        self.accident_feat_dim = int(accident_feat_dim)
        self.static_feat_dim = int(static_feat_dim)
        self.out_horizon = int(out_horizon)
        self.out_dim = int(out_dim)
        if self.traffic_feat_dim < 1:
            raise ValueError("traffic_feat_dim must be >= 1")
        if self.accident_feat_dim < 0:
            raise ValueError("accident_feat_dim must be >= 0")
        if self.static_feat_dim < 0:
            raise ValueError("static_feat_dim must be >= 0")
        if self.out_horizon < 1:
            raise ValueError("out_horizon must be >= 1")
        if self.out_dim < 1:
            raise ValueError("out_dim must be >= 1")

        self.traffic_proj = nn.Linear(self.traffic_feat_dim, gcn_hidden)
        self.gcn = nn.ModuleList(
            [GCNLayer(gcn_hidden, gcn_hidden, dropout=dropout) for _ in range(gcn_layers)]
        )
        self.traffic_to_model = nn.Linear(gcn_hidden, d_model)
        self.latest_traffic_proj = nn.Linear(self.traffic_feat_dim, d_model)

        if self.accident_feat_dim > 0:
            self.accident_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.accident_gate = nn.Linear(self.accident_feat_dim, d_model)
        else:
            self.accident_proj = None
            self.accident_gate = None

        self.exo_proj = nn.Sequential(
            nn.Linear(exo_feat, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        self.exo_gate = nn.Linear(exo_feat, d_model)

        if self.static_feat_dim > 0:
            self.static_proj = nn.Sequential(
                nn.Linear(self.static_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.static_gate = nn.Linear(self.static_feat_dim, d_model)
        else:
            self.static_proj = None
            self.static_gate = None

        self.fusion_norm = nn.LayerNorm(d_model)
        self.pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.cross_norm = nn.LayerNorm(d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.tf = nn.TransformerEncoder(enc_layer, num_layers=tf_layers)
        self.out = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_horizon * self.out_dim),
        )

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # x_traffic: [B,T,N,F], x_exo: [B,T,Fe], x_static: [N,Fs]
        b, t, n, f = x_traffic.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")
        if x_exo.shape[:2] != (b, t):
            raise ValueError("x_exo must align with batch/time dims of x_traffic")
        min_feat = self.traffic_feat_dim + self.accident_feat_dim
        if f < min_feat:
            raise ValueError(f"x_traffic feature dim {f} is smaller than required {min_feat}")

        traffic_core = x_traffic[..., : self.traffic_feat_dim]
        h = self.traffic_proj(traffic_core)
        for layer in self.gcn:
            h = layer(h, a_norm)
        fused = self.traffic_to_model(h)  # [B,T,N,D]

        if self.accident_feat_dim > 0 and self.accident_proj is not None and self.accident_gate is not None:
            acc = x_traffic[..., self.traffic_feat_dim : self.traffic_feat_dim + self.accident_feat_dim]
            acc_val = self.accident_proj(acc)
            acc_gate = torch.sigmoid(self.accident_gate(acc))
            fused = fused + acc_gate * acc_val

        exo_base = self.exo_proj(x_exo)  # [B,T,D]
        exo_gate = torch.sigmoid(self.exo_gate(x_exo))
        exo_ctx = (exo_gate * exo_base).unsqueeze(2).expand(-1, -1, n, -1)
        fused = fused + exo_ctx

        if self.static_feat_dim > 0 and self.static_proj is not None and self.static_gate is not None:
            if x_static is None:
                raise ValueError("x_static is required when static_feat_dim > 0")
            if x_static.shape != (n, self.static_feat_dim):
                raise ValueError(
                    f"x_static must have shape ({n}, {self.static_feat_dim}), got {tuple(x_static.shape)}"
                )
            static_val = self.static_proj(x_static)
            static_gate = torch.sigmoid(self.static_gate(x_static))
            static_ctx = (static_gate * static_val).unsqueeze(0).unsqueeze(0)
            fused = fused + static_ctx

        fused = self.fusion_norm(fused)
        q = fused.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        q = self.pos(q)

        kv = exo_base.unsqueeze(2).expand(-1, -1, n, -1)
        kv = kv.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        kv = self.pos(kv)

        attn_out, _ = self.cross_attn(q, kv, kv, need_weights=False)
        h = self.cross_norm(q + attn_out)
        h = self.tf(h)
        last = h[-1].view(b, n, -1)
        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1])
        out = self.out(torch.cat([last, latest_traffic], dim=-1))
        return _reshape_output(out, self.out_horizon, self.out_dim)


class HeteroDiffusionGraphForecaster(nn.Module):
    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_feat_dim: int,
        accident_feat_dim: int,
        exo_feat: int,
        static_feat_dim: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
        diffusion_steps: int = 2,
        adaptive_rank: int = 16,
    ) -> None:
        super().__init__()
        self.num_nodes = int(num_nodes)
        self.traffic_feat_dim = int(traffic_feat_dim)
        self.accident_feat_dim = int(accident_feat_dim)
        self.static_feat_dim = int(static_feat_dim)
        self.out_horizon = int(out_horizon)
        self.out_dim = int(out_dim)
        self.diffusion_steps = int(diffusion_steps)
        self.adaptive_rank = int(adaptive_rank)
        if self.traffic_feat_dim < 1:
            raise ValueError("traffic_feat_dim must be >= 1")
        if self.accident_feat_dim < 0:
            raise ValueError("accident_feat_dim must be >= 0")
        if self.static_feat_dim < 0:
            raise ValueError("static_feat_dim must be >= 0")
        if self.out_horizon < 1:
            raise ValueError("out_horizon must be >= 1")
        if self.out_dim < 1:
            raise ValueError("out_dim must be >= 1")

        self.traffic_proj = nn.Linear(self.traffic_feat_dim, gcn_hidden)
        self.exo_proj = nn.Sequential(
            nn.Linear(exo_feat, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        self.exo_gate = nn.Linear(exo_feat, d_model)
        self.context_to_hidden = nn.Linear(d_model, gcn_hidden)

        if self.accident_feat_dim > 0:
            self.accident_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.accident_proj = None

        if self.static_feat_dim > 0:
            self.static_proj = nn.Sequential(
                nn.Linear(self.static_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.static_proj = None

        self.diffusion_blocks = nn.ModuleList(
            [
                ContextGatedDiffusionBlock(
                    hidden_dim=gcn_hidden,
                    context_dim=d_model,
                    diffusion_steps=self.diffusion_steps,
                    adaptive_rank=self.adaptive_rank,
                    num_nodes=self.num_nodes,
                    dropout=dropout,
                )
                for _ in range(gcn_layers)
            ]
        )
        self.traffic_to_model = nn.Linear(gcn_hidden, d_model)
        self.latest_traffic_proj = nn.Linear(self.traffic_feat_dim, d_model)
        self.pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.cross_norm = nn.LayerNorm(d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.tf = nn.TransformerEncoder(enc_layer, num_layers=tf_layers)
        self.out = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_horizon * self.out_dim),
        )

    def _build_context(
        self,
        x_traffic: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        b, t, n, _ = x_traffic.shape
        exo_base = self.exo_proj(x_exo)
        exo_gate = torch.sigmoid(self.exo_gate(x_exo))
        context = (exo_base * exo_gate).unsqueeze(2).expand(-1, -1, n, -1)

        if self.accident_feat_dim > 0 and self.accident_proj is not None:
            acc = x_traffic[..., self.traffic_feat_dim : self.traffic_feat_dim + self.accident_feat_dim]
            context = context + self.accident_proj(acc)

        if self.static_feat_dim > 0 and self.static_proj is not None:
            if x_static is None:
                raise ValueError("x_static is required when static_feat_dim > 0")
            if x_static.shape != (n, self.static_feat_dim):
                raise ValueError(
                    f"x_static must have shape ({n}, {self.static_feat_dim}), got {tuple(x_static.shape)}"
                )
            static_ctx = self.static_proj(x_static).unsqueeze(0).unsqueeze(0)
            context = context + static_ctx
        return context, exo_base

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # x_traffic: [B,T,N,F], x_exo: [B,T,E], x_static: [N,Fs]
        b, t, n, f = x_traffic.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")
        if x_exo.shape[:2] != (b, t):
            raise ValueError("x_exo must align with batch/time dims of x_traffic")
        min_feat = self.traffic_feat_dim + self.accident_feat_dim
        if f < min_feat:
            raise ValueError(f"x_traffic feature dim {f} is smaller than required {min_feat}")

        traffic_core = x_traffic[..., : self.traffic_feat_dim]
        context, exo_base = self._build_context(x_traffic, x_exo, x_static)

        h = self.traffic_proj(traffic_core) + self.context_to_hidden(context)
        for block in self.diffusion_blocks:
            h = block(h, a_norm, context)
        h = self.traffic_to_model(h)

        q = h.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        q = self.pos(q)
        kv = exo_base.unsqueeze(2).expand(-1, -1, n, -1)
        kv = kv.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        kv = self.pos(kv)

        attn_out, _ = self.cross_attn(q, kv, kv, need_weights=False)
        h = self.cross_norm(q + attn_out)
        h = self.tf(h)
        last = h[-1].view(b, n, -1)
        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1])
        out = self.out(torch.cat([last, latest_traffic], dim=-1))
        return _reshape_output(out, self.out_horizon, self.out_dim)


class ScenarioConditionedDiffusionForecaster(nn.Module):
    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_feat_dim: int,
        accident_feat_dim: int,
        exo_feat: int,
        static_feat_dim: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
        diffusion_steps: int = 2,
        adaptive_rank: int = 16,
    ) -> None:
        super().__init__()
        self.num_nodes = int(num_nodes)
        self.traffic_feat_dim = int(traffic_feat_dim)
        self.accident_feat_dim = int(accident_feat_dim)
        self.static_feat_dim = int(static_feat_dim)
        self.out_horizon = int(out_horizon)
        self.out_dim = int(out_dim)
        self.diffusion_steps = int(diffusion_steps)
        self.adaptive_rank = int(adaptive_rank)
        if self.traffic_feat_dim < 1:
            raise ValueError("traffic_feat_dim must be >= 1")
        if self.accident_feat_dim < 0:
            raise ValueError("accident_feat_dim must be >= 0")
        if self.static_feat_dim < 0:
            raise ValueError("static_feat_dim must be >= 0")
        if self.out_horizon < 1:
            raise ValueError("out_horizon must be >= 1")
        if self.out_dim < 1:
            raise ValueError("out_dim must be >= 1")

        self.traffic_proj = nn.Linear(self.traffic_feat_dim, gcn_hidden)
        self.hist_exo_proj = nn.Sequential(
            nn.Linear(exo_feat, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        self.hist_exo_gate = nn.Linear(exo_feat, d_model)
        self.future_exo_proj = nn.Sequential(
            nn.Linear(exo_feat, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        self.future_exo_gate = nn.Linear(exo_feat, d_model)
        self.context_to_hidden = nn.Linear(d_model, gcn_hidden)

        if self.accident_feat_dim > 0:
            self.hist_accident_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.future_accident_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.hist_accident_proj = None
            self.future_accident_proj = None

        if self.static_feat_dim > 0:
            self.static_proj = nn.Sequential(
                nn.Linear(self.static_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.static_proj = None

        self.diffusion_blocks = nn.ModuleList(
            [
                ContextGatedDiffusionBlock(
                    hidden_dim=gcn_hidden,
                    context_dim=d_model,
                    diffusion_steps=self.diffusion_steps,
                    adaptive_rank=self.adaptive_rank,
                    num_nodes=self.num_nodes,
                    dropout=dropout,
                )
                for _ in range(gcn_layers)
            ]
        )
        self.traffic_to_model = nn.Linear(gcn_hidden, d_model)
        self.latest_traffic_proj = nn.Linear(self.traffic_feat_dim, d_model)
        self.hist_pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.future_pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.future_cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.future_cross_norm = nn.LayerNorm(d_model)
        dec_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.future_decoder = nn.TransformerEncoder(dec_layer, num_layers=tf_layers)
        self.out = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_dim),
        )

    def _static_context(self, x_static: torch.Tensor | None, n: int) -> torch.Tensor | None:
        if self.static_feat_dim <= 0 or self.static_proj is None:
            return None
        if x_static is None:
            raise ValueError("x_static is required when static_feat_dim > 0")
        if x_static.shape != (n, self.static_feat_dim):
            raise ValueError(f"x_static must have shape ({n}, {self.static_feat_dim}), got {tuple(x_static.shape)}")
        return self.static_proj(x_static)

    def _history_context(
        self,
        x_traffic: torch.Tensor,
        x_exo: torch.Tensor,
        static_ctx: torch.Tensor | None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        b, t, n, _ = x_traffic.shape
        hist_exo = self.hist_exo_proj(x_exo)
        hist_exo = hist_exo * torch.sigmoid(self.hist_exo_gate(x_exo))
        context = hist_exo.unsqueeze(2).expand(-1, -1, n, -1)

        if self.accident_feat_dim > 0 and self.hist_accident_proj is not None:
            acc_hist = x_traffic[..., self.traffic_feat_dim : self.traffic_feat_dim + self.accident_feat_dim]
            context = context + self.hist_accident_proj(acc_hist)

        if static_ctx is not None:
            context = context + static_ctx.unsqueeze(0).unsqueeze(0)
        return context, hist_exo

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
        x_exo_future: torch.Tensor | None = None,
        x_acc_future: torch.Tensor | None = None,
    ) -> torch.Tensor:
        b, t, n, f = x_traffic.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")
        if x_exo.shape[:2] != (b, t):
            raise ValueError("x_exo must align with batch/time dims of x_traffic")
        min_feat = self.traffic_feat_dim + self.accident_feat_dim
        if f < min_feat:
            raise ValueError(f"x_traffic feature dim {f} is smaller than required {min_feat}")
        if x_exo_future is None:
            raise ValueError("x_exo_future is required for ScenarioConditionedDiffusionForecaster")
        if x_exo_future.shape[:2] != (b, self.out_horizon):
            raise ValueError(
                f"x_exo_future must have shape ({b}, {self.out_horizon}, E), got {tuple(x_exo_future.shape)}"
            )
        if self.accident_feat_dim > 0:
            if x_acc_future is None:
                raise ValueError("x_acc_future is required when accident_feat_dim > 0")
            if x_acc_future.shape[:4] != (b, self.out_horizon, n, self.accident_feat_dim):
                raise ValueError(
                    "x_acc_future must align with batch/horizon/node dims of the model"
                )

        traffic_core = x_traffic[..., : self.traffic_feat_dim]
        static_ctx = self._static_context(x_static, n)
        history_context, hist_exo = self._history_context(x_traffic, x_exo, static_ctx)

        h = self.traffic_proj(traffic_core) + self.context_to_hidden(history_context)
        for block in self.diffusion_blocks:
            h = block(h, a_norm, history_context)
        hist_encoded = self.traffic_to_model(h)  # [B,T,N,D]

        memory = hist_encoded.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        memory = self.hist_pos(memory)

        future_exo = self.future_exo_proj(x_exo_future)
        future_exo = future_exo * torch.sigmoid(self.future_exo_gate(x_exo_future))
        future_tokens = hist_encoded[:, -1:, :, :].expand(-1, self.out_horizon, -1, -1)
        future_tokens = future_tokens + future_exo.unsqueeze(2).expand(-1, -1, n, -1)

        if self.accident_feat_dim > 0 and self.future_accident_proj is not None and x_acc_future is not None:
            future_tokens = future_tokens + self.future_accident_proj(x_acc_future)

        if static_ctx is not None:
            future_tokens = future_tokens + static_ctx.unsqueeze(0).unsqueeze(1)

        query = future_tokens.permute(1, 0, 2, 3).contiguous().view(self.out_horizon, b * n, -1)
        query = self.future_pos(query)
        attn_out, _ = self.future_cross_attn(query, memory, memory, need_weights=False)
        decoded = self.future_cross_norm(query + attn_out)
        decoded = self.future_decoder(decoded)
        decoded = decoded.view(self.out_horizon, b, n, -1).permute(1, 2, 0, 3).contiguous()

        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1]).unsqueeze(2).expand(-1, -1, self.out_horizon, -1)
        out = self.out(torch.cat([decoded, latest_traffic], dim=-1))
        if self.out_horizon == 1:
            return out.squeeze(-2)
        return out


class JointCausalDiffusionForecaster(HeteroDiffusionGraphForecaster):
    """
    Shared historical encoder with:
    - a causal baseline head used in normal inference
    - an auxiliary future-conditioned scenario head used during training/demo simulation
    """

    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_feat_dim: int,
        accident_feat_dim: int,
        exo_feat: int,
        static_feat_dim: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
        diffusion_steps: int = 2,
        adaptive_rank: int = 16,
    ) -> None:
        super().__init__(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_feat_dim,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
        )
        self.future_exo_proj = nn.Sequential(
            nn.Linear(exo_feat, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model),
        )
        self.future_exo_gate = nn.Linear(exo_feat, d_model)
        if self.accident_feat_dim > 0:
            self.future_accident_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.future_accident_proj = None
        self.future_pos = PositionalEncoding(d_model=d_model, max_len=1024)
        self.future_cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.future_cross_norm = nn.LayerNorm(d_model)
        dec_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.future_decoder = nn.TransformerEncoder(dec_layer, num_layers=tf_layers)
        self.future_out = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_dim),
        )

    def _static_context(self, x_static: torch.Tensor | None, n: int) -> torch.Tensor | None:
        if self.static_feat_dim <= 0 or self.static_proj is None:
            return None
        if x_static is None:
            raise ValueError("x_static is required when static_feat_dim > 0")
        if x_static.shape != (n, self.static_feat_dim):
            raise ValueError(f"x_static must have shape ({n}, {self.static_feat_dim}), got {tuple(x_static.shape)}")
        return self.static_proj(x_static)

    def _encode_history(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor | None]:
        b, t, n, f = x_traffic.shape
        if n != self.num_nodes:
            raise ValueError(f"expected {self.num_nodes} nodes, got {n}")
        if x_exo.shape[:2] != (b, t):
            raise ValueError("x_exo must align with batch/time dims of x_traffic")
        min_feat = self.traffic_feat_dim + self.accident_feat_dim
        if f < min_feat:
            raise ValueError(f"x_traffic feature dim {f} is smaller than required {min_feat}")

        traffic_core = x_traffic[..., : self.traffic_feat_dim]
        context, exo_base = self._build_context(x_traffic, x_exo, x_static)
        h = self.traffic_proj(traffic_core) + self.context_to_hidden(context)
        for block in self.diffusion_blocks:
            h = block(h, a_norm, context)
        hist_encoded = self.traffic_to_model(h)
        static_ctx = self._static_context(x_static, n)
        return traffic_core, hist_encoded, exo_base, static_ctx

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> torch.Tensor:
        traffic_core, hist_encoded, exo_base, _ = self._encode_history(x_traffic, a_norm, x_exo, x_static)
        b, t, n, _ = hist_encoded.shape
        q = hist_encoded.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        q = self.pos(q)
        kv = exo_base.unsqueeze(2).expand(-1, -1, n, -1)
        kv = kv.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        kv = self.pos(kv)

        attn_out, _ = self.cross_attn(q, kv, kv, need_weights=False)
        h = self.cross_norm(q + attn_out)
        h = self.tf(h)
        last = h[-1].view(b, n, -1)
        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1])
        out = self.out(torch.cat([last, latest_traffic], dim=-1))
        return _reshape_output(out, self.out_horizon, self.out_dim)

    def forward_scenario(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
        x_exo_future: torch.Tensor | None = None,
        x_acc_future: torch.Tensor | None = None,
    ) -> torch.Tensor:
        if x_exo_future is None:
            raise ValueError("x_exo_future is required for scenario decoding")
        traffic_core, hist_encoded, _, static_ctx = self._encode_history(x_traffic, a_norm, x_exo, x_static)
        b, t, n, _ = hist_encoded.shape
        if x_exo_future.shape[:2] != (b, self.out_horizon):
            raise ValueError(
                f"x_exo_future must have shape ({b}, {self.out_horizon}, E), got {tuple(x_exo_future.shape)}"
            )
        if self.accident_feat_dim > 0:
            if x_acc_future is None:
                raise ValueError("x_acc_future is required when accident_feat_dim > 0")
            if x_acc_future.shape[:4] != (b, self.out_horizon, n, self.accident_feat_dim):
                raise ValueError("x_acc_future must align with batch/horizon/node dims of the model")

        memory = hist_encoded.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        memory = self.pos(memory)

        future_exo = self.future_exo_proj(x_exo_future)
        future_exo = future_exo * torch.sigmoid(self.future_exo_gate(x_exo_future))
        future_tokens = hist_encoded[:, -1:, :, :].expand(-1, self.out_horizon, -1, -1)
        future_tokens = future_tokens + future_exo.unsqueeze(2).expand(-1, -1, n, -1)

        if self.accident_feat_dim > 0 and self.future_accident_proj is not None and x_acc_future is not None:
            future_tokens = future_tokens + self.future_accident_proj(x_acc_future)

        if static_ctx is not None:
            future_tokens = future_tokens + static_ctx.unsqueeze(0).unsqueeze(1)

        query = future_tokens.permute(1, 0, 2, 3).contiguous().view(self.out_horizon, b * n, -1)
        query = self.future_pos(query)
        attn_out, _ = self.future_cross_attn(query, memory, memory, need_weights=False)
        decoded = self.future_cross_norm(query + attn_out)
        decoded = self.future_decoder(decoded)
        decoded = decoded.view(self.out_horizon, b, n, -1).permute(1, 2, 0, 3).contiguous()

        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1]).unsqueeze(2).expand(
            -1, -1, self.out_horizon, -1
        )
        out = self.future_out(torch.cat([decoded, latest_traffic], dim=-1))
        if self.out_horizon == 1:
            return out.squeeze(-2)
        return out


class ResidualJointCausalDiffusionForecaster(JointCausalDiffusionForecaster):
    """
    Decomposes prediction into:
    - base forecast: mostly traffic-history driven
    - residual forecast: weather/accident-driven correction

    Normal forward uses historical/current event context.
    forward_scenario uses hypothetical future weather/accident sequences to generate a scenario residual.
    """

    def __init__(
        self,
        *,
        num_nodes: int,
        traffic_feat_dim: int,
        accident_feat_dim: int,
        exo_feat: int,
        static_feat_dim: int,
        gcn_hidden: int,
        d_model: int,
        gcn_layers: int,
        nhead: int,
        tf_layers: int,
        dropout: float,
        out_horizon: int = 1,
        out_dim: int = 1,
        diffusion_steps: int = 2,
        adaptive_rank: int = 16,
        time_feat_dim: int = 4,
    ) -> None:
        super().__init__(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_feat_dim,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
        )
        self.time_feat_dim = int(max(0, min(time_feat_dim, exo_feat)))
        self.weather_feat_dim = int(max(0, exo_feat - self.time_feat_dim))

        if self.weather_feat_dim > 0:
            self.hist_weather_proj = nn.Sequential(
                nn.Linear(self.weather_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.hist_weather_gate = nn.Linear(self.weather_feat_dim, d_model)
            self.future_weather_proj = nn.Sequential(
                nn.Linear(self.weather_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.future_weather_gate = nn.Linear(self.weather_feat_dim, d_model)
        else:
            self.hist_weather_proj = None
            self.hist_weather_gate = None
            self.future_weather_proj = None
            self.future_weather_gate = None

        if self.accident_feat_dim > 0:
            self.hist_accident_residual_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
            self.future_accident_residual_proj = nn.Sequential(
                nn.Linear(self.accident_feat_dim, d_model),
                nn.GELU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
            )
        else:
            self.hist_accident_residual_proj = None
            self.future_accident_residual_proj = None

        self.residual_norm = nn.LayerNorm(d_model)
        res_enc = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.residual_tf = nn.TransformerEncoder(res_enc, num_layers=max(1, tf_layers))
        self.residual_out = nn.Sequential(
            nn.LayerNorm(3 * d_model),
            nn.Linear(3 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_horizon * self.out_dim),
        )
        self.residual_gate = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_horizon * self.out_dim),
        )

        dec_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=max(128, 4 * d_model),
            dropout=dropout,
            activation="gelu",
            batch_first=False,
            norm_first=True,
        )
        self.scenario_cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=nhead,
            dropout=dropout,
            batch_first=False,
        )
        self.scenario_cross_norm = nn.LayerNorm(d_model)
        self.scenario_decoder = nn.TransformerEncoder(dec_layer, num_layers=max(1, tf_layers))
        self.scenario_out = nn.Sequential(
            nn.LayerNorm(3 * d_model),
            nn.Linear(3 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_dim),
        )
        self.scenario_gate = nn.Sequential(
            nn.LayerNorm(2 * d_model),
            nn.Linear(2 * d_model, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, self.out_dim),
        )

    def _ensure_4d(self, out: torch.Tensor) -> torch.Tensor:
        if self.out_horizon == 1:
            return out.unsqueeze(-2)
        return out

    def _split_exo(self, x_exo: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        if self.weather_feat_dim <= 0:
            weather = x_exo[..., :0]
            time = x_exo
        else:
            weather = x_exo[..., : self.weather_feat_dim]
            time = x_exo[..., self.weather_feat_dim :]
        return weather, time

    def _base_inputs(self, x_traffic: torch.Tensor, x_exo: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x_traffic_base = x_traffic.clone()
        if self.accident_feat_dim > 0:
            x_traffic_base[..., self.traffic_feat_dim : self.traffic_feat_dim + self.accident_feat_dim] = 0.0
        x_exo_base = x_exo.clone()
        if self.weather_feat_dim > 0:
            x_exo_base[..., : self.weather_feat_dim] = 0.0
        return x_traffic_base, x_exo_base

    def _historical_event_context(
        self,
        x_traffic: torch.Tensor,
        x_exo: torch.Tensor,
        static_ctx: torch.Tensor | None,
    ) -> torch.Tensor:
        b, t, n, _ = x_traffic.shape
        ctx = torch.zeros((b, t, n, self.future_pos.pe.shape[-1]), device=x_traffic.device, dtype=x_traffic.dtype)
        weather_hist, _ = self._split_exo(x_exo)
        if self.weather_feat_dim > 0 and self.hist_weather_proj is not None and weather_hist.shape[-1] > 0:
            weather_val = self.hist_weather_proj(weather_hist)
            weather_val = weather_val * torch.sigmoid(self.hist_weather_gate(weather_hist))
            ctx = ctx + weather_val.unsqueeze(2).expand(-1, -1, n, -1)
        if self.accident_feat_dim > 0 and self.hist_accident_residual_proj is not None:
            acc_hist = x_traffic[..., self.traffic_feat_dim : self.traffic_feat_dim + self.accident_feat_dim]
            ctx = ctx + self.hist_accident_residual_proj(acc_hist)
        if static_ctx is not None:
            ctx = ctx + static_ctx.unsqueeze(0).unsqueeze(0)
        return ctx

    def _future_event_context(
        self,
        x_exo_future: torch.Tensor,
        x_acc_future: torch.Tensor | None,
        static_ctx: torch.Tensor | None,
        n: int,
    ) -> torch.Tensor:
        b, h, _ = x_exo_future.shape
        ctx = torch.zeros((b, h, n, self.future_pos.pe.shape[-1]), device=x_exo_future.device, dtype=x_exo_future.dtype)
        weather_fut, _ = self._split_exo(x_exo_future)
        if self.weather_feat_dim > 0 and self.future_weather_proj is not None and weather_fut.shape[-1] > 0:
            weather_val = self.future_weather_proj(weather_fut)
            weather_val = weather_val * torch.sigmoid(self.future_weather_gate(weather_fut))
            ctx = ctx + weather_val.unsqueeze(2).expand(-1, -1, n, -1)
        if self.accident_feat_dim > 0 and self.future_accident_residual_proj is not None and x_acc_future is not None:
            ctx = ctx + self.future_accident_residual_proj(x_acc_future)
        if static_ctx is not None:
            ctx = ctx + static_ctx.unsqueeze(0).unsqueeze(1)
        return ctx

    def _residual_from_history(
        self,
        *,
        traffic_core: torch.Tensor,
        hist_encoded: torch.Tensor,
        event_ctx: torch.Tensor,
    ) -> torch.Tensor:
        b, t, n, _ = hist_encoded.shape
        tokens = self.residual_norm(hist_encoded + event_ctx)
        seq = tokens.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        seq = self.pos(seq)
        seq = self.residual_tf(seq)
        last = seq[-1].view(b, n, -1)
        event_last = event_ctx[:, -1]
        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1])
        gate = torch.sigmoid(self.residual_gate(torch.cat([last, event_last], dim=-1)))
        gate = _reshape_output(gate, self.out_horizon, self.out_dim)
        residual = self.residual_out(torch.cat([last, event_last, latest_traffic], dim=-1))
        residual = _reshape_output(residual, self.out_horizon, self.out_dim)
        return self._ensure_4d(residual) * self._ensure_4d(gate)

    def forward_with_aux(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        x_traffic_base, x_exo_base = self._base_inputs(x_traffic, x_exo)
        base_out = super().forward(x_traffic_base, a_norm, x_exo_base, x_static)
        base4 = self._ensure_4d(base_out)
        traffic_core, hist_encoded, _, static_ctx = self._encode_history(x_traffic_base, a_norm, x_exo_base, x_static)
        event_ctx = self._historical_event_context(x_traffic, x_exo, static_ctx)
        residual4 = self._residual_from_history(
            traffic_core=traffic_core,
            hist_encoded=hist_encoded,
            event_ctx=event_ctx,
        )
        final4 = base4 + residual4
        final = final4.squeeze(-2) if self.out_horizon == 1 else final4
        aux = {
            "base": base4,
            "residual": residual4,
            "event_context": event_ctx,
        }
        return final, aux

    def forward(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
    ) -> torch.Tensor:
        out, _ = self.forward_with_aux(x_traffic, a_norm, x_exo, x_static)
        return out

    def forward_scenario(
        self,
        x_traffic: torch.Tensor,
        a_norm: torch.Tensor,
        x_exo: torch.Tensor,
        x_static: torch.Tensor | None = None,
        x_exo_future: torch.Tensor | None = None,
        x_acc_future: torch.Tensor | None = None,
    ) -> torch.Tensor:
        if x_exo_future is None:
            raise ValueError("x_exo_future is required for scenario decoding")
        x_traffic_base, x_exo_base = self._base_inputs(x_traffic, x_exo)
        base_out = super().forward(x_traffic_base, a_norm, x_exo_base, x_static)
        base4 = self._ensure_4d(base_out)

        traffic_core, hist_encoded, _, static_ctx = self._encode_history(x_traffic_base, a_norm, x_exo_base, x_static)
        b, t, n, _ = hist_encoded.shape
        if x_exo_future.shape[:2] != (b, self.out_horizon):
            raise ValueError(
                f"x_exo_future must have shape ({b}, {self.out_horizon}, E), got {tuple(x_exo_future.shape)}"
            )
        if self.accident_feat_dim > 0:
            if x_acc_future is None:
                raise ValueError("x_acc_future is required when accident_feat_dim > 0")
            if x_acc_future.shape[:4] != (b, self.out_horizon, n, self.accident_feat_dim):
                raise ValueError("x_acc_future must align with batch/horizon/node dims of the model")

        memory = hist_encoded.permute(1, 0, 2, 3).contiguous().view(t, b * n, -1)
        memory = self.pos(memory)
        future_ctx = self._future_event_context(x_exo_future, x_acc_future, static_ctx, n)
        query_tokens = hist_encoded[:, -1:, :, :].expand(-1, self.out_horizon, -1, -1) + future_ctx
        query = query_tokens.permute(1, 0, 2, 3).contiguous().view(self.out_horizon, b * n, -1)
        query = self.future_pos(query)
        attn_out, _ = self.scenario_cross_attn(query, memory, memory, need_weights=False)
        decoded = self.scenario_cross_norm(query + attn_out)
        decoded = self.scenario_decoder(decoded)
        decoded = decoded.view(self.out_horizon, b, n, -1).permute(1, 2, 0, 3).contiguous()

        latest_traffic = self.latest_traffic_proj(traffic_core[:, -1]).unsqueeze(2).expand(-1, -1, self.out_horizon, -1)
        future_event_last = future_ctx.permute(0, 2, 1, 3).contiguous()
        gate = torch.sigmoid(self.scenario_gate(torch.cat([decoded, future_event_last], dim=-1)))
        scenario_residual = self.scenario_out(torch.cat([decoded, future_event_last, latest_traffic], dim=-1))
        scenario_residual = self._ensure_4d(scenario_residual) * self._ensure_4d(gate)
        final4 = base4 + scenario_residual
        if self.out_horizon == 1:
            return final4.squeeze(-2)
        return final4


def create_model(
    *,
    model_type: str,
    num_nodes: int,
    traffic_in_feat: int,
    exo_feat: int,
    gcn_hidden: int,
    d_model: int,
    gcn_layers: int,
    nhead: int,
    tf_layers: int,
    dropout: float,
    out_horizon: int,
    out_dim: int,
    traffic_core_feat: int = 3,
    accident_feat_dim: int = 0,
    static_feat_dim: int = 0,
    diffusion_steps: int = 2,
    adaptive_rank: int = 16,
    time_feat_dim: int = 4,
) -> nn.Module:
    model_type = str(model_type)
    if model_type == "GCNTransformerWeatherCrossAttention":
        return GCNTransformerWeatherCrossAttention(
            num_nodes=num_nodes,
            traffic_in_feat=traffic_in_feat,
            exo_feat=exo_feat,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
        )
    if model_type == "HeteroGraphFusionForecaster":
        return HeteroGraphFusionForecaster(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_core_feat,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
        )
    if model_type == "HeteroDiffusionGraphForecaster":
        return HeteroDiffusionGraphForecaster(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_core_feat,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
        )
    if model_type == "ScenarioConditionedDiffusionForecaster":
        return ScenarioConditionedDiffusionForecaster(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_core_feat,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
        )
    if model_type == "JointCausalDiffusionForecaster":
        return JointCausalDiffusionForecaster(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_core_feat,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
        )
    if model_type == "ResidualJointCausalDiffusionForecaster":
        return ResidualJointCausalDiffusionForecaster(
            num_nodes=num_nodes,
            traffic_feat_dim=traffic_core_feat,
            accident_feat_dim=accident_feat_dim,
            exo_feat=exo_feat,
            static_feat_dim=static_feat_dim,
            gcn_hidden=gcn_hidden,
            d_model=d_model,
            gcn_layers=gcn_layers,
            nhead=nhead,
            tf_layers=tf_layers,
            dropout=dropout,
            out_horizon=out_horizon,
            out_dim=out_dim,
            diffusion_steps=diffusion_steps,
            adaptive_rank=adaptive_rank,
            time_feat_dim=time_feat_dim,
        )
    raise ValueError(f"unknown model_type: {model_type}")
