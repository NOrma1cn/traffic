import React, { useEffect, useRef } from 'react';

export type SunnyDayPhase = 'sunrise' | 'noon' | 'sunset' | 'midnight';

interface SunnyShaderProps {
  dayPhase: SunnyDayPhase;
  intensity?: number;
}

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
  uniform float u_day_phase;
  uniform float u_intensity;

  #define PI 3.141592653589793

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += noise(p) * amp;
      p *= 2.02;
      amp *= 0.5;
    }
    return value;
  }

  float circle(vec2 uv, vec2 center, float radius, float blur) {
    float d = length(uv - center);
    return 1.0 - smoothstep(radius - blur, radius + blur, d);
  }

  vec3 topSky(float phase) {
    if (phase < 0.5) return vec3(0.96, 0.49, 0.24);
    if (phase < 1.5) return vec3(0.12, 0.47, 0.92);
    if (phase < 2.5) return vec3(0.82, 0.25, 0.20);
    return vec3(0.02, 0.04, 0.11);
  }

  vec3 bottomSky(float phase) {
    if (phase < 0.5) return vec3(1.00, 0.79, 0.58);
    if (phase < 1.5) return vec3(0.72, 0.90, 1.00);
    if (phase < 2.5) return vec3(0.98, 0.58, 0.33);
    return vec3(0.05, 0.08, 0.17);
  }

  vec3 sunColor(float phase) {
    if (phase < 0.5) return vec3(1.00, 0.76, 0.45);
    if (phase < 1.5) return vec3(1.00, 0.97, 0.88);
    if (phase < 2.5) return vec3(1.00, 0.50, 0.22);
    return vec3(0.82, 0.88, 1.00);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 centered = uv - 0.5;
    centered.x *= u_resolution.x / u_resolution.y;

    float phase = u_day_phase;
    float intensity = clamp(u_intensity, 0.0, 1.0);

    vec3 color = mix(bottomSky(phase), topSky(phase), smoothstep(0.02, 0.96, uv.y));

    float horizonGlow = exp(-pow(max(uv.y - 0.16, 0.0) * 2.2, 2.0));
    if (phase < 0.5) {
      color += vec3(1.00, 0.68, 0.34) * horizonGlow * 0.24;
    } else if (phase < 2.5 && phase >= 2.0) {
      color += vec3(1.00, 0.34, 0.18) * horizonGlow * 0.22;
    } else if (phase >= 3.0) {
      color += vec3(0.06, 0.09, 0.18) * horizonGlow * 0.10;
    }

    vec2 sunPos =
      phase < 0.5 ? vec2(-0.42, 0.22) :
      phase < 1.5 ? vec2(0.0, 0.70) :
      phase < 2.5 ? vec2(0.40, 0.20) :
      vec2(0.22, 0.66);

    if (phase < 3.0) {
      float disc = circle(centered, sunPos, 0.08, 0.03);
      float halo = circle(centered, sunPos, 0.23 + intensity * 0.08, 0.22);
      float bloom = circle(centered, sunPos, 0.44 + intensity * 0.12, 0.35);
      vec3 discCol = sunColor(phase);
      color += discCol * disc * (0.9 + intensity * 0.35);
      color += discCol * halo * (0.18 + intensity * 0.18);
      color += discCol * bloom * (0.06 + intensity * 0.10);
    } else {
      float moon = circle(centered, sunPos, 0.06, 0.025);
      color += vec3(0.86, 0.91, 1.00) * moon * (0.7 + intensity * 0.15);
      vec2 starsUv = uv * u_resolution.xy / min(u_resolution.x, u_resolution.y);
      float stars = step(0.9972, hash21(floor(starsUv * 90.0)));
      stars *= 0.75 + 0.25 * sin(u_time * 0.7 + starsUv.x * 13.0);
      color += vec3(0.72, 0.82, 1.0) * stars * 0.55;
    }

    vec2 cloudUvA = uv * vec2(3.0, 1.4);
    cloudUvA.x += u_time * (0.006 + intensity * 0.008);
    cloudUvA.y -= u_time * 0.002;
    float wispsA = fbm(cloudUvA + vec2(0.0, 2.0));
    wispsA = smoothstep(0.58, 0.78, wispsA);

    vec2 cloudUvB = uv * vec2(5.4, 2.1);
    cloudUvB.x -= u_time * (0.012 + intensity * 0.012);
    cloudUvB.y += u_time * 0.003;
    float wispsB = fbm(cloudUvB + vec2(7.0, 1.0));
    wispsB = smoothstep(0.63, 0.82, wispsB);

    float cloudBand = clamp(wispsA * 0.7 + wispsB * 0.45, 0.0, 1.0);
    float cloudMask = cloudBand * smoothstep(0.18, 0.95, uv.y) * (phase >= 3.0 ? 0.18 : 0.34 + intensity * 0.18);

    vec3 cloudTint =
      phase < 0.5 ? vec3(1.00, 0.78, 0.66) :
      phase < 1.5 ? vec3(0.98, 0.99, 1.00) :
      phase < 2.5 ? vec3(0.96, 0.70, 0.62) :
      vec3(0.20, 0.25, 0.36);
    color = mix(color, cloudTint, cloudMask);

    float haze = smoothstep(0.0, 0.38, 1.0 - uv.y);
    color = mix(color, bottomSky(phase), haze * (0.08 + intensity * 0.06));

    float heat = fbm(uv * vec2(8.0, 18.0) + vec2(0.0, u_time * 0.16));
    float heatMask = smoothstep(0.0, 0.32, 1.0 - uv.y) * intensity * (phase >= 3.0 ? 0.0 : 0.035);
    color += vec3(0.04, 0.02, 0.01) * heat * heatMask;

    color *= 0.97 + intensity * 0.05;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const phaseToValue: Record<SunnyDayPhase, number> = {
  sunrise: 0,
  noon: 1,
  sunset: 2,
  midnight: 3,
};

const SunnyShader: React.FC<SunnyShaderProps> = ({
  dayPhase,
  intensity = 70,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ dayPhase, intensity });

  useEffect(() => {
    propsRef.current = { dayPhase, intensity };
  }, [dayPhase, intensity]);

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
        console.error('Sunny shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Sunny shader link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const vertices = new Float32Array([
      -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
      -1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const dayPhaseLocation = gl.getUniformLocation(program, 'u_day_phase');
    const intensityLocation = gl.getUniformLocation(program, 'u_intensity');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    window.addEventListener('resize', resize);
    resize();

    let animationFrameId = 0;
    const startTime = Date.now();

    const render = () => {
      const runtime = propsRef.current;
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (Date.now() - startTime) / 1000.0);
      gl.uniform1f(dayPhaseLocation, phaseToValue[runtime.dayPhase]);
      gl.uniform1f(intensityLocation, runtime.intensity / 100.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-[#050506]">
      <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full block" />
      <div className="absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_18%,#050506_100%)]" />
    </div>
  );
};

export default SunnyShader;
