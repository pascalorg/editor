import { abs, exp, mix, smoothstep } from 'three/tsl'

/**
 * Shared backdrop gradient: flat background looking down, an atmospheric haze
 * band hugging the horizon, sky zenith above. One formula serves the
 * post-processing backdrop and the thumbnail pipeline (per-pixel view ray)
 * AND the site horizon disc's far-field dissolve (per-fragment view
 * direction) — the disc converges to exactly this colour, so ground and
 * backdrop meet without a seam from any camera pose.
 *
 * `dirY` is the world-space view direction's Y component (horizon = 0).
 * Colour inputs are TSL nodes (uniforms or literals).
 */
export function backdropGradient({
  dirY,
  background,
  haze,
  sky,
}: {
  dirY: any
  background: any
  haze: any
  sky: any
}): any {
  // One gradient crossing the horizon smoothly, sky reaching down to it —
  // a flat plateau sandwiched between two ramps reads as Mach lines, and a
  // sky that only starts high leaves eye-level views all-white.
  const base = (mix as any)(background, sky, smoothstep(-0.02, 0.25, dirY))
  // Haze as an exponential glow peaking exactly at the horizon: C¹-smooth on
  // both sides, so it brightens the junction without ever drawing an edge.
  const hazeWeight = exp(abs(dirY).mul(-9)).mul(0.85)
  return (mix as any)(base, haze, hazeWeight)
}

/**
 * Atmospheric haze tint at the horizon: the theme background lifted toward
 * white. Light themes get a bright distance glow, dark themes a faint one
 * (reads as scattered city light).
 */
export function horizonHazeColor(background: string, appearance: 'light' | 'dark'): string {
  const amount = appearance === 'dark' ? 0.12 : 0.25
  const hex = background.replace('#', '')
  let out = '#'
  for (let i = 0; i < 3; i++) {
    const c = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255
    out += Math.round((c + (1 - c) * amount) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}
