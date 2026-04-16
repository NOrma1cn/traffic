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
uniform vec2 u_mouse;

#define iResolution u_resolution
#define iTime u_time
#define iMouse vec4(u_mouse.x, u_mouse.y, 0.0, 0.0)

// --- Settings ---
#define STEP_SIZE_SCALE 500.0
#define CloudsFloor 1000.0
#define CloudsCeil 5000.0
#define COVERAGE_START 0.02
#define COVERAGE_END 0.23
#define CLOUDS_FBM_STEPS 5
#define EXPOSURE 0.5
#define CAMERA_HEIGHT (200.0)
#define FOG_COLOR vec3(0.04)
#define planetradius 6378000.1
#define VECTOR_UP vec3(0.0, 1.0, 0.0)

// --- Utilities ---
mat3 createRotationMatrixAxisAngle(vec3 axis, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  return mat3(
    oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 
    oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 
    oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
  );
}

vec3 getRay(vec2 fragCoord) {
  vec2 uv = ((fragCoord.xy / iResolution.xy) * 2.0 - 1.0) * vec2(iResolution.x / iResolution.y, 1.0);
  vec3 proj = normalize(vec3(uv.x, uv.y, 1.5));
  vec2 NormalizedMouse = iMouse.xy / iResolution.xy;
  
  if(iResolution.x < 600.0 || NormalizedMouse.x == 0.0) {
    return proj * createRotationMatrixAxisAngle(vec3(1.0, 0.0, 0.0), -0.6);
  }
  return createRotationMatrixAxisAngle(vec3(0.0, -1.0, 0.0), 3.0 * ((NormalizedMouse.x + 0.5) * 2.0 - 1.0)) 
    * createRotationMatrixAxisAngle(vec3(1.0, 0.0, 0.0), 0.5 + 1.5 * ((NormalizedMouse.y * 1.5) * 2.0 - 1.0))
    * proj;
}

float rand2dTime(vec2 co){
    return fract(sin(dot(co.xy * iTime, vec2(12.9898, 78.233))) * 43758.5453);
}

float rand3d(vec3 p){
    return fract(4768.1232345456 * sin((p.x + p.y * 43.0 + p.z * 137.0)));
}

float noise3d(vec3 x){
    vec3 p = floor(x);
    vec3 fr = fract(x);
    float l0c1 = rand3d(p + vec3(0, 0, 0));
    float l0c2 = rand3d(p + vec3(1, 0, 0));
    float l0c3 = rand3d(p + vec3(0, 1, 0));
    float l0c4 = rand3d(p + vec3(1, 1, 0));
    float l0c5 = rand3d(p + vec3(0, 0, 1));
    float l0c6 = rand3d(p + vec3(1, 0, 1));
    float l0c7 = rand3d(p + vec3(0, 1, 1));
    float l0c8 = rand3d(p + vec3(1, 1, 1));

    float l1c1 = mix(l0c1, l0c2, fr.x);
    float l1c2 = mix(l0c3, l0c4, fr.x);
    float l1c3 = mix(l0c5, l0c6, fr.x);
    float l1c4 = mix(l0c7, l0c8, fr.x);

    float l2c1 = mix(l1c1, l1c2, fr.y);
    float l2c2 = mix(l1c3, l1c4, fr.y);

    return mix(l2c1, l2c2, fr.z);
}

float supernoise3d(vec3 p){
	return (noise3d(p) + noise3d(p + 10.5)) * 0.5;
}

struct Ray { vec3 o; vec3 d; };
struct Sphere { vec3 pos; float rad; };
float minhit = 0.0;
float maxhit = 0.0;
float hitLimit = 678000.0;

float raySphereIntersect(in Ray ray, in Sphere sphere) {
    vec3 oc = ray.o - sphere.pos;
    float b = 2.0 * dot(ray.d, oc);
    float c = dot(oc, oc) - sphere.rad * sphere.rad;
    float disc = b * b - 4.0 * c;
    if (disc < 0.0) return 0.0;
    float sdisc = sqrt(disc);
    float t0 = (-b - sdisc) / 2.0;
    float t1 = (-b + sdisc) / 2.0;
    minhit = min(t0, t1);
    maxhit = max(t0, t1);
    if(minhit < 0.0 && maxhit > 0.0) return maxhit;
    if(minhit < maxhit && minhit > 0.0) return minhit;
    return 0.0;    
}

float cloudsFBM(vec3 p){
    float a = 0.0;
    float w = 0.5;
    for(int i=0; i<CLOUDS_FBM_STEPS; i++){
        float x = abs(0.5 - supernoise3d(p)) * 2.0;
        a += x * w;
        p = p * 2.9;
        w *= 0.60;
    }
    return a;
}

float getHeightOverSurface(vec3 p){
    return length(p) - planetradius;
}

vec2 cloudsDensity3D(vec3 pos){
    float h = getHeightOverSurface(pos);
    pos -= vec3(0, planetradius, 0);
    float measurement = (CloudsCeil - CloudsFloor) * 0.5;
    float mediana = (CloudsCeil + CloudsFloor) * 0.5;
    float mlt = (1.0 - (abs(h - mediana) / measurement));
    float density = cloudsFBM(pos * 0.0002 + vec3(iTime * 0.04, 0.0, 0.0));
    float scattering = (h - CloudsFloor) / (CloudsCeil - CloudsFloor);
    return vec2(density * mlt, scattering);
}
     
vec4 raymarchClouds(vec3 p1, vec3 p2, float randomValue){
    float dist = distance(p1, p2);
    float stepsize = STEP_SIZE_SCALE / dist;
    float coverageinv = 1.0;
    vec3 color = vec3(0.0);
    float iter = randomValue * stepsize;
    for(int i=0; i<40; i++) { // Capped iteration
        if(iter >= 1.0 || coverageinv <= 0.0) break;
        vec2 d = cloudsDensity3D(mix(p1, p2, iter));
        float clouds = smoothstep(COVERAGE_START, COVERAGE_END, clamp(d.x, 0.0, 1.0));
        color += clouds * max(0.0, coverageinv) * d.y;
        coverageinv -= clouds + 0.001;
        iter += stepsize * 0.1 + stepsize * 2.0 * max(0.0, 0.2 - d.x);
    }
    return vec4(pow(color, vec3(2.0)) * 20.0, 1.0 - clamp(coverageinv, 0.0, 1.0));
}

vec3 renderGround(vec3 point, float dist, float random){
    float shadow = raymarchClouds(point + vec3(0, CloudsFloor, 0), point + vec3(0, CloudsCeil, 0), random).x;
    vec3 color = vec3(0.2) * (0.8 + 0.2 * shadow);
    float fog = clamp(1.0 - 1.0 / (0.001 * dist), 0.0, 1.0);
    return mix(color, FOG_COLOR, fog);
}

vec3 renderClouds(vec3 pStart, vec3 pEnd, vec3 bg, float dist, float random){
    vec4 clouds = raymarchClouds(pStart, pEnd, random);
    vec3 color = mix(bg, clouds.xyz, clouds.a);
    float fog = clamp(1.0 - 1.0 / (0.0001 * dist), 0.0, 1.0);
    return mix(color, FOG_COLOR, fog);
}

vec3 aces_tonemap(vec3 color) {  
  mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108,  1.10813, -0.07276, -0.07367, -0.00605,  1.07602);
  vec3 v = m1 * color;  
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return pow(clamp(m2 * (a / b), 0.0, 1.0), vec3(1.0 / 2.2));  
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 dir = getRay(fragCoord);
    vec3 C = vec3(0.5, 0.7, 0.8);
    float random = fract(rand2dTime(fragCoord.xy / iResolution.xy));
    
    Sphere sCeil = Sphere(vec3(0), planetradius + CloudsCeil);
    Sphere sFloor = Sphere(vec3(0), planetradius + CloudsFloor);
    Sphere sGround = Sphere(vec3(0), planetradius);

    vec3 atmorg = vec3(0.0, planetradius + CAMERA_HEIGHT, 0.0);
    Ray ray = Ray(atmorg, dir);
    
    float hitceil = raySphereIntersect(ray, sCeil);
    float hitfloor = raySphereIntersect(ray, sFloor);
    float hitGround = raySphereIntersect(ray, sGround);
    
    // Simple logic for "Below Clouds" only to keep it clean for dashboard use
    if(hitGround > 0.0 && hitGround < hitLimit){
        C = renderGround(atmorg + (dir * hitGround), hitGround, random);
    } else {
        float start = min(hitfloor, hitceil);
        float end = max(hitfloor, hitceil);
        C = renderClouds(atmorg + (dir * start), atmorg + (dir * end), C, start, random);
    }
    
    fragColor = vec4(aces_tonemap(C * EXPOSURE * vec3(1.0, 0.9, 0.8)), 1.0);      
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

const OvercastShader: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return;

    const compile = (src: string, type: number) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };

    const vs = compile(vertexShaderSource, gl.VERTEX_SHADER);
    const fs = compile(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const mouseLoc = gl.getUniformLocation(program, 'u_mouse');

    const onMove = (e: MouseEvent) => {
       mouseRef.current = { x: e.clientX, y: window.innerHeight - e.clientY };
    };
    window.addEventListener('mousemove', onMove);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();

    let frame: number;
    const start = Date.now();
    const render = () => {
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, (Date.now() - start) / 1000.0);
      gl.uniform2f(mouseLoc, mouseRef.current.x, mouseRef.current.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-[#0a0c10]">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#0a0c10] via-transparent to-transparent opacity-40" />
    </div>
  );
};

export default OvercastShader;
