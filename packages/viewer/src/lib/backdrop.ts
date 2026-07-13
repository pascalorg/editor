import { abs, exp, mix, smoothstep } from 'three/tsl'

/**
 * Shared backdrop gradient: flat background looking down, a warm haze band
 * hugging the horizon, the theme sky arriving just above it and deepening
 * toward the zenith. One formula serves the post-processing backdrop and the
 * thumbnail pipeline (per-pixel view ray) AND the site horizon disc's
 * far-field dissolve (per-fragment view direction) — the disc converges to
 * exactly this colour, so ground and backdrop meet without a seam from any
 * camera pose.
 *
 * `dirY` is the world-space view direction's Y component (horizon = 0).
 * Colour inputs are TSL nodes (uniforms or literals).
 */
export function backdropGradient({
  dirY,
  background,
  haze,
  sky,
  skyDeep,
}: {
  dirY: any
  background: any
  haze: any
  sky: any
  skyDeep: any
}): any {
  // The pale sky arrives fast (full by ≈8° elevation) so eye-level frames
  // actually show it, then deepens toward the zenith for a real gradient —
  // a single pale stop reads as a white void with blue "hiding" up top.
  let base = (mix as any)(background, sky, smoothstep(-0.02, 0.14, dirY))
  base = (mix as any)(base, skyDeep, smoothstep(0.1, 0.55, dirY))
  // Haze as an exponential glow hugging the horizon tightly: C¹-smooth on
  // both sides, so it brightens the junction without ever drawing an edge.
  const hazeWeight = exp(abs(dirY).mul(-11)).mul(0.8)
  return (mix as any)(base, haze, hazeWeight)
}

// Warm sun tint the haze pulls toward — aerial perspective is sky-coloured
// light plus a little sun scatter, not white fog.
const HAZE_SUN_TINT = [255, 244, 222] as const

/**
 * Atmospheric haze at the horizon: the theme's *sky* colour pulled toward a
 * warm sun tint — skyish and sunish at once, so the band reads as part of
 * the sky rather than a white stripe. Dark themes keep it faint (a low glow
 * over the night zenith).
 */
export function horizonHazeColor(sky: string, appearance: 'light' | 'dark'): string {
  const amount = appearance === 'dark' ? 0.25 : 0.5
  const hex = sky.replace('#', '')
  let out = '#'
  for (let i = 0; i < 3; i++) {
    const c = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    out += Math.round(c + (HAZE_SUN_TINT[i]! - c) * amount)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

/**
 * Zenith colour derived from the theme's sky: saturated and darkened in HSL
 * so the hue stays the theme's own (blue studio, lavender sunset, near-black
 * night) while the top of the frame gets real colour depth.
 */
export function deepSkyColor(sky: string): string {
  const hex = sky.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }

  const s2 = Math.min(1, s * 1.5 + 0.05)
  const l2 = l * 0.72

  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l2 - c / 2
  const sector = Math.floor(h * 6) % 6
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]!
  let out = '#'
  for (const channel of rgb) {
    out += Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}
