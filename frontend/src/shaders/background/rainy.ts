import { ledTransitionShaderChunk } from './common';

export const rainyFragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_precipitation;
  uniform float u_visibility;
  uniform float u_day_phase;
  uniform sampler2D u_rain_day_texture;
  ${ledTransitionShaderChunk}

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

  vec3 rainDayN13(float p) {
     vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
     p3 += dot(p3, p3.yzx + 19.19);
     return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
  }

  float rainDayN(float t) {
      return fract(sin(t*12345.564)*7658.76);
  }

  float rainDaySaw(float b, float t) {
      return S(0., b, t)*S(1., b, t);
  }

  vec2 rainDayDropLayer2(vec2 uv, float t) {
      vec2 UV = uv;
      uv.y += t*0.75;
      vec2 a = vec2(6., 1.);
      vec2 grid = a*2.;
      vec2 id = floor(uv*grid);

      float colShift = rainDayN(id.x);
      uv.y += colShift;

      id = floor(uv*grid);
      vec3 n = rainDayN13(id.x*35.2+id.y*2376.1);
      vec2 st = fract(uv*grid)-vec2(.5, 0);

      float x = n.x-.5;
      float y = UV.y*20.;
      float wiggle = sin(y+sin(y));
      x += wiggle*(.5-abs(x))*(n.z-.5);
      x *= .7;

      float ti = fract(t+n.z);
      y = (rainDaySaw(.85, ti)-.5)*.9+.5;
      vec2 p = vec2(x, y);
      float d = length((st-p)*a.yx);
      float mainDrop = S(.4, .0, d);

      float r = sqrt(S(1., y, st.y));
      float cd = abs(st.x-x);
      float trail = S(.23*r, .15*r*r, cd);
      float trailFront = S(-.02, .02, st.y-y);
      trail *= trailFront*r*r;

      y = UV.y;
      float trail2 = S(.2*r, .0, cd);
      float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
      y = fract(y*10.)+(st.y-.5);
      float dd = length(st-vec2(x, y));
      droplets = S(.3, 0., dd);
      float m = mainDrop+droplets*r*trailFront;

      return vec2(m, trail);
  }

  float rainDayStaticDrops(vec2 uv, float t) {
      uv *= 40.;

      vec2 id = floor(uv);
      uv = fract(uv)-.5;
      vec3 n = rainDayN13(id.x*107.45+id.y*3543.654);
      vec2 p = (n.xy-.5)*.7;
      float d = length(uv-p);

      float fade = rainDaySaw(.025, fract(t+n.z));
      float c = S(.3, 0., d)*fract(n.z*10.)*fade;
      return c;
  }

  vec2 rainDayDrops(vec2 uv, float t, float l0, float l1, float l2) {
      float s = rainDayStaticDrops(uv, t)*l0;
      vec2 m1 = rainDayDropLayer2(uv, t)*l1;
      vec2 m2 = rainDayDropLayer2(uv*1.85, t)*l2;

      float c = s+m1.x+m2.x;
      c = S(.3, 1., c);

      return vec2(c, max(m1.y*l0, m2.y*l1));
  }

  vec3 sampleRainDayTexture(vec2 uv, float blur) {
      vec2 safeUv = clamp(uv, vec2(.001), vec2(.999));
      vec2 px = (0.75 + blur*1.15) / u_resolution.xy;
      vec2 minUv = vec2(.001);
      vec2 maxUv = vec2(.999);

      vec3 col = texture2D(u_rain_day_texture, safeUv).rgb*.36;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(1., 0.), minUv, maxUv)).rgb*.12;
      col += texture2D(u_rain_day_texture, clamp(safeUv - px*vec2(1., 0.), minUv, maxUv)).rgb*.12;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(0., 1.), minUv, maxUv)).rgb*.12;
      col += texture2D(u_rain_day_texture, clamp(safeUv - px*vec2(0., 1.), minUv, maxUv)).rgb*.12;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(1., 1.), minUv, maxUv)).rgb*.04;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(-1., 1.), minUv, maxUv)).rgb*.04;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(1., -1.), minUv, maxUv)).rgb*.04;
      col += texture2D(u_rain_day_texture, clamp(safeUv + px*vec2(-1., -1.), minUv, maxUv)).rgb*.04;
      return col;
  }

  vec4 renderRainDay(vec2 fragCoord) {
      vec2 uv = (fragCoord.xy-.5*u_resolution.xy) / u_resolution.y;
      vec2 UV = fragCoord.xy/u_resolution.xy;
      float T = u_time+18.;
      float t = T*.22;
      float rainAmount = clamp(.48+u_precipitation*.62, .48, 1.);

      uv = (uv+vec2(.03, -.08))*1.15;
      UV = (UV-.5)*vec2(1.06, 1.03)+.5;

      float staticDrops = S(-.5, 1., rainAmount)*2.;
      float layer1 = S(.25, .75, rainAmount);
      float layer2 = S(.0, .5, rainAmount);

      vec2 c = rainDayDrops(uv, t, staticDrops, layer1, layer2);
      vec2 e = vec2(.001, 0.);
      float cx = rainDayDrops(uv+e, t, staticDrops, layer1, layer2).x;
      float cy = rainDayDrops(uv+e.yx, t, staticDrops, layer1, layer2).x;
      vec2 n = vec2(cx-c.x, cy-c.x)*mix(.28, .62, rainAmount);

      float maxBlur = mix(3., 6., rainAmount);
      float minBlur = 2.;
      float focus = clamp(mix(maxBlur-c.y, minBlur, S(.1, .2, c.x)), 1.2, 6.5);
      vec3 col = sampleRainDayTexture(UV+n, focus);

      float waterMask = clamp(c.x, 0., 1.);
      float trailMask = clamp(c.y, 0., 1.);
      vec3 rainTint = vec3(.62, .72, .86);
      col *= mix(vec3(1.04, .99, .92), vec3(.78, .88, 1.08), rainAmount*.45);

      float fog = clamp(.18+rainAmount*.42-trailMask*.26-waterMask*.12, 0., .70);
      col = mix(col, rainTint, fog);
      col += vec3(.88, .94, 1.)*waterMask*.15;
      col += vec3(.45, .58, .75)*trailMask*.10;

      vec2 vignetteUv = UV-.5;
      col *= 1.-dot(vignetteUv, vignetteUv)*.62;
      col += vec3(.06, .08, .11)*smoothstep(-.25, .6, uv.y)*.08;

      return vec4(max(col, vec3(0.)), 1.);
  }

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
      vec2 fragCoord = getTransitionFragCoord(gl_FragCoord.xy);
      if (u_day_phase < 3.0) {
          fragColor = renderRainDay(fragCoord);
      } else {
          mainImage(fragColor, fragCoord);
      }
      fragColor.rgb = applyLedTransition(fragColor.rgb, gl_FragCoord.xy);
      gl_FragColor = fragColor;
  }
`;
