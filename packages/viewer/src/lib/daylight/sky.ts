import { Color, MathUtils, Vector3 } from 'three'
import {
  abs,
  clamp,
  dot,
  exp,
  float,
  floor,
  hash,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  pow,
  select,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'
import type { SolarLight } from './solar'

/**
 * Art-directed daylight sky. The palette is keyed on sun elevation (not the clock) so any
 * location/date gets a sensible golden hour, blue hour and night. One radiance function feeds
 * the visible sky, the image-based lighting and the CPU meters, so the light always matches what
 * you see. The visible sky carries fbm clouds; lighting uses their statistical average (no
 * per-pixel noise on every surface).
 */

type Stop = { el: number; top: string; horizon: string; ground: string; glow: string }

const STOPS: Stop[] = [
  { el: -18, top: '#050b18', horizon: '#1b2232', ground: '#0c1016', glow: '#1b2232' },
  { el: -8, top: '#0b1731', horizon: '#424b64', ground: '#17202a', glow: '#4a4f6a' },
  { el: -3, top: '#2f4470', horizon: '#9a8aa0', ground: '#3e434f', glow: '#d98c6c' },
  { el: 1, top: '#4e638b', horizon: '#e5a38b', ground: '#5d626e', glow: '#f08a52' },
  { el: 7, top: '#5d7fae', horizon: '#ecc6a4', ground: '#8d8c7e', glow: '#f3b070' },
  { el: 18, top: '#5b88b8', horizon: '#d8e2e3', ground: '#aeb3a0', glow: '#efd9b8' },
  { el: 45, top: '#4f82b8', horizon: '#d4e1e6', ground: '#b4b9a6', glow: '#e8e6dc' },
]

/** Cloud cover per weather preset (0 clear … 1 overcast). */
export const WEATHER_COVER = { clear: 0, fair: 0.45, cloudy: 0.7, overcast: 0.9 } as const
export type Weather = keyof typeof WEATHER_COVER

const scratchA = new Color()
const scratchB = new Color()

function lerpStops(el: number, key: keyof Omit<Stop, 'el'>, out: Color) {
  const first = STOPS[0]!
  const last = STOPS[STOPS.length - 1]!
  if (el <= first.el) return out.set(first[key])
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!
    const b = STOPS[i + 1]!
    if (el <= b.el) {
      return out
        .copy(scratchA.set(a[key]))
        .lerp(scratchB.set(b[key]), MathUtils.smoothstep(el, a.el, b.el))
    }
  }
  return out.set(last[key])
}

export function createDaylightSky() {
  const top = uniform(new Color())
  const horizon = uniform(new Color())
  const ground = uniform(new Color())
  const glow = uniform(new Color())
  const sunDir = uniform(new Vector3(0, 1, 0))
  const sunColor = uniform(new Color(1, 1, 1))
  const sunVisible = uniform(1)
  const night = uniform(0)
  const cover = uniform(WEATHER_COVER.fair)
  const cloudTime = uniform(0)

  /** Gradient + warm band towards the sun + overcast greying (shared by every sampler). */
  const base = (dir: any) => {
    const y = dir.y
    const gradient = mix(horizon, select(y.greaterThanEqual(0), top, ground), pow(abs(y), 0.55))
    const sunFlat = normalize(vec3(sunDir.x, 0.0001, sunDir.z))
    const toward = max(dot(normalize(vec3(dir.x, 0, dir.z)), sunFlat), 0)
    const banded = mix(gradient, glow, exp(abs(y).mul(-6)).mul(pow(toward, 3)).mul(0.75))
    const lum = dot(banded, vec3(0.2126, 0.7152, 0.0722))
    const grey = vec3(lum).mul(1.08).add(sunColor.mul(sunVisible).mul(0.06))
    return mix(
      banded,
      grey,
      cover
        .mul(cover)
        .mul(0.75)
        .mul(smoothstep(-0.2, 0.05, y)),
    )
  }

  const cloudColor = () => {
    const ambient = mix(horizon, top, 0.35).mul(0.95)
    const dusk = glow.mul(float(1).sub(sunVisible)).mul(0.5).mul(float(1).sub(night))
    return { ambient, dusk }
  }

  /**
   * Stars: one in a few hundred cells of a fine grid on the sphere, each a small round dot at a
   * jittered spot in its cell. The cell index is offset positive before hashing (the hash reads
   * its seed as an unsigned int, so negative cells all hashed alike and half the sky had none)
   * and kept under 2^24 so the float seed stays exact. Most stars sit below the bloom threshold
   * at night exposure; only the brightest few cross it, for a faint glow.
   */
  const STAR_GRID = 450
  const stars = (dir: any): any => {
    const grid: any = dir.mul(STAR_GRID)
    const cell: any = floor(grid).add(STAR_GRID + 1)
    const seed: any = cell.x.add(cell.y.mul(311)).add(cell.z.mul(17123))
    const presence = smoothstep(0.9968, 1, hash(seed))
    const magnitude = presence.mul(presence)
    const jitter = vec3(hash(seed.add(101)), hash(seed.add(211)), hash(seed.add(307)))
      .sub(0.5)
      .mul(0.5)
    const offset = grid.sub(floor(grid)).sub(0.5).sub(jitter)
    const radius = mix(float(0.2), float(0.4), magnitude)
    const dot = float(1).sub(smoothstep(radius.mul(0.35), radius, offset.length()))
    return dot
      .mul(presence)
      .mul(mix(float(0.12), float(0.6), magnitude))
      .mul(night)
      .mul(smoothstep(0.05, 0.3, dir.y))
  }

  /**
   * Visible sky: fbm clouds (self-shadowed towards the sun), aureole, AA'd sun disc, stars.
   * `disc: false` is the environment capture: aureole kept, disc and stars off (the sun is the
   * directional light — no double specular sun).
   */
  const skyRadiance = (rawDir: any, { disc: withDisc = true }: { disc?: boolean } = {}): any => {
    const dir: any = normalize(rawDir)
    const y = dir.y
    const proj = vec2(dir.x, dir.z)
      .div(max(y, 0).add(0.12))
      .mul(0.6)
      .add(vec2(cloudTime.mul(0.006), cloudTime.mul(0.0025)))
    const noiseAt = (q: any) =>
      mx_fractal_noise_float(vec3(q.x, q.y, 0.37), 5, 2, 0.5)
        .mul(0.5)
        .add(0.5)
    const thresh = float(0.8).sub(cover.mul(0.56))
    const dens = smoothstep(thresh.sub(0.06), thresh.add(0.2), noiseAt(proj))
    const toSun = normalize(vec2(sunDir.x, sunDir.z).add(vec2(1e-4, 0)))
    const occl = smoothstep(thresh.sub(0.06), thresh.add(0.2), noiseAt(proj.add(toSun.mul(0.08))))
    const { ambient, dusk } = cloudColor()
    const lit = sunColor.mul(sunVisible).mul(clamp(float(1.15).sub(occl.mul(0.75)), 0.25, 1.15))
    const cloud = ambient
      .mul(0.55)
      .add(lit.mul(0.85))
      .add(dusk)
      .mul(mix(float(1), float(0.72), cover.mul(cover)))
    const cloudA = dens.mul(smoothstep(0.015, 0.16, y)).mul(0.96)
    const col = mix(base(dir), cloud, cloudA)
    const align = dot(dir, sunDir)
    const aureole = exp(align.sub(1).mul(110))
      .mul(0.2)
      .add(exp(align.sub(1).mul(8)).mul(0.08))
    const disc = withDisc
      ? smoothstep(0.99996, 0.999985, align).mul(40).mul(float(1).sub(cloudA))
      : float(0)
    const sun = sunColor
      .mul(aureole.add(disc))
      .mul(sunVisible)
      .mul(smoothstep(-0.01, 0.02, y))
      .mul(float(1).sub(cover.mul(0.6)))
    if (!withDisc) return col.add(sun)
    return col.add(sun).add(vec3(stars(dir).mul(float(1).sub(cloudA))))
  }

  /** Lighting sky: clouds as their coverage-weighted average (smooth, cheap, sun-free). */
  const lightRadiance = (rawDir: any): any => {
    const dir: any = normalize(rawDir)
    const { ambient, dusk } = cloudColor()
    const cloud = ambient
      .mul(0.55)
      .add(sunColor.mul(sunVisible).mul(0.68))
      .add(dusk)
      .mul(float(1).sub(cover.mul(cover).mul(0.28)))
    const cloudA = cover
      .mul(0.85)
      .min(1)
      .mul(smoothstep(0.015, 0.16, dir.y))
      .mul(0.7)
    return mix(base(dir), cloud, cloudA)
  }

  /** CPU mirror of the sky (statistical clouds, aureole, no disc) for meters and window portals. */
  const radianceCpu = (dir: Vector3, out = new Color()) => {
    const d = dir.clone().normalize()
    const t = top.value as Color
    const h = horizon.value as Color
    out.copy(h).lerp(d.y >= 0 ? t : (ground.value as Color), Math.abs(d.y) ** 0.55)
    const sd = sunDir.value as Vector3
    const flat = new Vector3(sd.x, 0.0001, sd.z).normalize()
    const toward = Math.max(new Vector3(d.x, 0, d.z).normalize().dot(flat), 0)
    out.lerp(glow.value as Color, Math.exp(-6 * Math.abs(d.y)) * toward ** 3 * 0.75)
    const c = cover.value as number
    const sv = sunVisible.value as number
    const sc = sunColor.value as Color
    const lum = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b
    const above = MathUtils.smoothstep(d.y, -0.2, 0.05)
    out.lerp(
      new Color(
        lum * 1.08 + sc.r * sv * 0.06,
        lum * 1.08 + sc.g * sv * 0.06,
        lum * 1.08 + sc.b * sv * 0.06,
      ),
      c * c * 0.75 * above,
    )
    const amb = h.clone().lerp(t, 0.35).multiplyScalar(0.95)
    const cloud = amb
      .multiplyScalar(0.55)
      .add(sc.clone().multiplyScalar(sv * 0.68))
      .multiplyScalar(1 - 0.28 * c * c)
    out.lerp(cloud, Math.min(1, c * 0.85) * MathUtils.smoothstep(d.y, 0.015, 0.16) * 0.7)
    const align = d.dot(sd)
    const aureole = Math.exp((align - 1) * 110) * 0.2 + Math.exp((align - 1) * 8) * 0.08
    out.add(sc.clone().multiplyScalar(aureole * sv))
    return out
  }

  const update = (sun: SolarLight, coverValue: number) => {
    lerpStops(sun.elevation, 'top', top.value as Color)
    lerpStops(sun.elevation, 'horizon', horizon.value as Color)
    lerpStops(sun.elevation, 'ground', ground.value as Color)
    lerpStops(sun.elevation, 'glow', glow.value as Color)
    ;(sunDir.value as Vector3).copy(sun.direction)
    ;(sunColor.value as Color).copy(sun.color)
    sunVisible.value = MathUtils.smoothstep(sun.elevation, -1, 1)
    night.value = sun.night
    cover.value = coverValue
  }

  return { skyRadiance, lightRadiance, radianceCpu, update, cloudTime, cover, horizon, top, ground }
}

export type DaylightSky = ReturnType<typeof createDaylightSky>
