export const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

export const ledTransitionShaderChunk = `
  uniform float u_transition;

  float ledPixelSize() {
    return u_resolution.y / 156.0;
  }

  vec2 getTransitionFragCoord(vec2 fragCoord) {
    float pixelSize = ledPixelSize();
    vec2 gridCoord = fragCoord / pixelSize;
    vec2 pixelCenter = (floor(gridCoord) + 0.5) * pixelSize;
    return mix(fragCoord, pixelCenter, u_transition);
  }

  vec3 applyLedTransition(vec3 baseColor, vec2 fragCoord) {
    float pixelSize = ledPixelSize();
    vec2 gridCoord = fragCoord / pixelSize;
    vec2 localPos = fract(gridCoord) - 0.5;
    vec2 diodePos = localPos * vec2(0.9, 1.08);
    float diodeDist = length(diodePos);

    float ledMask = smoothstep(0.50, 0.16, diodeDist);
    float ledGlow = smoothstep(0.62, 0.0, diodeDist) * 0.055;
    float finalGlow = mix(0.0, ledGlow, u_transition);

    float diodeMask = mix(1.0, 0.82 + ledMask * 0.22 + finalGlow, u_transition);
    vec3 finalColor = baseColor * diodeMask;

    // Prevent highlight channel clipping from washing hues to white in LED mode.
    // (If values exceed 1.0, scale down proportionally to preserve chroma.)
    if (u_transition > 0.001) {
      float maxC = max(finalColor.r, max(finalColor.g, finalColor.b));
      if (maxC > 1.0) finalColor /= maxC;
    }

    finalColor *= mix(1.0, 0.78, u_transition);

    return finalColor;
  }
`;
