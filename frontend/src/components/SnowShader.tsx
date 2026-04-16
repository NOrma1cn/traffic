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

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    float snow = 0.0;
    // 调整平滑度，避免在不同分辨率下闪烁
    float gradient = (1.0-float(fragCoord.y / iResolution.x))*0.4;
    float random = fract(sin(dot(fragCoord.xy,vec2(12.9898,78.233)))* 43758.5453);
    
    // 渲染 6 层，每层 12 个粒子周期
    for(int k=0; k<6; k++){
        for(int i=0; i<12; i++){
            float f_i = float(i);
            float f_k = float(k);
            
            float cellSize = 2.0 + (f_i * 3.0);
            float downSpeed = 0.3 + (sin(iTime * 0.4 + (f_k + f_i * 20.0)) + 1.0) * 0.00008;
            
            // 粒子漂移逻辑
            vec2 uv = (fragCoord.xy / iResolution.x) + vec2(
                0.01 * sin((iTime + (f_k * 6185.0)) * 0.6 + f_i) * (5.0 / f_i),
                downSpeed * (iTime + (f_k * 1352.0)) * (1.0 / f_i)
            );
            
            vec2 uvStep = (ceil((uv) * cellSize - vec2(0.5, 0.5)) / cellSize);
            
            // 随机化位置
            float x = fract(sin(dot(uvStep.xy, vec2(12.9898 + f_k * 12.0, 78.233 + f_k * 315.156))) * 43758.5453 + f_k * 12.0) - 0.5;
            float y = fract(sin(dot(uvStep.xy, vec2(62.2364 + f_k * 23.0, 94.674 + f_k * 95.0))) * 62159.8432 + f_k * 12.0) - 0.5;

            float randomMagnitude1 = sin(iTime * 2.5) * 0.7 / cellSize;
            float randomMagnitude2 = cos(iTime * 2.5) * 0.7 / cellSize;

            // 计算到粒子中心的距离
            float d = 5.0 * distance((uvStep.xy + vec2(x * sin(y), y) * randomMagnitude1 + vec2(y, x) * randomMagnitude2), uv.xy);

            float omiVal = fract(sin(dot(uvStep.xy, vec2(32.4691, 94.615))) * 31572.1684);
            
            // 渲染雪颗粒
            if(omiVal < 0.08) {
                float newd = (x + 1.0) * 0.4 * clamp(1.9 - d * (15.0 + (x * 6.3)) * (cellSize / 1.4), 0.0, 1.0);
                snow += newd;
            }
        }
    }
    
    // 最终颜色合成：雪花亮度 + 浅蓝色渐变底色 + 微量随机噪点
    fragColor = vec4(vec3(snow), 1.0) + gradient * vec4(0.4, 0.8, 1.0, 1.0) + random * 0.01;
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

const SnowShader: React.FC = () => {
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
      {/* 叠一层淡淡的暗部遮罩，确保 UI 这里的对比度 */}
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-transparent via-transparent to-black/30" />
    </div>
  );
};

export default SnowShader;
