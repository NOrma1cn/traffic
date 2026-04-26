import { ledTransitionShaderChunk } from './common';

export const sunnyFragmentShaderSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_day_phase;
  uniform float u_intensity;
  ${ledTransitionShaderChunk}

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

  // Adapted from "Auroras" by nimitz (2017), CC BY-NC-SA 3.0.
  mat2 auroraMm2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
  }

  const mat2 AURORA_M2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);

  float auroraTri(float x) {
    return clamp(abs(fract(x) - 0.5), 0.01, 0.49);
  }

  vec2 auroraTri2(vec2 p) {
    return vec2(auroraTri(p.x) + auroraTri(p.y), auroraTri(p.y + auroraTri(p.x)));
  }

  float auroraTriNoise2d(vec2 p, float spd) {
    float z = 1.8;
    float z2 = 2.5;
    float rz = 0.0;
    p *= auroraMm2(p.x * 0.06);
    vec2 bp = p;
    for (int i = 0; i < 5; i++) {
      vec2 dg = auroraTri2(bp * 1.85) * 0.75;
      dg *= auroraMm2(u_time * spd);
      p -= dg / z2;

      bp *= 1.3;
      z2 *= 0.45;
      z *= 0.42;
      p *= 1.21 + (rz - 1.0) * 0.02;

      rz += auroraTri(p.x + auroraTri(p.y)) * z;
      p *= -AURORA_M2;
    }
    return clamp(1.0 / pow(max(rz * 29.0, 0.001), 1.3), 0.0, 0.55);
  }

  vec4 auroraVolume(vec3 ro, vec3 rd) {
    vec4 col = vec4(0.0);
    vec4 avgCol = vec4(0.0);

    for (int i = 0; i < 50; i++) {
      float fi = float(i);
      float of = 0.006 * hash21(gl_FragCoord.xy) * smoothstep(0.0, 15.0, fi);
      float pt = ((0.8 + pow(fi, 1.4) * 0.002) - ro.y) / (rd.y * 2.0 + 0.4);
      pt -= of;
      vec3 bpos = ro + pt * rd;
      float rzt = auroraTriNoise2d(bpos.zx, 0.06);
      vec4 col2 = vec4(0.0, 0.0, 0.0, rzt);
      col2.rgb = (sin(1.0 - vec3(2.15, -0.5, 1.2) + fi * 0.043) * 0.5 + 0.5) * rzt;
      avgCol = mix(avgCol, col2, 0.5);
      col += avgCol * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 5.0, fi);
    }

    col *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
    return col * 1.8;
  }

  vec3 auroraHash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  vec3 auroraStars(vec3 p) {
    vec3 c = vec3(0.0);
    float res = u_resolution.x;

    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec3 q = fract(p * (0.15 * res)) - 0.5;
      vec3 id = floor(p * (0.15 * res));
      vec2 rn = auroraHash33(id).xy;
      float c2 = 1.0 - smoothstep(0.0, 0.6, length(q));
      c2 *= step(rn.x, 0.0005 + fi * fi * 0.001);
      c += c2 * (mix(vec3(1.0, 0.49, 0.1), vec3(0.75, 0.9, 1.0), rn.y) * 0.1 + 0.9);
      p *= 1.3;
    }

    return c * c * 0.8;
  }

  vec3 auroraBg(vec3 rd) {
    float sd = dot(normalize(vec3(-0.5, -0.6, 0.9)), rd) * 0.5 + 0.5;
    sd = pow(sd, 5.0);
    return mix(vec3(0.05, 0.1, 0.2), vec3(0.1, 0.05, 0.2), sd) * 0.63;
  }

  vec3 renderAuroraNight(vec2 fragCoord, float intensity) {
    vec2 q = fragCoord / u_resolution.xy;
    vec2 p = q - 0.5;
    p.x *= u_resolution.x / u_resolution.y;

    vec3 ro = vec3(0.0, 0.0, -6.7);
    vec3 rd = normalize(vec3(p, 1.3));
    vec2 camera = vec2(-0.1, 0.1);
    camera.x *= u_resolution.x / u_resolution.y;
    rd.yz *= auroraMm2(camera.y);
    rd.xz *= auroraMm2(camera.x + sin(u_time * 0.05) * 0.2);

    vec3 brd = rd;
    float fade = smoothstep(0.0, 0.01, abs(brd.y)) * 0.1 + 0.9;
    vec3 col = auroraBg(rd) * fade;

    if (rd.y > 0.0) {
      vec4 aur = smoothstep(0.0, 1.5, auroraVolume(ro, rd)) * fade;
      col += auroraStars(rd);
      col = col * (1.0 - aur.a) + aur.rgb;
    } else {
      rd.y = abs(rd.y);
      col = auroraBg(rd) * fade * 0.6;
      vec4 aur = smoothstep(0.0, 2.5, auroraVolume(ro, rd));
      col += auroraStars(rd) * 0.1;
      col = col * (1.0 - aur.a) + aur.rgb;
      vec3 pos = ro + ((0.5 - ro.y) / rd.y) * rd;
      float nz2 = auroraTriNoise2d(pos.xz * vec2(0.5, 0.7), 0.0);
      col += mix(vec3(0.2, 0.25, 0.5) * 0.08, vec3(0.3, 0.3, 0.5) * 0.7, nz2 * 0.4);
    }

    float horizon = smoothstep(0.0, 0.35, q.y) * smoothstep(1.0, 0.72, q.y);
    col += vec3(0.02, 0.08, 0.12) * horizon * (0.25 + intensity * 0.2);
    return col;
  }

  vec3 topSky(float phase) {
    if (phase < 0.5) return vec3(0.12, 0.22, 0.45); // Sunrise: Indigo blue sky
    if (phase < 1.5) return vec3(0.15, 0.45, 0.85); // Noon: Vibrant deep blue
    if (phase < 2.5) return vec3(0.18, 0.12, 0.35); // Sunset: Deep purple/magenta twilight
    return vec3(0.01, 0.01, 0.03); // Midnight: Dark indigo
  }

  vec3 bottomSky(float phase) {
    if (phase < 0.5) return vec3(0.85, 0.45, 0.25); // Sunrise: Bright amber horizon
    if (phase < 1.5) return vec3(0.45, 0.75, 1.00); // Noon: Light azure horizon
    if (phase < 2.5) return vec3(0.85, 0.35, 0.15); // Sunset: Vivid orange horizon
    return vec3(0.05, 0.08, 0.18); // Midnight: Deep cosmic blue
  }

  vec3 sunColor(float phase) {
    if (phase < 0.5) return vec3(1.00, 0.76, 0.45);
    if (phase < 1.5) return vec3(1.00, 0.97, 0.88);
    if (phase < 2.5) return vec3(1.00, 0.50, 0.22);
    return vec3(0.82, 0.88, 1.00);
  }

  // User-provided neon sun field, adapted for a fixed upper-right sun.
  float sunnyDayRnd(vec2 p) {
    return fract(sin(dot(p, vec2(12.1234, 72.8392))) * 45123.2);
  }

  float sunnyDayRnd(float w) {
    return fract(sin(w) * 1000.0);
  }

  float sunnyDayRegShape(vec2 p, int n) {
    float a = atan(p.x, p.y) + 0.2;
    float b = 6.28319 / float(n);
    return smoothstep(0.5, 0.51, cos(floor(0.5 + a / b) * b - a) * length(p.xy));
  }

  vec3 sunnyDayCircle(vec2 p, float size, vec3 color, float dist, vec2 sunPos) {
    float l = length(p + sunPos * (dist * 4.0)) + size / 2.0;
    float safeCenter = max(length(p - sunPos * dist / 2.0 + 0.09), 0.002);
    float c = max(0.01 - pow(length(p + sunPos * dist), size * 1.4), 0.0) * 50.0;
    float c1 = max(0.001 - pow(max(l - 0.3, 0.0), 1.0 / 40.0) + sin(l * 30.0), 0.0) * 3.0;
    float c2 = max(0.04 / safeCenter, 0.0) / 20.0;
    float s = max(0.01 - pow(sunnyDayRegShape(p * 5.0 + sunPos * dist * 5.0 + 0.9, 6), 1.0), 0.0) * 5.0;

    color = 0.5 + 0.5 * sin(color);
    color = cos(vec3(0.44, 0.24, 0.2) * 8.0 + dist * 4.0) * 0.5 + 0.5;

    vec3 field = c * color;
    field += c1 * color;
    field += c2 * color;
    field += s * color;
    return field - 0.01;
  }

  vec3 renderSunnyDay(vec2 fragCoord, float intensity) {
    vec2 uv = fragCoord / u_resolution.xy - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    vec2 sunPos = vec2(0.48 * u_resolution.x / u_resolution.y, 0.28);

    vec3 circColor = vec3(0.9, 0.2, 0.1);
    vec3 color = mix(vec3(0.3, 0.2, 0.02) / 0.9, vec3(0.2, 0.5, 0.8), uv.y) * 3.0;
    color -= 0.18;

    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float size = pow(sunnyDayRnd(fi * 2000.0) * 1.8, 2.0) + 1.41;
      float dist = sunnyDayRnd(fi * 20.0) * 3.0 + 0.2 - 0.5;
      color += sunnyDayCircle(uv, size, circColor + fi, dist, sunPos);
    }

    vec2 sunDelta = uv - sunPos;
    float sunLen = max(length(sunDelta), 0.002);
    float a = atan(sunDelta.y, sunDelta.x);
    float bright = 0.1 + 0.08 * intensity;

    color += max(0.1 / pow(sunLen * 5.0, 5.0), 0.0) * abs(sin(a * 5.0 + cos(a * 9.0))) / 20.0;
    color += max(0.1 / pow(sunLen * 10.0, 1.0 / 20.0), 0.0) + abs(sin(a * 3.0 + cos(a * 9.0))) / 8.0 * abs(sin(a * 9.0));
    color += (max(bright / pow(sunLen * 4.0, 1.0 / 2.0), 0.0) * 4.0) * vec3(0.2, 0.21, 0.3) * 4.0;
    color *= exp(1.0 - sunLen) / 5.0;

    return max(color, vec3(0.0));
  }

  void main() {
    vec2 fragCoord = getTransitionFragCoord(gl_FragCoord.xy);
    vec2 uv = fragCoord / u_resolution.xy;
    vec2 centered = uv - 0.5;
    centered.x *= u_resolution.x / u_resolution.y;

    float phase = u_day_phase;
    float intensity = clamp(u_intensity, 0.0, 1.0);

    vec3 color = vec3(0.0);

    if (phase >= 3.0) {
      color = renderAuroraNight(fragCoord, intensity);
    } else {
      color = renderSunnyDay(fragCoord, intensity);
    }

    // Vignette
    float vig = smoothstep(1.2, 0.4, length(centered));
    color *= 0.8 + 0.2 * vig;

    color = applyLedTransition(color, gl_FragCoord.xy);
    gl_FragColor = vec4(color, 1.0);
  }
`;
