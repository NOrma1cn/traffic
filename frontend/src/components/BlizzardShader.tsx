import React, { useEffect, useRef } from 'react';

const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

#define iResolution u_resolution
#define iTime u_time

// --- Simplex & Cellular Noise Utilities by stegu ---

vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }

vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 permute(vec4 x) { return mod( (34.0 * x + 1.0) * x, 289.0); }

vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);		
}

float cellular2x2(vec2 P) {
    #define K 0.142857142857
    #define K2 0.0714285714285
    #define jitter 0.8
    vec2 Pi = mod(floor(P), 289.0);
    vec2 Pf = fract(P);
    vec4 Pfx = Pf.x + vec4(-0.5, -1.5, -0.5, -1.5);
    vec4 Pfy = Pf.y + vec4(-0.5, -0.5, -1.5, -1.5);
    vec4 p = permute(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));
    p = permute(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));
    vec4 ox = mod(p, 7.0)*K+K2;
    vec4 oy = mod(floor(p*K),7.0)*K+K2;
    vec4 dx = Pfx + jitter*ox;
    vec4 dy = Pfy + jitter*oy;
    vec4 d = dx * dx + dy * dy;
    d.xy = min(d.xy, d.zw);
    d.x = min(d.x, d.y);
    return d.x;
}

float fbm(vec2 p) {
    float f = 0.0;
    float w = 0.5;
    for (int i = 0; i < 5; i++) {
        f += w * snoise(p);
        p *= 2.0;
        w *= 0.5;
    }
    return f;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    float speed = 2.0;
    vec2 uv = fragCoord.xy / iResolution.xy;
    uv.x *= (iResolution.x / iResolution.y);
    
    // Sun logic
    vec2 suncent = vec2(0.3, 0.9);
    float suns = (1.0 - distance(uv, suncent));
    suns = clamp(0.2 + suns, 0.0, 1.0);
    float sunsh = smoothstep(0.85, 0.95, suns);

    // Ground/Slope logic
    float slope = 0.8 + uv.x - (uv.y * 2.3);
    slope = 1.0 - smoothstep(0.55, 0.0, slope);								
    
    float noise = abs(fbm(uv * 1.5));
    slope = (noise * 0.2) + (slope - ((1.0 - noise) * slope * 0.1)) * 0.6;
    slope = clamp(slope, 0.0, 1.0);
                            
    vec2 GA;
    GA.x -= iTime * 1.8;
    GA.y += iTime * 0.9;
    GA *= speed;

    float F1, F2, F3, F4, F5, N1, N2, N3, N4, N5;
    float A, A1, A2, A3, A4, A5;

    // Attenuation
    A = (uv.x - (uv.y * 0.3));
    A = clamp(A, 0.0, 1.0);

    // Snow layers N1-N5 (Worley Noise)
    F1 = 1.0 - cellular2x2((uv + (GA * 0.1)) * 8.0);	
    A1 = 1.0 - (A * 1.0);
    N1 = smoothstep(0.998, 1.0, F1) * 1.0 * A1;	

    F2 = 1.0 - cellular2x2((uv + (GA * 0.2)) * 6.0);	
    A2 = 1.0 - (A * 0.8);
    N2 = smoothstep(0.995, 1.0, F2) * 0.85 * A2;				

    F3 = 1.0 - cellular2x2((uv + (GA * 0.4)) * 4.0);	
    A3 = 1.0 - (A * 0.6);
    N3 = smoothstep(0.99, 1.0, F3) * 0.65 * A3;				

    F4 = 1.0 - cellular2x2((uv + (GA * 0.6)) * 3.0);	
    A4 = 1.0 - (A * 1.0);
    N4 = smoothstep(0.98, 1.0, F4) * 0.4 * A4;				

    F5 = 1.0 - cellular2x2((uv + (GA)) * 1.2);	
    A5 = 1.0 - (A * 1.0);
    N5 = smoothstep(0.98, 1.0, F5) * 0.25 * A5;				
                    
    float Snowout = 0.35 + (slope * (suns + 0.3)) + (sunsh * 0.6) + N1 + N2 + N3 + N4 + N5;
    
    // Tint slightly blueish
    fragColor = vec4(Snowout * 0.9, Snowout, Snowout * 1.1, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

const BlizzardShader: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) return;

    const compileShader = (source: string, type: number) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fs = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();

    let animFrame: number;
    const start = Date.now();

    const render = () => {
      const time = (Date.now() - start) / 1000.0;
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animFrame = requestAnimationFrame(render);
    };

    render();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animFrame);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-[#050505]">
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full block"
      />
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
    </div>
  );
};

export default BlizzardShader;
