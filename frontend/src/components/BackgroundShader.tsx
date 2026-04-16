import React, { useEffect, useRef } from 'react';

export type SunnyDayPhase = 'sunrise' | 'noon' | 'sunset' | 'midnight';

interface BackgroundShaderProps {
  weatherCondition?: 'Sunny' | 'Cloudy' | 'Rainy';
  precipitation?: number;
  dayPhase?: SunnyDayPhase;
  sunIntensity?: number;
}

const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const rainyFragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_precipitation;
  uniform float u_visibility;

  #define iResolution vec3(u_resolution, 1.0)
  #define iTime u_time
  #define iMouse vec4(u_mouse.x, u_mouse.y, 0.0, 0.0)

  #define S(x, y, z) smoothstep(x, y, z)
  #define B(a, b, edge, t) S(a-edge, a+edge, t)*S(b+edge, b-edge, t)
  #define sat(x) clamp(x,0.,1.)

  #define streetLightCol vec3(1., .7, .3)
  #define headLightCol vec3(.8, .8, 1.)
  #define tailLightCol vec3(1., .1, .1)

  #define HIGH_QUALITY
  #define CAM_SHAKE 1.
  #define LANE_BIAS .5
  #define RAIN

  #define STP1 0.125       
  #ifdef HIGH_QUALITY
      #define STP2 0.03125 
  #else
      #define STP2 0.0625  
  #endif

  vec3 ro, rd;

  float N(float t) { return fract(sin(t*10234.324)*123423.23512); }
  vec3 N31(float p) {
     vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
     p3 += dot(p3, p3.yzx + 19.19);
     return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
  }
  float N2(vec2 p) {
      vec3 p3  = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
      p3 += dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
  }

  float DistLine(vec3 ro, vec3 rd, vec3 p) { return length(cross(p-ro, rd)); }
  vec3 ClosestPoint(vec3 ro, vec3 rd, vec3 p) { return ro + max(0., dot(p-ro, rd))*rd; }
  float Remap(float a, float b, float c, float d, float t) { return ((t-a)/(b-a))*(d-c)+c; }

  float BokehMask(vec3 ro, vec3 rd, vec3 p, float size, float blur) {
      float d = DistLine(ro, rd, p);
      float m = S(size, size*(1.-blur), d);
      #ifdef HIGH_QUALITY
      m *= mix(.7, 1., S(.8*size, size, d));
      #endif
      return m;
  }

  float SawTooth(float t) { return cos(t+cos(t))+sin(2.*t)*.2+sin(4.*t)*.02; }
  float DeltaSawTooth(float t) { return 0.4*cos(2.*t)+0.08*cos(4.*t) - (1.-sin(t))*sin(t+cos(t)); }  

  vec2 GetDrops(vec2 uv, float seed, float m) {
      float t = iTime+m*30.;
      vec2 o = vec2(0.);
      uv.y += t*.05;
      uv *= vec2(10., 2.5)*2.;
      vec2 id = floor(uv);
      vec3 n = N31(id.x + (id.y+seed)*546.3524);
      vec2 bd = fract(uv);
      bd -= .5;
      bd.y*=4.;
      bd.x += (n.x-.5)*.6;
      t += n.z * 6.28;
      float slide = SawTooth(t);
      float ts = 1.5;
      vec2 trailPos = vec2(bd.x*ts, (fract(bd.y*ts*2.-t*2.)-.5)*.5);
      bd.y += slide*2.;
      #ifdef HIGH_QUALITY
      float dropShape = bd.x*bd.x;
      dropShape *= DeltaSawTooth(t);
      bd.y += dropShape;
      #endif
      float d = length(bd);
      float trailMask = S(-.2, .2, bd.y);
      trailMask *= bd.y;
      float td = length(trailPos*max(.5, trailMask));
      float mainDrop = S(.2, .1, d);
      float dropTrail = S(.1, .02, td);
      dropTrail *= trailMask;
      o = mix(bd*mainDrop, trailPos, dropTrail);
      return o;
  }

  void CameraSetup(vec2 uv, vec3 pos, vec3 lookat, float zoom, float m) {
      ro = pos;
      vec3 f = normalize(lookat-ro);
      vec3 r = cross(vec3(0., 1., 0.), f);
      vec3 u = cross(f, r);
      float t = iTime;
      vec2 offs = vec2(0.);
      #ifdef RAIN
      vec2 dropUv = uv; 
      #ifdef HIGH_QUALITY
      float x = (sin(t*.1)*.5+.5)*.5;
      x = -x*x;
      float s = sin(x);
      float c = cos(x);
      mat2 rot = mat2(c, -s, s, c);
      dropUv = uv*rot;
      dropUv.x += -sin(t*.1)*.5;
      #endif
      offs = GetDrops(dropUv, 1., m);
      offs += GetDrops(dropUv*1.4, 10., m);
      #ifdef HIGH_QUALITY
      offs += GetDrops(dropUv*2.4, 25., m);
      #endif
      offs *= u_precipitation; 
      float ripple = sin(t+uv.y*3.1415*30.+uv.x*124.)*.5+.5;
      ripple *= .005 * u_precipitation;
      offs += vec2(ripple*ripple, ripple);
      #endif
      vec3 center = ro + f*zoom;
      vec3 i = center + (uv.x-offs.x)*r + (uv.y-offs.y)*u;
      rd = normalize(i-ro);
  }

  vec3 HeadLights(float i, float t) {
      float z = fract(-t*2.+i);
      vec3 p = vec3(-.3, .1, z*40.);
      float d = length(p-ro);
      
      float fogAmount = 0.0; // Fog disabled
      float size = mix(.03, .05, S(.02, .07, z)) * d;
      float m = 0.;
      float blur = .1; 
      
      m += BokehMask(ro, rd, p-vec3(.08, 0., 0.), size, blur);
      m += BokehMask(ro, rd, p+vec3(.08, 0., 0.), size, blur);
      
      #ifdef HIGH_QUALITY
      m += BokehMask(ro, rd, p+vec3(.1, 0., 0.), size, blur);
      m += BokehMask(ro, rd, p-vec3(.1, 0., 0.), size, blur);
      #endif
      
      float distFade = max(.01, pow(1.-z, 9.));
      
      blur = .8;
      size *= 2.5;
      float r = 0.;
      r += BokehMask(ro, rd, p+vec3(-.09, -.2, 0.), size, blur);
      r += BokehMask(ro, rd, p+vec3(.09, -.2, 0.), size, blur);
      r *= distFade*distFade;
      
      return headLightCol*(m+r)*distFade;
  }

  vec3 StreetLights(float i, float t) {
      float side = sign(rd.x);
      float offset = max(side, 0.)*(1./16.);
      float z = fract(i-t+offset); 
      vec3 p = vec3(2.*side, 2., z*60.);
      float d = length(p-ro);
      
      float blur = .1;
      float distFade = Remap(1., .7, .1, 1.5, 1.-pow(1.-z,6.));
      distFade *= (1.-z);
      
      float size = .05 * d;
      float m = BokehMask(ro, rd, p, size, blur) * distFade;
      
      return m*streetLightCol;
  }

  vec3 EnvironmentLights(float i, float t) {
      float n = N(i+floor(t));
      float side = sign(rd.x);
      float offset = max(side, 0.)*(1./16.);
      float z = fract(i-t+offset+fract(n*234.));
      float n2 = fract(n*100.);
      vec3 p = vec3((3.+n)*side, n2*n2*n2*1., z*60.);
      float d = length(p-ro);
      
      float blur = .1;
      float distFade = Remap(1., .7, .1, 1.5, 1.-pow(1.-z,6.));
      
      float size = .05 * d;
      float m = BokehMask(ro, rd, p, size, blur);
      m *= distFade*distFade*.5;
      m *= 1.-pow(sin(z*6.28*20.*n)*.5+.5, 20.);
      
      vec3 randomCol = vec3(fract(n*-34.5), fract(n*4572.), fract(n*1264.));
      vec3 col = mix(headLightCol, streetLightCol, fract(n*-65.42));
      col = mix(col, randomCol, n);
      return m*col*.2;
  }

  void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
      float t = iTime;
      vec3 col = vec3(0.);
      vec2 uv = fragCoord.xy / iResolution.xy;
      uv -= .5;
      uv.x *= iResolution.x/iResolution.y;
      vec2 mouse = iMouse.xy/iResolution.xy;
      vec3 pos = vec3(.3, .15, 0.);
      float bt = t * 5.;
      float h1 = N(floor(bt));
      float h2 = N(floor(bt+1.));
      float bumps = mix(h1, h2, fract(bt))*.1;
      bumps = bumps*bumps*bumps*CAM_SHAKE;
      pos.y += bumps;
      float lookatY = pos.y+bumps;
      vec3 lookat = vec3(0.3, lookatY, 1.);
      vec3 lookat2 = vec3(0., lookatY, .7);
      lookat = mix(lookat, lookat2, sin(t*.1)*.5+.5);
      uv.y += bumps*4.;
      CameraSetup(uv, pos, lookat, 2., mouse.x);
      t *= .03;
      t += mouse.x;
      for(float i=0.; i<1.; i+=STP1) { col += StreetLights(i, t); }
      for(float i=0.; i<1.; i+=STP1) { float n = N(i+floor(t)); col += HeadLights(i+n*STP1*.7, t); }
      for(float i=0.; i<1.; i+=STP2) { col += EnvironmentLights(i, t); }
      col += sat(rd.y)*vec3(.6, .5, .9);
      
      fragColor = vec4(col, 1.);
  }

  void main() {
      vec4 fragColor = vec4(0.0);
      mainImage(fragColor, gl_FragCoord.xy);
      gl_FragColor = fragColor;
  }
`;

const cloudyFragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_precipitation;
  uniform float u_visibility;

  #define iResolution u_resolution
  #define iTime u_time
  #define iMouse vec4(u_mouse.x, u_mouse.y, 0.0, 0.0)

  // 0: sunset look, 1: bright look
  #define LOOK 1

  mat3 setCamera( in vec3 ro, in vec3 ta, float cr ) {
      vec3 cw = normalize(ta-ro);
      vec3 cp = vec3(sin(cr), cos(cr),0.0);
      vec3 cu = normalize( cross(cw,cp) );
      vec3 cv = normalize( cross(cu,cw) );
      return mat3( cu, cv, cw );
  }

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  float noise( in vec3 x ) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f*f*(3.0-2.0*f);
      float n = p.x + p.y*57.0 + 113.0*p.z;
      return mix(mix(mix(hash(n+  0.0), hash(n+  1.0),f.x),
                     mix(hash(n+ 57.0), hash(n+ 58.0),f.x),f.y),
                 mix(mix(hash(n+113.0), hash(n+114.0),f.x),
                     mix(hash(n+170.0), hash(n+171.0),f.x),f.y),f.z) * 2.0 - 1.0;
  }

  #if LOOK==0
  float map( in vec3 p, int oct ) {
      vec3 q = p - vec3(0.0,0.1,1.0)*iTime;
      float g = 0.5+0.5*noise( q*0.3 );
      float f = 0.50000*noise( q ); q = q*2.02;
      if( oct>=2 ) f += 0.25000*noise( q ); q = q*2.23;
      if( oct>=3 ) f += 0.12500*noise( q ); q = q*2.41;
      if( oct>=4 ) f += 0.06250*noise( q ); q = q*2.62;
      if( oct>=5 ) f += 0.03125*noise( q ); 
      f = mix( f*0.1-0.5, f, g*g );
      return 1.5*f - 0.5 - p.y;
  }

  const vec3 sundir = vec3(0.7071, 0.0, -0.7071);

  vec4 raymarch( in vec3 ro, in vec3 rd, in vec3 bgcol, in vec2 px ) {
      float tmin = 0.0, tmax = 60.0;
      if( rd.y > 0.0 ) tmax = min( tmax, (0.6-ro.y)/rd.y );
      else if( rd.y < 0.0 ) tmax = min( tmax, (-3.0-ro.y)/rd.y );
      
      float t = tmin + 0.1*fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453);
      vec4 sum = vec4(0.0);
      for( int i=0; i<150; i++ ) {
          if( t>tmax || sum.a>0.99 ) break;
          float dt = max(0.05, 0.02*t);
          vec3 pos = ro + t*rd;
          int oct = 5 - int(log2(1.0+t*0.5));
          float den = map( pos, oct );
          if( den>0.01 ) {
              float dif = clamp((den - map(pos+0.3*sundir, oct))/0.25, 0.0, 1.0 );
              vec3 lin = vec3(0.65,0.65,0.75)*1.1 + 0.8*vec3(1.0,0.6,0.3)*dif;
              vec4 col = vec4( mix( vec3(1.0,0.93,0.84), vec3(0.25,0.3,0.4), den ), den );
              col.xyz *= lin;
              // Fog removed
              col.w = min(col.w*8.0*dt,1.0);
              col.rgb *= col.a;
              sum += col*(1.0-sum.a);
          }
          t += dt;
      }
      return clamp( sum, 0.0, 1.0 );
  }

  vec4 render( in vec3 ro, in vec3 rd, in vec2 px ) {
      float sun = clamp( dot(sundir,rd), 0.0, 1.0 );
      vec3 col = vec3(0.76,0.75,0.95) - 0.6*vec3(0.90,0.75,0.95)*rd.y;
      col += 0.2*vec3(1.00,0.60,0.10)*pow( sun, 8.0 );
      vec4 res = raymarch( ro, rd, col, px );
      col = col*(1.0-res.w) + res.xyz;
      col += 0.2*vec3(1.0,0.4,0.2)*pow( sun, 3.0 );
      col = smoothstep(0.15,1.1,col);
      return vec4( col, 1.0 );
  }

  #else

  float map5( in vec3 p ) {    
      vec3 q = p - vec3(0.0,0.1,1.0)*iTime;    
      float f = 0.50000*noise( q ); q = q*2.02;    
      f += 0.25000*noise( q ); q = q*2.03;    
      f += 0.12500*noise( q ); q = q*2.01;    
      f += 0.06250*noise( q ); q = q*2.02;    
      f += 0.03125*noise( q );    
      return clamp( 1.5 - p.y - 2.0 + 1.75*f, 0.0, 1.0 );
  }
  float map4( in vec3 p ) {    
      vec3 q = p - vec3(0.0,0.1,1.0)*iTime;    
      float f = 0.50000*noise( q ); q = q*2.02;    
      f += 0.25000*noise( q ); q = q*2.03;    
      f += 0.12500*noise( q ); q = q*2.01;   
      f += 0.06250*noise( q );    
      return clamp( 1.5 - p.y - 2.0 + 1.75*f, 0.0, 1.0 );
  }
  float map3( in vec3 p ) {
      vec3 q = p - vec3(0.0,0.1,1.0)*iTime;    
      float f = 0.50000*noise( q ); q = q*2.02;    
      f += 0.25000*noise( q ); q = q*2.03;    f += 0.12500*noise( q );    
      return clamp( 1.5 - p.y - 2.0 + 1.75*f, 0.0, 1.0 );
  }
  float map2( in vec3 p ) {    
      vec3 q = p - vec3(0.0,0.1,1.0)*iTime;    
      float f = 0.50000*noise( q ); q = q*2.02;    
      f += 0.25000*noise( q );
      return clamp( 1.5 - p.y - 2.0 + 1.75*f, 0.0, 1.0 );
  }

  const vec3 sundir = vec3(-0.7071,0.0,-0.7071);

  vec4 raymarch( in vec3 ro, in vec3 rd, in vec3 bgcol, in vec2 px ) {    
      vec4 sum = vec4(0.0);    
      float t = 0.05*fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453);    
      
      for(int i=0; i<30; i++) {
          vec3 pos = ro + t*rd;
          if( pos.y<-3.0 || pos.y>2.0 || sum.a>0.99 ) break;
          float den = map5( pos );
          if( den>0.01 ) {
              float dif = clamp((den - map5(pos+0.3*sundir))/0.6, 0.0, 1.0 );
              vec3 lin = vec3(1.0,0.6,0.3)*dif+vec3(0.91,0.98,1.05);
              vec4 col = vec4( mix( vec3(1.0,0.95,0.8), vec3(0.25,0.3,0.35), den ), den );
              col.xyz *= lin;
              // Fog removed
              col.w *= 0.4; col.rgb *= col.a;
              sum += col*(1.0-sum.a);
          }
          t += max(0.06,0.05*t);
      }
      for(int i=0; i<30; i++) {
          vec3 pos = ro + t*rd;
          if( pos.y<-3.0 || pos.y>2.0 || sum.a>0.99 ) break;
          float den = map4( pos );
          if( den>0.01 ) {
              float dif = clamp((den - map4(pos+0.3*sundir))/0.6, 0.0, 1.0 );
              vec3 lin = vec3(1.0,0.6,0.3)*dif+vec3(0.91,0.98,1.05);
              vec4 col = vec4( mix( vec3(1.0,0.95,0.8), vec3(0.25,0.3,0.35), den ), den );
              col.xyz *= lin;
              // Fog removed
              col.w *= 0.4; col.rgb *= col.a;
              sum += col*(1.0-sum.a);
          }
          t += max(0.06,0.05*t);
      }
      return clamp( sum, 0.0, 1.0 );
  }

  vec4 render( in vec3 ro, in vec3 rd, in vec2 px ) {
      float sun = clamp( dot(sundir,rd), 0.0, 1.0 );    
      vec3 col = vec3(0.6,0.71,0.75) - rd.y*0.2*vec3(1.0,0.5,1.0) + 0.15*0.5;    
      col += 0.2*vec3(1.0,.6,0.1)*pow( sun, 8.0 );    
      vec4 res = raymarch( ro, rd, col, px );    
      col = col*(1.0-res.w) + res.xyz;        
      col += vec3(0.2,0.08,0.04)*pow( sun, 3.0 );    
      return vec4( col, 1.0 );
  }
  #endif

  void main() {
      vec2 p = (2.0*gl_FragCoord.xy-iResolution.xy)/iResolution.y;
      vec2 m = iMouse.xy/iResolution.xy;
      vec3 ro = 4.0*normalize(vec3(sin(3.0*m.x), 0.8*m.y, cos(3.0*m.x))) - vec3(0.0,0.1,0.0);
      vec3 ta = vec3(0.0, -1.0, 0.0);
      mat3 ca = setCamera( ro, ta, 0.07*cos(0.25*iTime) );
      vec3 rd = ca * normalize( vec3(p.xy,1.5));
      
      gl_FragColor = render( ro, rd, gl_FragCoord.xy );
  }
`;

const sunnyFragmentShaderSource = `
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

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 centered = uv - 0.5;
    centered.x *= u_resolution.x / u_resolution.y;

    float phase = u_day_phase;
    float intensity = clamp(u_intensity, 0.0, 1.0);

    // Deep atmosphere gradient for Death Stranding aesthetic
    vec3 color = mix(bottomSky(phase), topSky(phase), smoothstep(0.05, 0.95, uv.y));

    // Horizon glow
    float horizonGlow = exp(-pow(max(uv.y - 0.12, 0.0) * 2.8, 2.0));
    if (phase < 0.5) {
      color += vec3(1.00, 0.58, 0.24) * horizonGlow * 0.32;
    } else if (phase < 2.5 && phase >= 2.0) {
      color += vec3(1.00, 0.24, 0.12) * horizonGlow * 0.28;
    }

    vec2 sunPos =
      phase < 0.5 ? vec2(-0.45, 0.18) :
      phase < 1.5 ? vec2(0.0, 0.65) :
      phase < 2.5 ? vec2(0.45, 0.16) :
      vec2(0.25, 0.62);

    if (phase < 3.0) {
      float disc = circle(centered, sunPos, 0.07, 0.02);
      float halo = circle(centered, sunPos, 0.25 + intensity * 0.1, 0.28);
      float bloom = circle(centered, sunPos, 0.5 + intensity * 0.2, 0.4);
      vec3 discCol = sunColor(phase);
      color += discCol * disc * (0.85 + intensity * 0.4);
      color += discCol * halo * (0.2 + intensity * 0.25);
      color += discCol * bloom * (0.08 + intensity * 0.15);
    } else {
      // Moon and stars for midnight
      float moon = circle(centered, sunPos, 0.055, 0.02);
      color += vec3(0.82, 0.88, 1.00) * moon * (0.75 + intensity * 0.2);
      
      vec2 starsUv = uv * u_resolution.xy / min(u_resolution.x, u_resolution.y);
      float stars = step(0.9982, hash21(floor(starsUv * 110.0)));
      stars *= 0.8 + 0.2 * sin(u_time * 0.8 + starsUv.x * 17.0);
      color += vec3(0.75, 0.85, 1.0) * stars * 0.6;
    }

    // Atmospheric Wisps (Darker, more cinematic clouds)
    vec2 cloudUvA = uv * vec2(2.5, 1.2);
    cloudUvA.x += u_time * (0.004 + intensity * 0.006);
    float wispsA = fbm(cloudUvA + vec2(u_time * 0.01, 1.5));
    wispsA = smoothstep(0.6, 0.8, wispsA);

    float cloudMask = wispsA * smoothstep(0.1, 0.9, uv.y) * (phase >= 3.0 ? 0.2 : 0.4 + intensity * 0.2);
    vec3 cloudTint = phase < 3.0 ? sunColor(phase) * 0.6 : vec3(0.15, 0.2, 0.35);
    color = mix(color, cloudTint, cloudMask * 0.45);

    // Vignette
    float vig = smoothstep(1.2, 0.4, length(centered));
    color *= 0.8 + 0.2 * vig;

    gl_FragColor = vec4(color, 1.0);
  }
`
;

const BackgroundShader: React.FC<BackgroundShaderProps> = ({ 
  weatherCondition = 'Rainy',
  precipitation = 80,
  dayPhase = 'noon',
  sunIntensity = 70
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ precipitation, dayPhase, sunIntensity });

  useEffect(() => {
    propsRef.current = { precipitation, dayPhase, sunIntensity };
  }, [precipitation, dayPhase, sunIntensity]);

  const phaseToValue = (phase: SunnyDayPhase) => {
    switch (phase) {
      case 'sunrise': return 0.0;
      case 'noon': return 1.0;
      case 'sunset': return 2.0;
      case 'midnight': return 3.0;
      default: return 1.0;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      console.error('WebGL is not supported by your browser.');
      return;
    }

    const compileShader = (glContext: WebGLRenderingContext | WebGL2RenderingContext, source: string, type: number) => {
      const shader = glContext.createShader(type);
      if (!shader) return null;
      glContext.shaderSource(shader, source);
      glContext.compileShader(shader);
      if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
        console.error('Shader compile error:', glContext.getShaderInfoLog(shader));
        glContext.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl as WebGLRenderingContext, vertexShaderSource, gl.VERTEX_SHADER);
    let fragmentShaderSource;
    if (weatherCondition === 'Rainy') {
        fragmentShaderSource = rainyFragmentShaderSource;
    } else if (weatherCondition === 'Cloudy') {
        fragmentShaderSource = cloudyFragmentShaderSource;
    } else {
        fragmentShaderSource = sunnyFragmentShaderSource;
    }
    const fragmentShader = compileShader(gl as WebGLRenderingContext, fragmentShaderSource, gl.FRAGMENT_SHADER);

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
      -1.0, -1.0,  1.0, -1.0, -1.0,  1.0,
      -1.0,  1.0,  1.0, -1.0,  1.0,  1.0
    ]);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const mouseLocation = gl.getUniformLocation(program, 'u_mouse');
    const precipitationLocation = gl.getUniformLocation(program, 'u_precipitation');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();

    let animationFrameId: number;
    const startTime = Date.now();

    const render = () => {
      const currentTime = (Date.now() - startTime) / 1000.0;
      
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, currentTime);
      gl.uniform2f(mouseLocation, 0, 0);
      gl.uniform1f(precipitationLocation, propsRef.current.precipitation / 100.0);

      const dayPhaseLocation = gl.getUniformLocation(program, 'u_day_phase');
      const intensityLocation = gl.getUniformLocation(program, 'u_intensity');
      if (dayPhaseLocation) gl.uniform1f(dayPhaseLocation, phaseToValue(propsRef.current.dayPhase));
      if (intensityLocation) gl.uniform1f(intensityLocation, propsRef.current.sunIntensity / 100.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [weatherCondition]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-[#0A0A0B]">
      {/* Base Minimalist Grid */}
      <div
        className="absolute inset-0 opacity-[0.02] z-0"
        style={{
          backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
          backgroundSize: '64px 64px'
        }}
      />

      {/* High-Performance WebGL Canvas for Shaders */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10 w-full h-full block"
      />
    </div>
  );
};

export default BackgroundShader;
