import React, { useEffect, useRef } from 'react';
import type { WeatherDisplayCondition } from '../weather';

export type DayPhase = 'sunrise' | 'noon' | 'sunset' | 'midnight';

interface WeatherRuntimeShaderProps {
  dayPhase: DayPhase;
  weatherType: WeatherDisplayCondition;
  intensity?: number;
  cloudiness?: number;
  precipitation?: number;
  wind?: number;
  humidity?: number;
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
  uniform float u_weather_type;
  uniform float u_intensity;
  uniform float u_cloudiness;
  uniform float u_precipitation;
  uniform float u_wind;
  uniform float u_humidity;

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
      p *= 2.03;
      amp *= 0.5;
    }
    return value;
  }

  float circle(vec2 uv, vec2 center, float radius, float blur) {
    float d = length(uv - center);
    return 1.0 - smoothstep(radius - blur, radius + blur, d);
  }

  float layerClouds(vec2 uv, float speed, float scale, float density, float softness) {
    vec2 p = uv * scale;
    p.x += u_time * speed;
    p.y -= u_time * speed * 0.18;
    float n = fbm(p);
    return smoothstep(density - softness, density + softness, n);
  }

  float rainMask(vec2 uv, float tilt, float speed, float density) {
    vec2 p = uv;
    p.x += uv.y * tilt;
    p.y += u_time * speed;
    vec2 cell = floor(p * vec2(90.0, 38.0));
    float rnd = hash21(cell);
    float streak = smoothstep(1.0 - density, 1.0, rnd);
    vec2 f = fract(p * vec2(90.0, 38.0));
    float line = 1.0 - smoothstep(0.02, 0.08, abs(f.x - 0.5));
    float fall = smoothstep(0.1, 0.9, f.y) * (1.0 - smoothstep(0.9, 1.0, f.y));
    return streak * line * fall;
  }

  float snowMask(vec2 uv, float speed, float density) {
    vec2 p = uv * vec2(28.0, 20.0);
    p.y += u_time * speed;
    p.x += sin(u_time + p.y * 0.2) * 0.35;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float rnd = hash21(cell);
    float keep = smoothstep(1.0 - density, 1.0, rnd);
    float flake = 1.0 - smoothstep(0.05, 0.22, length(f));
    return keep * flake;
  }

  float windBand(vec2 uv, float speed, float strength) {
    vec2 p = uv * vec2(7.0, 28.0);
    p.x -= u_time * speed;
    float n = noise(p + vec2(0.0, u_time * 0.15));
    float band = smoothstep(0.72, 0.9, n);
    band *= smoothstep(0.15, 0.85, uv.y);
    return band * strength;
  }

  vec3 getTopSky(float phase) {
    if (phase < 0.5) return vec3(0.97, 0.45, 0.22);
    if (phase < 1.5) return vec3(0.23, 0.55, 0.95);
    if (phase < 2.5) return vec3(0.90, 0.28, 0.18);
    return vec3(0.02, 0.05, 0.12);
  }

  vec3 getBottomSky(float phase) {
    if (phase < 0.5) return vec3(1.00, 0.77, 0.55);
    if (phase < 1.5) return vec3(0.76, 0.89, 1.00);
    if (phase < 2.5) return vec3(0.35, 0.13, 0.24);
    return vec3(0.05, 0.08, 0.18);
  }

  vec3 mixCloudTint(float phase, float cloudAlpha) {
    vec3 dawn = vec3(1.00, 0.64, 0.46);
    vec3 day = vec3(0.92, 0.95, 1.00);
    vec3 dusk = vec3(0.92, 0.52, 0.40);
    vec3 night = vec3(0.22, 0.28, 0.40);
    vec3 base =
      phase < 0.5 ? dawn :
      phase < 1.5 ? day :
      phase < 2.5 ? dusk : night;
    return base * mix(0.7, 1.0, cloudAlpha);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 centered = uv - 0.5;
    centered.x *= u_resolution.x / u_resolution.y;

    float phase = u_day_phase;
    float intensity = clamp(u_intensity, 0.0, 1.0);
    float cloudiness = clamp(u_cloudiness, 0.0, 1.0);
    float precipitation = clamp(u_precipitation, 0.0, 1.0);
    float wind = clamp(u_wind, 0.0, 1.0);
    float humidity = clamp(u_humidity, 0.0, 1.0);

    vec3 color = mix(getBottomSky(phase), getTopSky(phase), smoothstep(0.02, 0.95, uv.y));

    float horizonGlow = exp(-pow(max(uv.y - 0.2, 0.0) * 2.5, 2.0));
    if (phase < 0.5 || (phase >= 2.0 && phase < 2.5)) {
      vec3 glowColor = phase < 0.5 ? vec3(1.00, 0.74, 0.42) : vec3(0.98, 0.36, 0.22);
      color += glowColor * horizonGlow * 0.16;
    }

    vec2 sunPos =
      phase < 0.5 ? vec2(-0.45, 0.32) :
      phase < 1.5 ? vec2(0.0, 0.72) :
      phase < 2.5 ? vec2(0.42, 0.28) :
      vec2(-0.25, 0.76);
    float sunMask = circle(centered, sunPos, phase >= 3.0 ? 0.11 : 0.09, 0.03);
    if (phase < 3.0) {
      vec3 sunColor =
        phase < 0.5 ? vec3(1.0, 0.78, 0.45) :
        phase < 1.5 ? vec3(1.0, 0.96, 0.84) :
        vec3(1.0, 0.54, 0.24);
      color += sunColor * sunMask * (1.0 - cloudiness * 0.55);
      color += sunColor * circle(centered, sunPos, 0.2, 0.15) * 0.15 * (1.0 - cloudiness);
    } else {
      vec3 moonColor = vec3(0.85, 0.90, 1.0);
      color += moonColor * sunMask * (1.0 - cloudiness * 0.35);
    }

    if (phase >= 3.0) {
      vec2 starsUv = uv * u_resolution.xy / min(u_resolution.x, u_resolution.y);
      float stars = step(0.9965, hash21(floor(starsUv * 90.0)));
      stars *= 0.7 + 0.3 * sin(u_time * 0.7 + starsUv.x * 12.0);
      color += vec3(0.75, 0.84, 1.0) * stars * (1.0 - cloudiness);
    }

    float lowClouds = layerClouds(uv + vec2(0.0, 0.12), 0.008 + wind * 0.03, 3.2, 0.45 + cloudiness * 0.22, 0.16);
    float highClouds = layerClouds(uv + vec2(0.0, 0.28), 0.014 + wind * 0.04, 5.7, 0.47 + cloudiness * 0.18, 0.18);
    float cloudAlpha = clamp(lowClouds * 0.65 + highClouds * 0.5, 0.0, 1.0) * (0.15 + cloudiness * 0.85);
    vec3 cloudColor = mixCloudTint(phase, cloudAlpha);
    color = mix(color, cloudColor, cloudAlpha * 0.78);

    float rain = rainMask(uv, 0.08 + wind * 0.28, 1.3 + precipitation * 2.6, precipitation * (0.45 + intensity * 0.55));
    float drizzle = rainMask(uv, 0.04 + wind * 0.18, 0.9 + precipitation * 1.4, precipitation * 0.35);
    float snow = snowMask(uv, 0.25 + wind * 0.9, precipitation * (0.55 + intensity * 0.35));
    float gust = windBand(uv, 0.7 + wind * 1.8, wind * (0.18 + intensity * 0.28));

    float weather = u_weather_type;
    if (weather > 3.5 && weather < 6.5) {
      color += vec3(0.78, 0.86, 0.98) * drizzle * 0.18;
      color += vec3(0.80, 0.88, 1.00) * rain * 0.30;
    }
    if (weather > 5.5 && weather < 7.5) {
      color += vec3(0.95) * snow * 0.45;
    }
    if (weather > 6.5) {
      color += vec3(0.86, 0.92, 1.0) * gust;
    }

    float fogStrength = 0.0;
    if (weather > 2.5 && weather < 3.5) fogStrength = 0.45 + intensity * 0.35;
    if (weather > 1.5 && weather < 2.5) fogStrength = 0.12 + humidity * 0.18;
    fogStrength *= smoothstep(0.0, 0.48, 1.0 - uv.y);
    color = mix(color, mix(vec3(0.82, 0.84, 0.88), vec3(0.12, 0.14, 0.18), step(2.5, phase)), fogStrength);

    if (weather > 5.5 && weather < 6.5) {
      float flash = smoothstep(0.96, 0.995, sin(u_time * 1.7) * 0.5 + 0.5);
      color += vec3(0.72, 0.82, 1.0) * flash * intensity * 0.55;
    }

    color *= 1.0 - precipitation * 0.08;
    color += vec3(0.0, 0.02, 0.03) * wind * 0.08;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const dayPhaseMap: Record<DayPhase, number> = {
  sunrise: 0,
  noon: 1,
  sunset: 2,
  midnight: 3,
};

const weatherTypeMap: Record<WeatherDisplayCondition, number> = {
  Sunny: 0,
  PartlyCloudy: 1,
  Overcast: 2,
  Foggy: 3,
  Drizzle: 4,
  Rainy: 5,
  Stormy: 6,
  Windy: 7,
};

const WeatherRuntimeShader: React.FC<WeatherRuntimeShaderProps> = ({
  dayPhase,
  weatherType,
  intensity = 60,
  cloudiness = 50,
  precipitation = 30,
  wind = 25,
  humidity = 45,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({
    dayPhase,
    weatherType,
    intensity,
    cloudiness,
    precipitation,
    wind,
    humidity,
  });

  useEffect(() => {
    propsRef.current = {
      dayPhase,
      weatherType,
      intensity,
      cloudiness,
      precipitation,
      wind,
      humidity,
    };
  }, [dayPhase, weatherType, intensity, cloudiness, precipitation, wind, humidity]);

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

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
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
    const weatherTypeLocation = gl.getUniformLocation(program, 'u_weather_type');
    const intensityLocation = gl.getUniformLocation(program, 'u_intensity');
    const cloudinessLocation = gl.getUniformLocation(program, 'u_cloudiness');
    const precipitationLocation = gl.getUniformLocation(program, 'u_precipitation');
    const windLocation = gl.getUniformLocation(program, 'u_wind');
    const humidityLocation = gl.getUniformLocation(program, 'u_humidity');

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
      gl.uniform1f(dayPhaseLocation, dayPhaseMap[runtime.dayPhase]);
      gl.uniform1f(weatherTypeLocation, weatherTypeMap[runtime.weatherType]);
      gl.uniform1f(intensityLocation, runtime.intensity / 100.0);
      gl.uniform1f(cloudinessLocation, runtime.cloudiness / 100.0);
      gl.uniform1f(precipitationLocation, runtime.precipitation / 100.0);
      gl.uniform1f(windLocation, runtime.wind / 100.0);
      gl.uniform1f(humidityLocation, runtime.humidity / 100.0);
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
      <div className="absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_20%,#050506_100%)]" />
    </div>
  );
};

export default WeatherRuntimeShader;
