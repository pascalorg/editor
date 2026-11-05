import type { Vector3 } from 'three'
import { saturation, vec3 } from 'three/tsl'
import type { SceneAtmosphereSource } from '../../components/viewer/scene-atmosphere'

/** Daylight-specific outputs the post-processing reads (white balance). */
export type DaylightAtmosphereSource = SceneAtmosphereSource & {
  /** Linear RGB gains: eye-like partial chromatic adaptation to the current illuminant. */
  whiteBalance: Vector3
  /** The key light's shadow (the sun, or the moon at night): map size per quality tier. */
  shadow: { mapSize: number; bias: number; normalBias: number; radius: number }
  /** Sun elevation in degrees (negative at night). */
  elevation: number
}

export function isDaylightAtmosphere(source: unknown): source is DaylightAtmosphereSource {
  return Boolean(source && (source as Partial<DaylightAtmosphereSource>).whiteBalance)
}

/** The colored appearance's grade, vignette and bloom (viewport and snapshots alike). */
export const DAYLIGHT_GRADE = { contrast: 1.06, saturation: 1.06, vignette: 0.12 }
export const DAYLIGHT_BLOOM = { strength: 0.12, radius: 0.18, softKnee: 0.4 }
/** The daylight look ignores the scene theme: its ink edges are always the light-backdrop ink. */
export const DAYLIGHT_INK_BACKDROP = '#d4d8dc'

/** Scene-referred daylight grade: white balance, contrast around mid-grey, saturation. */
export function daylightGradeRgb(rgb: any, whiteBalance: any): any {
  return saturation(
    rgb.max(0).mul(whiteBalance).div(0.18).pow(vec3(DAYLIGHT_GRADE.contrast)).mul(0.18),
    DAYLIGHT_GRADE.saturation,
  )
}
