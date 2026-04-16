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

#define iResolution vec3(u_resolution, 1.0)
#define iTime u_time

mat2 R;    
float d = 1.0, z, G = 9.0, M = 1e-3;

float D(vec3 p) {
  p.xy *= R;
  p.xz *= R;

  vec3 S = sin(123. * p);

  G = min(G, max(abs(length(p) - .6), d = pow(dot(p *= p * p * p, p), .125) - .5 - pow(1. + S.x * S.y * S.z, 8.) / 1e5));

  return d;
}

void mainImage(out vec4 o, vec2 C) {
  float a = iTime * 0.8;
  R = mat2(cos(a), sin(a), -sin(a), cos(a));

  vec3 p, O, r = iResolution, I = normalize(vec3(C - .5 * r.xy, r.y)), B = vec3(1, 2, 9) * M;

  z = 0.0;
  d = 1.0;
  G = 9.0;

  for (int i = 0; i < 100; i++) {
    if (z >= 9. || d <= M) break;
    p = z * I;
    p.z -= 2.;
    z += D(p);
  }

  if (z < 9.) {
    vec3 normalVec = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec3 eps = vec3(0.0);
      if (i == 0) eps.x = M;
      else if (i == 1) eps.y = M;
      else eps.z = M;
      normalVec[i] = D(p + eps) - D(p - eps);
    }
    
    O = normalize(normalVec);
    z = 1. + dot(O, I);
    r = reflect(I, O);
    vec2 C_xz = (p + r * (5. - p.y) / abs(r.y)).xz;
    
    O = z * z * (r.y > 0. ? 5e2 * smoothstep(5., 4., d = sqrt(length(C_xz * C_xz)) + 1.) * d * B : exp(-2. * length(C_xz)) * (B / M - 1.)) + pow(1. + O.y, 5.) * B;
    o = sqrt(vec4(O + B / G, 1.0));
  } else {
    o = vec4(0.0);
  }
}

void main() {
    vec4 total = vec4(0.0);
    vec4 col;
    mainImage(col, gl_FragCoord.xy + vec2(-0.25, -0.25)); total += col;
    mainImage(col, gl_FragCoord.xy + vec2(0.25, -0.25)); total += col;
    mainImage(col, gl_FragCoord.xy + vec2(-0.25, 0.25)); total += col;
    mainImage(col, gl_FragCoord.xy + vec2(0.25, 0.25)); total += col;
    gl_FragColor = total / 4.0;
}
`;

interface LogoShaderProps {
  size?: number;
  className?: string;
}

const LogoShader: React.FC<LogoShaderProps> = ({ size = 40, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

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
        console.error(gl.getShaderInfoLog(shader));
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

    let animFrame: number;
    const start = Date.now();

    const render = () => {
      const time = (Date.now() - start) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animFrame = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [size]); // Re-run when size changes

  return (
    <canvas 
      ref={canvasRef} 
      width={size} 
      height={size} 
      className={`rounded-xl ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
};

export default LogoShader;
