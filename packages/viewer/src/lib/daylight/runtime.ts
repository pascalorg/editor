import { Color } from 'three'
import { uniform } from 'three/tsl'

/**
 * Live controls of the colored appearance's daylight look, shared by the atmosphere (which drives
 * them every frame), the material hooks and the post-processing. Uniforms only: switching time,
 * weather, lamps or quality never recompiles a material.
 */
export const daylightUniforms = {
  /** EON rough-diffuse amount on matte surfaces (0 = Lambert). Off on the Low tier. */
  eon: uniform(0),
  /** 1 = albedo remapped into sRGB 40–243 (no black holes, no pure whites). */
  albedoClamp: uniform(0),
  /** Time-of-day lamp level: 0 by day … 1 at night (lamps on 'auto'). */
  lampLevel: uniform(0),
  /** Extra emission of lamp shades and screens at night (× lampLevel). */
  emissiveBoost: uniform(5),
  /** 1 / the night exposure lift, so glows don't blow out when the meter brightens the scene. */
  glowComp: uniform(1),
  /** 1 / exposure: lit lamp emitters target a fixed display brightness (always read as lit). */
  emitterExpInv: uniform(1),
  /** Lit lamp emitter brightness on screen, × display white. */
  emitterDisplay: uniform(4),
  /** 1 = the camera stands outside every room (drives the exterior window glow). */
  cameraOutside: uniform(1),
  /** Night window glow, and whether panes emit enough to bloom softly. */
  windowGlow: uniform(1.12),
  windowEmit: uniform(1),
  /** Tuned glass: base opacity at normal incidence and tint. */
  glassOpacity: uniform(0.1),
  glassTint: uniform(new Color(0.86, 0.95, 0.93)),
}

/** Renderers currently showing the daylight look; material hooks only attach for these. */
const activeRenderers = new WeakSet<object>()

export function setDaylightRenderer(renderer: object, active: boolean): void {
  if (active) activeRenderers.add(renderer)
  else activeRenderers.delete(renderer)
}

export function isDaylightRenderer(renderer: unknown): boolean {
  return !!renderer && typeof renderer === 'object' && activeRenderers.has(renderer)
}
