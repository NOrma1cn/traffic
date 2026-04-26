import React, { useEffect, useRef, useState } from 'react';
import {
  cloudyFragmentShaderSource,
  rainyFragmentShaderSource,
  sunnyFragmentShaderSource,
  vertexShaderSource,
} from '../shaders/background';

export type SunnyDayPhase = 'sunrise' | 'noon' | 'sunset' | 'midnight';

interface BackgroundShaderProps {
  weatherCondition?: 'Sunny' | 'Cloudy' | 'Rainy';
  precipitation?: number;
  dayPhase?: SunnyDayPhase;
  sunIntensity?: number;
  ledMode?: boolean;
  isActive?: boolean;
  onFpsUpdate?: (fps: number) => void;
}

const WEATHER_BLACKOUT_FADE_MS = 420;
const WEATHER_BLACKOUT_HOLD_MS = 90;
const RAIN_DAY_TEXTURE_URL = '/textures/rain-day-bg.webp';

function getBackgroundRenderScale(
  weatherCondition: BackgroundShaderProps['weatherCondition'],
  dayPhase: BackgroundShaderProps['dayPhase'],
) {
  if (weatherCondition === 'Cloudy' && dayPhase === 'midnight') return 0.62;
  if (weatherCondition === 'Cloudy') return 0.46;
  if (weatherCondition === 'Rainy') return 0.72;
  if (weatherCondition === 'Sunny' && dayPhase === 'midnight') return 0.62;
  return 1;
}

function easeInOutCubic(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const BackgroundShader: React.FC<BackgroundShaderProps> = ({ 
  weatherCondition = 'Rainy',
  precipitation = 80,
  dayPhase = 'noon',
  sunIntensity = 70,
  ledMode = false,
  isActive = true,
  onFpsUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderedWeatherCondition, setRenderedWeatherCondition] = useState(weatherCondition);
  const [isWeatherBlackoutVisible, setIsWeatherBlackoutVisible] = useState(false);
  const propsRef = useRef({ precipitation, dayPhase, sunIntensity, ledMode });
  const fpsUpdateRef = useRef(onFpsUpdate);
  const renderedWeatherConditionRef = useRef(weatherCondition);
  const weatherFadeTimersRef = useRef<number[]>([]);

  const clearWeatherFadeTimers = () => {
    weatherFadeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    weatherFadeTimersRef.current = [];
  };

  useEffect(() => {
    propsRef.current = { precipitation, dayPhase, sunIntensity, ledMode };
  }, [precipitation, dayPhase, sunIntensity, ledMode]);

  useEffect(() => {
    fpsUpdateRef.current = onFpsUpdate;
  }, [onFpsUpdate]);

  useEffect(() => {
    if (weatherCondition === renderedWeatherConditionRef.current) {
      setIsWeatherBlackoutVisible(false);
      return;
    }

    clearWeatherFadeTimers();
    setIsWeatherBlackoutVisible(true);

    const swapTimer = window.setTimeout(() => {
      renderedWeatherConditionRef.current = weatherCondition;
      setRenderedWeatherCondition(weatherCondition);

      const revealTimer = window.setTimeout(() => {
        setIsWeatherBlackoutVisible(false);
      }, WEATHER_BLACKOUT_HOLD_MS);

      weatherFadeTimersRef.current = [revealTimer];
    }, WEATHER_BLACKOUT_FADE_MS);

    weatherFadeTimersRef.current = [swapTimer];

    return clearWeatherFadeTimers;
  }, [weatherCondition]);

  useEffect(() => clearWeatherFadeTimers, []);

  useEffect(() => {
    if (isActive) return;
    fpsUpdateRef.current?.(0);
  }, [isActive]);

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
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderScale = getBackgroundRenderScale(renderedWeatherCondition, dayPhase);
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
    if (renderedWeatherCondition === 'Rainy') {
        fragmentShaderSource = rainyFragmentShaderSource;
    } else if (renderedWeatherCondition === 'Cloudy') {
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
    const dayPhaseLocation = gl.getUniformLocation(program, 'u_day_phase');
    const intensityLocation = gl.getUniformLocation(program, 'u_intensity');
    const transitionLocation = gl.getUniformLocation(program, 'u_transition');
    const rainDayTextureLocation = gl.getUniformLocation(program, 'u_rain_day_texture');

    let rainDayTexture: WebGLTexture | null = null;
    let isDisposed = false;

    if (rainDayTextureLocation) {
      rainDayTexture = gl.createTexture();
      if (rainDayTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rainDayTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([22, 28, 38, 255]),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(rainDayTextureLocation, 0);

        const image = new Image();
        image.onload = () => {
          if (isDisposed || !rainDayTexture) return;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, rainDayTexture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        };
        image.onerror = () => {
          console.warn('Rain day texture failed to load:', RAIN_DAY_TEXTURE_URL);
        };
        image.src = RAIN_DAY_TEXTURE_URL;
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * renderScale));
      canvas.height = Math.max(1, Math.round(rect.height * renderScale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();

    let animationFrameId: number;
    const startTime = Date.now();
    let currentTransition = propsRef.current.ledMode ? 1.0 : 0.0;
    let transitionTarget = currentTransition;
    let transitionStartValue = currentTransition;
    let transitionStartedAt = performance.now();
    let fpsFrames = 0;
    let fpsSampleStartedAt = performance.now();
    const transitionDurationMs = 1200;

    const render = () => {
      const currentTime = (Date.now() - startTime) / 1000.0;
      const now = performance.now();
      const nextTarget = propsRef.current.ledMode ? 1.0 : 0.0;
      if (nextTarget !== transitionTarget) {
        transitionStartValue = currentTransition;
        transitionTarget = nextTarget;
        transitionStartedAt = now;
      }
      const transitionProgress = Math.min((now - transitionStartedAt) / transitionDurationMs, 1);
      currentTransition = transitionStartValue + (transitionTarget - transitionStartValue) * easeInOutCubic(transitionProgress);
      fpsFrames += 1;

      if (now - fpsSampleStartedAt >= 250) {
        const sampledFps = (fpsFrames * 1000) / Math.max(now - fpsSampleStartedAt, 1);
        fpsUpdateRef.current?.(Math.round(sampledFps));
        fpsFrames = 0;
        fpsSampleStartedAt = now;
      }
      
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, currentTime);
      gl.uniform2f(mouseLocation, 0, 0);
      gl.uniform1f(precipitationLocation, propsRef.current.precipitation / 100.0);
      if (dayPhaseLocation) gl.uniform1f(dayPhaseLocation, phaseToValue(propsRef.current.dayPhase));
      if (intensityLocation) gl.uniform1f(intensityLocation, propsRef.current.sunIntensity / 100.0);
      if (transitionLocation) gl.uniform1f(transitionLocation, currentTransition);
      if (rainDayTexture && rainDayTextureLocation) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rainDayTexture);
        gl.uniform1i(rainDayTextureLocation, 0);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      isDisposed = true;
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
      if (rainDayTexture) gl.deleteTexture(rainDayTexture);
      fpsUpdateRef.current?.(0);
    };
  }, [renderedWeatherCondition, isActive, dayPhase]);

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
      <div
        className="absolute inset-0 z-20 bg-[#030305]"
        style={{
          opacity: isWeatherBlackoutVisible ? 1 : 0,
          transition: `opacity ${WEATHER_BLACKOUT_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          willChange: 'opacity',
        }}
      />
    </div>
  );
};

export default BackgroundShader;
