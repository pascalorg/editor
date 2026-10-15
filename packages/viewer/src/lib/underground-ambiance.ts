import type { AmbientLight, HemisphereLight } from 'three'
import { Color, Vector3 } from 'three'
import {
  abs,
  color,
  exp,
  float,
  getViewPosition,
  max,
  mix,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { GroundMode } from '../store/use-viewer'

/**
 * Going below grade is a change of world, as going under water is in a game: the sky and the
 * far ground fall into the dark of the earth, the site beyond the building dissolves in it, the
 * screen's edges close in, and the light that came from the sky comes down a little and warms.
 * The shown level is not touched: its materials keep their colours and the eye's own light keeps
 * its rooms as readable as ever. Dark around, not dark inside.
 *
 * One factor drives all of it: `0` is the world as it is, `1` is the earth. The factor eases
 * between the two over {@link AMBIANCE_SECONDS}, never pops, and is instant when the person's
 * animation setting is Off. It lives here as a shader uniform (the pipeline and the veil read
 * it with no rebuild) and mirrors into the viewer store as `ambiance`.
 */

/** How long the crossing takes, in and out. */
export const AMBIANCE_SECONDS = 0.7

/** The earth around the horizon, where the fog and the backdrop meet. */
export const SOIL_HORIZON = '#6a4b32'
/** The earth overhead and underfoot: deeper than the horizon, never black. */
export const SOIL_DEEP = '#33241a'
/** The tone the ground veil takes: the lid of the earth, a little warmer than the backdrop. */
export const SOIL_VEIL = '#8a6240'
/** The veil's opacity under the ground: a little thicker than its plain faintness. */
export const SOIL_VEIL_OPACITY = 0.12
/** The grade ring, where the lid meets the level below grade: it reads as the lid's rim. */
export const SOIL_RING = '#d9a66b'
/** The corners the vignette closes in to. */
export const SOIL_VIGNETTE = '#0f0905'

/** The sky's ambient and hemisphere light, as a share of what the theme gives. */
export const SKY_LIGHT_SCALE = 0.65
/** The eye's own light comes up this much as the sky's comes down, so the rooms keep their light. */
export const FILL_BOOST = 1.4
/** Their tint pulls this much toward a warm lamp colour. */
export const SKY_LIGHT_WARMTH = 0.15
const WARM = '#ffcf9a'

/** Fog begins this far past the shown level's box and has taken the site by the second. */
export const FOG_START = 3
export const FOG_END = 24
/** What remains of the far site when the fog is complete. */
const FOG_CAP = 0.97
/** The screen's corners darken by this much at most. */
export const VIGNETTE_STRENGTH = 0.42

/** How far the eye goes under (or back over) the ground before the flag turns. */
export const EYE_BAND = 0.1

/** The edge the ambiance is wanted by, from what the store and the eye say. */
export function ambianceTarget(state: {
  groundVeiled: boolean
  eyeUnderGround: boolean
  groundMode: GroundMode
}): 0 | 1 {
  if (state.groundMode !== 'auto') return 0
  return state.groundVeiled || state.eyeUnderGround ? 1 : 0
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
let factor = 0
let held = false

/** The factor as shaders read it: zero while a capture holds the ambiance off. */
export function undergroundAmbianceNode() {
  return factorNode
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
 * grade is read for its rooms, so it is taken in the world's own light. The returned function
 * gives the person's view back.
 */
export function temporarilyWithoutAmbiance(): () => void {
  const wasHeld = held
  held = true
  factorNode.value = 0
  restoreSkyLights()
  return () => {
    held = wasHeld
    factorNode.value = held ? 0 : factor
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

// ── The pipeline's pieces (TSL) ──────────────────────────────────────────────────────────────

/**
 * The backdrop of the earth for a view direction: the horizon's umber, deepening overhead and
 * underfoot. The fog dissolves into this same colour per pixel, so what is far leaves no seam.
 */
export function undergroundBackdrop(dirY: any): any {
  return (mix as any)(color(SOIL_DEEP), color(SOIL_HORIZON), exp(abs(dirY).mul(-2.6)))
}

/**
 * How far a world position stands in the earth's fog, 0 to 1, from its distance outside the
 * shown box (the box itself, and what stands close about it, stays clear). Scaled by the factor.
 */
export function undergroundFogAmount(worldPosition: any): any {
  const centre = focusMin.add(focusMax).mul(0.5)
  const half = focusMax.sub(focusMin).mul(0.5)
  const outside = max(abs(worldPosition.sub(centre)).sub(half), vec3(0)).length()
  return smoothstep(float(FOG_START), float(FOG_END), outside).mul(FOG_CAP).mul(factorNode)
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

/** The screen's edges closing in: 0 at the centre, 1 at the corners, scaled by the factor. */
export function undergroundVignette(uv: any = screenUV): any {
  const radial = uv.sub(0.5).length().mul(2)
  return smoothstep(float(0.55), float(1.45), radial).mul(VIGNETTE_STRENGTH).mul(factorNode)
}

// ── The sky's light, brought down for the frame ──────────────────────────────────────────────

type SkyLights = { ambient: AmbientLight | null; hemisphere: HemisphereLight | null }
let skyLightSource: (() => SkyLights) | null = null

type Saved = {
  ambient: { light: AmbientLight; intensity: number; color: Color } | null
  hemisphere: {
    light: HemisphereLight
    intensity: number
    color: Color
    groundColor: Color
  } | null
}
let saved: Saved | null = null
const warm = new Color(WARM)

/** The lights that stand for the sky: `Lights` offers its ambient and hemisphere lights here. */
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
 * Brings the sky's lights down and warms them by `amount`, for the frame about to be drawn.
 * Their neutral state is kept and given back by {@link restoreSkyLights} before the next frame
 * lerps them, so the theme's own smoothing never fights the ambiance.
 */
export function applyAmbianceToSkyLights(amount: number): void {
  restoreSkyLights()
  if (amount <= 0 || !skyLightSource) return
  const { ambient, hemisphere } = skyLightSource()
  const scale = 1 + (SKY_LIGHT_SCALE - 1) * amount
  const warmth = SKY_LIGHT_WARMTH * amount
  saved = { ambient: null, hemisphere: null }
  if (ambient) {
    saved.ambient = { light: ambient, intensity: ambient.intensity, color: ambient.color.clone() }
    ambient.intensity *= scale
    ambient.color.lerp(warm, warmth)
  }
  if (hemisphere) {
    saved.hemisphere = {
      light: hemisphere,
      intensity: hemisphere.intensity,
      color: hemisphere.color.clone(),
      groundColor: hemisphere.groundColor.clone(),
    }
    hemisphere.intensity *= scale
    hemisphere.color.lerp(warm, warmth)
    hemisphere.groundColor.lerp(warm, warmth)
  }
}

/** Gives the sky's lights back as the theme set them. */
export function restoreSkyLights(): void {
  if (!saved) return
  const { ambient, hemisphere } = saved
  saved = null
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
