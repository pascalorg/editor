import type { AmbientLight, DirectionalLight, HemisphereLight } from 'three'
import { Color, Vector3 } from 'three'
import {
  abs,
  clamp,
  color,
  float,
  getViewPosition,
  max,
  mx_noise_float,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { GroundMode } from '../store/use-viewer'
import { backdropGradient, deepSkyColor, horizonHazeColor } from './backdrop'
import { getSceneTheme } from './scene-themes'

/**
 * Diving under the ground is the scene's own dark mode, as going under water is in a game: the
 * moment the eye crosses the ground surface the backdrop, the far site, the screen's edges and
 * the sky's light go to the dark theme's slate, and crossing back up brings the day back. Above
 * the ground nothing changes, whatever level is shown (a veiled basement seen from above is the
 * veil as it was). The shown level is not touched: its materials keep their colours and the
 * eye's own light keeps its rooms as readable as ever. Dark around, not dark inside.
 *
 * One factor drives all of it: `0` is the world as it is, `1` is the dark mode. The factor eases
 * between the two over {@link AMBIANCE_SECONDS}, never pops, and is instant when the person's
 * animation setting is Off. It lives here as a shader uniform (the pipeline and the veil read
 * it with no rebuild); the store keeps only whether it is above 0 (`ambianceActive`).
 */

/** How long the crossing takes, in and out. */
export const AMBIANCE_SECONDS = 0.7

/**
 * The dark mode is the viewer's own dark scene theme, not new constants: its backdrop, sky,
 * ground, ambient light and wall tint. Another dark theme would be one id here.
 */
export const UNDERGROUND_THEME_ID = 'night'
const DARK = getSceneTheme(UNDERGROUND_THEME_ID)
const DARK_SKY = DARK.backgroundSky ?? DARK.background

/**
 * The backdrop's own stops: the formula of the theme backdrop (`lib/backdrop.ts`), in the dark
 * theme's colours. Looking down (most views from the eye under the ground) it is the theme's
 * lit slate ground tone, so the dark mode reads as slate rather than black; the sky above is the
 * theme's own.
 */
const BACKDROP = {
  background: DARK.ground,
  haze: horizonHazeColor(DARK_SKY, 'dark'),
  sky: DARK_SKY,
  skyDeep: deepSkyColor(DARK_SKY),
} as const
/** The tone the ground veil takes: the dark theme's ground. */
export const UNDERGROUND_VEIL = DARK.ground
/** The veil's opacity under the ground: a little thicker than its plain faintness. */
export const UNDERGROUND_VEIL_OPACITY = 0.12
/** The grade ring, where the ground meets the level below grade: the dark theme's wall tint, a light rim. */
export const UNDERGROUND_RING = DARK.clayTints?.wall ?? '#aab3c6'
/** The corners the vignette closes in to: the dark theme's deepest tone. */
export const UNDERGROUND_VIGNETTE = DARK_SKY

/** The sky's ambient and hemisphere light, as a share of what the theme gives. */
export const SKY_LIGHT_SCALE = 0.65
/**
 * The eye's own light at full ambiance: the veil's own fill (1) and as much again as the sky's
 * comes down, so the rooms keep their light. It rides the factor, from the veil's own fill (or
 * from nothing where no veil stands), so it neither steps on nor off.
 */
export const EYE_FILL_INTENSITY = 2.4
/** The sky light's tint pulls this much toward the dark theme's ambient colour. */
export const SKY_LIGHT_TINT = 0.15
const TINT = DARK.ambient.color

/** Fog begins this far past the shown level's box and has taken the site by the second. */
export const FOG_START = 3
export const FOG_END = 24
/** What remains of the far site when the fog is complete. */
const FOG_CAP = 0.97
/** The screen's corners darken by this much at most. */
export const VIGNETTE_STRENGTH = 0.42

/**
 * How far the eye goes under (or back over) the ground before the flag turns, in metres: it dives
 * 0.10 m below the ground and surfaces 0.10 m above it, a 0.20 m band in all, so an orbit
 * grazing the surface does not flicker.
 */
export const EYE_BAND = 0.1

/**
 * The edge the ambiance is wanted by: only the eye under the ground, and never on Solid (the
 * person's own override). What level is shown, or whether the ground is veiled, is not in it.
 */
export function ambianceTarget(state: { eyeUnderGround: boolean; groundMode: GroundMode }): 0 | 1 {
  if (state.groundMode !== 'auto') return 0
  return state.eyeUnderGround ? 1 : 0
}

/**
 * Whether the eye lies under the ground, with a small band so a camera resting on the ground
 * plane does not chatter: it goes under {@link EYE_BAND} below the ground and comes back
 * {@link EYE_BAND} above it.
 */
export function eyeUnderTheGround(previous: boolean, eyeY: number, groundY: number): boolean {
  return previous ? eyeY < groundY + EYE_BAND : eyeY < groundY - EYE_BAND
}

/**
 * One step of the crossing: `progress` moves toward `target` (0 or 1) in a straight line over
 * `seconds`, and is exactly the target once it has arrived. `seconds <= 0` is instant.
 */
export function stepAmbianceProgress(
  progress: number,
  target: number,
  dt: number,
  seconds: number,
): number {
  if (seconds <= 0 || dt >= seconds) return target
  const step = dt / seconds
  return target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step)
}

/** The eased factor of a straight-line progress: slow in, slow out. */
export function easeAmbiance(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return p * p * (3 - 2 * p)
}

// ── The shared factor ────────────────────────────────────────────────────────────────────────

const factorNode = uniform(0)
/**
 * How far the hole in the ground is open (0 closed, 1 open): over a level below grade seen from
 * above, the ground stays solid and a hole with a noise-eroded edge opens over the below-grade
 * footprint. Eased like the factor; 0 in a capture, whose own ground it keeps (see
 * {@link temporarilyWithoutAmbiance}).
 */
const holeNode = uniform(0)
let hole = 0
let factor = 0
let held = false

/** The factor as shaders read it: zero while a capture holds the ambiance off. */
export function undergroundAmbianceNode() {
  return factorNode
}

/** How far the ground's hole is open, as shaders read it: 0 while a capture holds the world plain. */
export function groundHoleOpenNode() {
  return holeNode
}

/** How far the ground's hole is open now (0 while a capture holds the world plain). */
export function groundHoleOpenNow(): number {
  return holeNode.value as number
}

/** Sets the live opening of the ground's hole (the system's word). */
export function setGroundHoleOpen(next: number): void {
  hole = next
  holeNode.value = held ? 0 : next
}

/** The factor the shown frame wears now: the eased value, or `0` while a capture holds it off. */
export function ambianceNow(): number {
  return held ? 0 : factor
}

/** Sets the live factor (the system's word); shaders and lights follow the held value. */
export function setAmbianceFactor(next: number): void {
  factor = next
  factorNode.value = held ? 0 : next
}

/**
 * The shown frame without the ambiance, for one capture: an agent's picture of a level below
 * grade is read for its rooms, so it is taken in the world's own light, and the person's hole in
 * the ground is not in it (a capture sets its own ground: the plain veil over a level below
 * grade, solid for an exterior). The returned function gives the person's view back.
 */
export function temporarilyWithoutAmbiance(): () => void {
  const wasHeld = held
  held = true
  factorNode.value = 0
  holeNode.value = 0
  restoreSkyLights()
  return () => {
    held = wasHeld
    factorNode.value = held ? 0 : factor
    holeNode.value = held ? 0 : hole
  }
}

// ── The shown level's box: where the world stays clear ──────────────────────────────────────

const focusMin = uniform(new Vector3(-20, -20, -20))
const focusMax = uniform(new Vector3(20, 20, 20))

/** The box the fog keeps clear: the shown level's, or a cube about the eye when none is shown. */
export function setAmbianceFocus(
  box: { min: readonly number[]; max: readonly number[] } | null,
  eye: { x: number; y: number; z: number },
): void {
  if (box) {
    focusMin.value.set(box.min[0]!, box.min[1]!, box.min[2]!)
    focusMax.value.set(box.max[0]!, box.max[1]!, box.max[2]!)
    return
  }
  const half = 20
  focusMin.value.set(eye.x - half, eye.y - half, eye.z - half)
  focusMax.value.set(eye.x + half, eye.y + half, eye.z + half)
}

/** The box the fog keeps clear now (what {@link setAmbianceFocus} last set). */
export function ambianceFocus(): { min: number[]; max: number[] } {
  return { min: focusMin.value.toArray(), max: focusMax.value.toArray() }
}

// ── The pipeline's pieces (TSL) ──────────────────────────────────────────────────────────────

/**
 * The dark mode's backdrop for a view direction: the theme backdrop's own gradient, in the dark
 * theme's colours. The fog dissolves into this same colour per pixel, so what is far leaves no seam.
 */
export function undergroundBackdrop(dirY: any): any {
  return backdropGradient({
    dirY,
    background: color(BACKDROP.background),
    haze: color(BACKDROP.haze),
    sky: color(BACKDROP.sky),
    skyDeep: color(BACKDROP.skyDeep),
  })
}

/**
 * How far a world position stands in the dark mode's fog, 0 to 1, from its distance outside the
 * shown box (the box itself, and what stands close about it, stays clear). Not scaled by the
 * factor: the pipeline weighs it with {@link undergroundDissolve}.
 */
export function undergroundFogAmount(worldPosition: any): any {
  const centre = focusMin.add(focusMax).mul(0.5)
  const half = focusMax.sub(focusMin).mul(0.5)
  const outside = max(abs(worldPosition.sub(centre)).sub(half), vec3(0)).length()
  return smoothstep(float(FOG_START), float(FOG_END), outside).mul(FOG_CAP)
}

/**
 * The crossing as a noise mask closing over the screen: a per-pixel weight, 0 to 1, that goes
 * from 0 everywhere at factor 0 to 1 everywhere at factor 1, through soft blobs of the dark
 * world spreading (a fine perlin mask in screen space, not a cross-fade). Weighs the backdrop,
 * the fog and the vignette; above and below the crossing it is exactly 0 and 1.
 */
export function undergroundDissolve(uv: any = screenUV): any {
  const softness = 0.32
  // Perlin is centred on 0 with a short spread: stretch it so the mask covers 0..1.
  const grain = mx_noise_float(vec3(uv.mul(vec2(9, 5.8)), 0.37))
    .mul(0.62)
    .add(mx_noise_float(vec3(uv.mul(vec2(21, 13.5)), 1.91)).mul(0.22))
  const n = clamp(grain.add(0.5), 0, 1)
  const t = factorNode.mul(1 + 2 * softness).sub(softness)
  return smoothstep(n.sub(softness), n.add(softness), t)
}

/** The world position of the pixel at `uv` from the scene pass's raw depth. */
export function worldPositionFromDepth(
  rawDepth: any,
  projectionInverse: any,
  cameraWorld: any,
  uv: any = screenUV,
): any {
  const viewPosition = getViewPosition(uv, rawDepth, projectionInverse)
  return (cameraWorld as any).mul(vec4(viewPosition, 1)).xyz
}

/** The screen's edges closing in: 0 at the centre, 1 at the corners (weigh it with the dissolve). */
export function undergroundVignette(uv: any = screenUV): any {
  const radial = uv.sub(0.5).length().mul(2)
  return smoothstep(float(0.55), float(1.45), radial).mul(VIGNETTE_STRENGTH)
}

// ── The sky's light, brought down for the frame ──────────────────────────────────────────────

type SkyLights = {
  ambient: AmbientLight | null
  hemisphere: HemisphereLight | null
  /** The light from the eye (`UndergroundFill`), when it is mounted. */
  fill: DirectionalLight | null
  /** What the fill shines at with no ambiance: the veil's own 1 over a veiled ground, else 0. */
  fillRest: number
}
let skyLightSource: (() => SkyLights) | null = null

type Saved = {
  fill: { light: DirectionalLight; intensity: number } | null
  ambient: { light: AmbientLight; intensity: number; color: Color } | null
  hemisphere: {
    light: HemisphereLight
    intensity: number
    color: Color
    groundColor: Color
  } | null
}
let saved: Saved | null = null
const tint = new Color(TINT)

/** The lights the ambiance moves: `Lights` offers the sky's ambient and hemisphere and the eye's fill. */
export function registerSkyLights(source: () => SkyLights): () => void {
  skyLightSource = source
  return () => {
    if (skyLightSource === source) {
      restoreSkyLights()
      skyLightSource = null
    }
  }
}

/**
 * Brings the sky's lights down and tints them by `amount`, and brings the eye's fill up, for the
 * frame about to be drawn. Their neutral state is kept and given back by
 * {@link restoreSkyLights} before the next frame lerps them, so the theme's own smoothing never
 * fights the ambiance. With no ambiance (or none registered) the fill is simply set to its rest.
 */
export function applyAmbianceToSkyLights(amount: number): void {
  restoreSkyLights()
  if (!skyLightSource) return
  const { ambient, hemisphere, fill, fillRest } = skyLightSource()
  saved = { fill: null, ambient: null, hemisphere: null }
  if (fill) {
    saved.fill = { light: fill, intensity: fillRest }
    fill.intensity = fillRest + (EYE_FILL_INTENSITY - fillRest) * Math.max(0, amount)
  }
  if (amount <= 0) return
  const scale = 1 + (SKY_LIGHT_SCALE - 1) * amount
  const warmth = SKY_LIGHT_TINT * amount
  if (ambient) {
    saved.ambient = { light: ambient, intensity: ambient.intensity, color: ambient.color.clone() }
    ambient.intensity *= scale
    ambient.color.lerp(tint, warmth)
  }
  if (hemisphere) {
    saved.hemisphere = {
      light: hemisphere,
      intensity: hemisphere.intensity,
      color: hemisphere.color.clone(),
      groundColor: hemisphere.groundColor.clone(),
    }
    hemisphere.intensity *= scale
    hemisphere.color.lerp(tint, warmth)
    hemisphere.groundColor.lerp(tint, warmth)
  }
}

/** Gives the sky's lights back as the theme set them, and the eye's fill its rest. */
export function restoreSkyLights(): void {
  if (!saved) return
  const { fill, ambient, hemisphere } = saved
  saved = null
  if (fill) fill.light.intensity = fill.intensity
  if (ambient) {
    ambient.light.intensity = ambient.intensity
    ambient.light.color.copy(ambient.color)
  }
  if (hemisphere) {
    hemisphere.light.intensity = hemisphere.intensity
    hemisphere.light.color.copy(hemisphere.color)
    hemisphere.light.groundColor.copy(hemisphere.groundColor)
  }
}
