import torch
import torch.nn as nn
import torch.nn.functional as F

class GraphDiffusion(nn.Module):
    def __init__(self, in_features: int, out_features: int, diffusion_steps: int = 1):
        super().__init__()
        self.diffusion_steps = diffusion_steps
        self.fc = nn.Linear(in_features * (diffusion_steps + 1), out_features)

    def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
        # x: [B, F, N, C]
        # adj: [N, N]
        supports = [x]
        
        # We need adj to be sparse or dense, assuming dense here as it's small (743x743)
        # Compute D^{-1} * A
        # adj is already row-normalized in our build_d03_graph.py
        
        curr_x = x
        for _ in range(self.diffusion_steps):
            # [B, F, N, C] x [N, N] -> [B, F, N, N] @ [B, F, N, C] - no wait, better to:
            # einsum format: nm, b f m c -> b f n c
            curr_x = torch.einsum("nm,bfmc->bfnc", adj, curr_x)
            supports.append(curr_x)
            
        out = torch.cat(supports, dim=-1) # [B, F, N, C * (steps+1)]
        return self.fc(out)

class FiLMGenerator(nn.Module):
    def __init__(self, context_dim: int, num_features: int):
        super().__init__()
        self.fc1 = nn.Linear(context_dim, num_features)
        self.fc2 = nn.Linear(num_features, num_features * 2)
        
    def forward(self, context: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # context: [B, F, context_dim]
        hidden = F.relu(self.fc1(context))
        params = self.fc2(hidden)
        # params: [B, F, features * 2]
        gamma, beta = params.chunk(2, dim=-1)
        # return gamma, beta: [B, F, features]
        return gamma.unsqueeze(2), beta.unsqueeze(2) # [B, F, 1, features] for broadcasting over N

class WeatherCorrectionNet(nn.Module):
    def __init__(
        self,
        weather_dim: int,
        accident_dim: int,
        static_dim: int,
        hidden_dim: int = 64,
        out_dim: int = 3, # flow, occupancy, speed
        diffusion_steps: int = 1
    ):
        super().__init__()
        
        # Weather branch (Context Generator)
        self.film_gen = FiLMGenerator(context_dim=weather_dim, num_features=hidden_dim)
        
        # Accident branch
        self.acc_proj = nn.Linear(accident_dim, hidden_dim)
        self.acc_diffusion = GraphDiffusion(hidden_dim, hidden_dim, diffusion_steps=diffusion_steps)
        
        # Static branch
        self.static_proj = nn.Linear(static_dim, hidden_dim)
        
        # Fusion Head
        self.fc1 = nn.Linear(hidden_dim, hidden_dim)
        self.out_proj = nn.Linear(hidden_dim, out_dim)
        
        self.drop = nn.Dropout(0.1)

    def forward(
        self, 
        weather_features: torch.Tensor, 
        accident_features: torch.Tensor, 
        static_features: torch.Tensor, 
        adj_mx: torch.Tensor
    ) -> torch.Tensor:
        """
        weather_features: [B, F, W]
        accident_features: [B, F, N, A]
        static_features: [N, S]
        adj_mx: [N, N]
        
        Returns:
        delta_pred: [B, F, N, 3]
        """
        # 1. Process Accident Features
        # [B, F, N, A] -> [B, F, N, hidden]
        acc_emb = F.relu(self.acc_proj(accident_features))
        # Structure propagation: [B, F, N, hidden] -> [B, F, N, hidden]
        acc_emb = F.relu(self.acc_diffusion(acc_emb, adj_mx))
        
        # 2. Process Static Features
        # [N, S] -> [N, hidden] -> [1, 1, N, hidden] -> broadcast
        stat_emb = F.relu(self.static_proj(static_features))
        stat_emb = stat_emb.unsqueeze(0).unsqueeze(0)
        
        # Combine Accident and Static
        combined = acc_emb + stat_emb # [B, F, N, hidden]
        
        # 3. FiLM Modulation from Weather
        # weather_features: [B, F, W] -> gamma, beta: [B, F, 1, hidden]
        gamma, beta = self.film_gen(weather_features)
        
        # Modulate
        modulated = gamma * combined + beta
        
        # 4. Output Projection
        hidden = F.relu(self.fc1(modulated))
        hidden = self.drop(hidden)
        out = self.out_proj(hidden) # [B, F, N, 3]
        
        return out
