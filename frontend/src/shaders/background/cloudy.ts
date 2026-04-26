import { ledTransitionShaderChunk } from './common';

export const cloudyFragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_precipitation;
  uniform float u_visibility;
  uniform float u_day_phase;
  ${ledTransitionShaderChunk}

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
      
      for(int i=0; i<18; i++) {
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
          t += max(0.09,0.07*t);
      }
      for(int i=0; i<10; i++) {
          vec3 pos = ro + t*rd;
          if( pos.y<-3.0 || pos.y>2.0 || sum.a>0.99 ) break;
          float den = map2( pos );
          if( den>0.01 ) {
              float dif = clamp((den - map2(pos+0.3*sundir))/0.6, 0.0, 1.0 );
              vec3 lin = vec3(1.0,0.6,0.3)*dif+vec3(0.91,0.98,1.05);
              vec4 col = vec4( mix( vec3(1.0,0.95,0.8), vec3(0.25,0.3,0.35), den ), den );
              col.xyz *= lin;
              // Fog removed
              col.w *= 0.4; col.rgb *= col.a;
              sum += col*(1.0-sum.a);
          }
          t += max(0.12,0.09*t);
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

  const float CLOUDY_NIGHT_PI = 3.141592654;
  const float CLOUDY_NIGHT_TAU = 6.283185307;
  const vec4 CLOUDY_NIGHT_HSV_K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);

  vec3 cloudyNightHsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + CLOUDY_NIGHT_HSV_K.xyz) * 6.0 - CLOUDY_NIGHT_HSV_K.www);
    return c.z * mix(CLOUDY_NIGHT_HSV_K.xxx, clamp(p - CLOUDY_NIGHT_HSV_K.xxx, 0.0, 1.0), c.y);
  }

  vec4 cloudyNightAlphaBlend(vec4 back, vec4 front) {
    float w = front.w + back.w * (1.0 - front.w);
    vec3 xyz = (front.xyz * front.w + back.xyz * back.w * (1.0 - front.w)) / max(w, 0.0001);
    return w > 0.0 ? vec4(xyz, w) : vec4(0.0);
  }

  vec3 cloudyNightAlphaBlend(vec3 back, vec4 front) {
    return mix(back, front.xyz, front.w);
  }

  float cloudyNightTanhApprox(float x) {
    float x2 = x * x;
    return clamp(x * (27.0 + x2) / (27.0 + 9.0 * x2), -1.0, 1.0);
  }

  vec3 cloudyNightTanhApprox(vec3 x) {
    return vec3(
      cloudyNightTanhApprox(x.x),
      cloudyNightTanhApprox(x.y),
      cloudyNightTanhApprox(x.z)
    );
  }

  float cloudyNightHash(float co) {
    return fract(sin(co * 12.9898) * 13758.5453);
  }

  float cloudyNightHash(vec2 p) {
    float a = dot(p, vec2(127.1, 311.7));
    return fract(sin(a) * 43758.5453123);
  }

  float cloudyNightVNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = cloudyNightHash(i + vec2(0.0, 0.0));
    float b = cloudyNightHash(i + vec2(1.0, 0.0));
    float c = cloudyNightHash(i + vec2(0.0, 1.0));
    float d = cloudyNightHash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float cloudyNightHiFbm(vec2 p) {
    float sum = 0.0;
    float a = 1.0;
    for (int i = 0; i < 5; i++) {
      sum += a * cloudyNightVNoise(p);
      a *= 0.5;
      p *= 2.0;
    }
    return sum;
  }

  float cloudyNightLoFbm(vec2 p) {
    float sum = 0.0;
    float a = 1.0;
    for (int i = 0; i < 2; i++) {
      sum += a * cloudyNightVNoise(p);
      a *= 0.5;
      p *= 2.0;
    }
    return sum;
  }

  float cloudyNightHiHeight(vec2 p) {
    return cloudyNightHiFbm(p) - 1.8;
  }

  float cloudyNightLoHeight(vec2 p) {
    return cloudyNightLoFbm(p) - 2.15;
  }

  vec4 cloudyNightPlane(vec3 ro, vec3 rd, vec3 pp, vec3 npp, vec3 off, float n) {
    float h = cloudyNightHash(n);
    vec2 p = (pp - off * 2.0 * vec3(1.0, 1.0, 0.0)).xy;

    vec2 stp = vec2(0.5, 0.33);
    float he = cloudyNightHiHeight(vec2(p.x, pp.z) * stp);
    float lohe = cloudyNightLoHeight(vec2(p.x, pp.z) * stp);
    float d = p.y - he;
    float lod = p.y - lohe;

    float aa = distance(pp, npp) * sqrt(1.0 / 3.0);
    float t = smoothstep(aa, -aa, d);

    float df = exp(-0.1 * (distance(ro, pp) - 2.0));
    vec3 acol = cloudyNightHsv2rgb(vec3(mix(0.9, 0.6, df), 0.9, mix(1.0, 0.0, df)));
    vec3 gcol = cloudyNightHsv2rgb(vec3(0.6, 0.5, cloudyNightTanhApprox(exp(-mix(2.0, 8.0, df) * lod))));

    vec3 col = vec3(0.0);
    col += acol;
    col += 0.5 * gcol;
    col *= mix(0.9, 1.12, h);

    return vec4(col, t);
  }

  vec3 cloudyNightToSpherical(vec3 p) {
    float r = length(p);
    float t = acos(p.z / r);
    float ph = atan(p.y, p.x);
    return vec3(r, t, ph);
  }

  const vec3 cloudyNightLightDir = vec3(0.0, -0.14834045, 0.98893635);

  vec3 cloudyNightSkyColor(vec3 ro, vec3 rd) {
    vec3 acol = cloudyNightHsv2rgb(vec3(0.6, 0.9, 0.075));
    vec3 lcol = cloudyNightHsv2rgb(vec3(0.75, 0.8, 1.0));
    vec2 sp = cloudyNightToSpherical(rd.xzy).yz;

    float lf = pow(max(dot(cloudyNightLightDir, rd), 0.0), 80.0);
    float li = 0.02 * mix(1.0, 10.0, lf) / (abs(rd.y + 0.055) + 0.025);

    vec3 col = vec3(0.0);
    col += smoothstep(-0.4, 0.0, sp.x - CLOUDY_NIGHT_PI * 0.5) * acol;
    col += cloudyNightTanhApprox(lcol * li);
    return col;
  }

  vec3 cloudyNightColor(vec3 ww, vec3 uu, vec3 vv, vec3 ro, vec2 p) {
    vec2 np = p + 2.0 / u_resolution.y;
    float rdd = 2.0;
    vec3 rd = normalize(p.x * uu + p.y * vv + rdd * ww);
    vec3 nrd = normalize(np.x * uu + np.y * vv + rdd * ww);

    const float planeDist = 1.0;
    const int furthest = 12;
    const int fadeFrom = 10;
    const float fadeDist = planeDist * float(fadeFrom);
    const float maxDist = planeDist * float(furthest);
    float nz = floor(ro.z / planeDist);

    vec3 skyCol = cloudyNightSkyColor(ro, rd);
    vec4 acol = vec4(0.0);
    const float cutOff = 0.95;

    for (int i = 1; i <= furthest; i++) {
      float pz = planeDist * nz + planeDist * float(i);
      float pd = (pz - ro.z) / rd.z;
      vec3 pp = ro + rd * pd;

      if (pp.y < 0.0 && pd > 0.0 && acol.w < cutOff) {
        vec3 npp = ro + nrd * pd;
        vec4 pcol = cloudyNightPlane(ro, rd, pp, npp, vec3(0.0), nz + float(i));
        float fadeIn = smoothstep(maxDist, fadeDist, pd);
        pcol.xyz = mix(skyCol, pcol.xyz, fadeIn);
        pcol = clamp(pcol, 0.0, 1.0);
        acol = cloudyNightAlphaBlend(pcol, acol);
      } else {
        acol.w = acol.w > cutOff ? 1.0 : acol.w;
        break;
      }
    }

    return cloudyNightAlphaBlend(skyCol, acol);
  }

  vec3 cloudyNightEffect(vec2 p) {
    float tm = u_time * 0.25;
    vec3 ro = vec3(0.0, 0.0, tm);
    vec3 dro = normalize(vec3(0.0, 0.09, 1.0));
    vec3 ww = normalize(dro);
    vec3 uu = normalize(cross(normalize(vec3(0.0, 1.0, 0.0)), ww));
    vec3 vv = normalize(cross(ww, uu));
    return cloudyNightColor(ww, uu, vv, ro, p);
  }

  vec3 cloudyNightAcesApprox(vec3 v) {
    v = max(v, 0.0);
    v *= 0.6;
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((v * (a * v + b)) / (v * (c * v + d) + e), 0.0, 1.0);
  }

  vec4 renderCloudyNight(vec2 fragCoord) {
    vec2 q = fragCoord / u_resolution.xy;
    vec2 p = -1.0 + 2.0 * q;
    p.x *= u_resolution.x / u_resolution.y;
    vec3 col = cloudyNightEffect(p);
    col *= smoothstep(0.0, 2.5, u_time + 0.8 - abs(q.y));
    col = cloudyNightAcesApprox(col);
    return vec4(col, 1.0);
  }

  void main() {
      vec2 fragCoord = getTransitionFragCoord(gl_FragCoord.xy);
      if (u_day_phase >= 3.0) {
          vec4 color = renderCloudyNight(fragCoord);
          color.rgb = applyLedTransition(color.rgb, gl_FragCoord.xy);
          gl_FragColor = color;
          return;
      }

      vec2 p = (2.0*fragCoord-iResolution.xy)/iResolution.y;
      vec2 m = iMouse.xy/iResolution.xy;
      vec3 ro = 4.0*normalize(vec3(sin(3.0*m.x), 0.8*m.y, cos(3.0*m.x))) - vec3(0.0,0.1,0.0);
      vec3 ta = vec3(0.0, -1.0, 0.0);
      mat3 ca = setCamera( ro, ta, 0.07*cos(0.25*iTime) );
      vec3 rd = ca * normalize( vec3(p.xy,1.5));
      
      vec4 color = render( ro, rd, fragCoord );
      color.rgb = applyLedTransition(color.rgb, gl_FragCoord.xy);
      gl_FragColor = color;
  }
`;
