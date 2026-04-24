import { useMemo, type CSSProperties } from 'react';

export type DesignViewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  frameStyle: CSSProperties;
};

export function useDesignViewport(
  viewportWidth: number,
  viewportHeight: number,
  designWidth: number,
  designHeight: number,
): DesignViewport {
  return useMemo(() => {
    const safeViewportWidth = Math.max(1, viewportWidth || designWidth);
    const safeViewportHeight = Math.max(1, viewportHeight || designHeight);
    const scaleX = safeViewportWidth / designWidth;
    const scaleY = safeViewportHeight / designHeight;
    const scale = Math.max(0.1, Math.min(scaleX, scaleY));
    const width = designWidth;
    const height = designHeight;
    const offsetX = (safeViewportWidth - width * scale) / 2;
    const offsetY = (safeViewportHeight - height * scale) / 2;

    return {
      scale,
      offsetX,
      offsetY,
      width,
      height,
      frameStyle: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
        transformOrigin: 'top left',
      },
    };
  }, [viewportWidth, viewportHeight, designWidth, designHeight]);
}
