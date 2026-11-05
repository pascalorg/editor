import {
  abs,
  cameraPosition,
  clamp,
  diffuseColor,
  diffuseRoughness,
  dot,
  float,
  hash,
  length,
  materialEmissive,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  type MeshStandardNodeMaterial,
  type NodeBuilder,
  PhysicalLightingModel,
  MeshStandardNodeMaterial as StandardNodeMaterial,
} from 'three/webgpu'
import { SCENE_LAYER } from '../layers'
import { daylightRooms } from './rooms'
import { daylightUniforms, isDaylightRenderer } from './runtime'

/**
 * The daylight look's material treatment, applied to every standard (PBR) material the daylight
 * renderer compiles — the viewer's own materials, item GLB materials (auto-converted by the
 * renderer) and baked artifacts alike, since they are created in many places:
 *
 * - albedo range: base colour remapped into sRGB 40–243 (no black holes, no pure whites);
 * - EON rough diffuse on matte surfaces (r187 `diffuseRoughness`);
 * - lamp shades and screens glow brighter at night (× the time-of-day lamp level);
 * - tuned glass: clear up close, more opaque and reflective with distance and grazing angle, and
 *   at night warm with the light of the room behind it;
 * - unlit surfaces in the scene (pool water, guides) keep their authored display brightness: the
 *   metered exposure (up to ×4.6 at night) is for lit surfaces only.
 *
 * Installed once as a prototype hook (like three's own lighting-model extension points). It only
 * attaches for renderers flagged by the daylight atmosphere, so other canvases (item thumbnails)
 * keep their plain look, and every amount is a uniform: no recompiles when the look changes.
 */

type HookedMaterial = MeshStandardNodeMaterial & {
  isMeshPhysicalNodeMaterial?: boolean
  transparent: boolean
}

/** sRGB 40 / 243 in linear: lo + c·(hi − lo). */
const ALBEDO_LO = 0.0212
const ALBEDO_HI = 0.896

function hooked(material: HookedMaterial, builder: NodeBuilder): boolean {
  // Physical materials own their lighting model; glass and other transparent surfaces keep theirs.
  return (
    !material.isMeshPhysicalNodeMaterial &&
    !material.transparent &&
    isDaylightRenderer(builder.renderer)
  )
}

function matte(material: HookedMaterial): boolean {
  return (material.metalness ?? 0) < 0.2 && (material.roughness ?? 1) >= 0.55
}

function emitter(material: HookedMaterial): boolean {
  return (
    !material.emissiveNode &&
    !!material.emissive &&
    material.emissive.getHex() !== 0 &&
    material.emissiveIntensity > 0
  )
}

type GlassObject = { userData?: { slotId?: string } } | null | undefined

/** Window/door glass (its slot, live or baked), item glass by material name, or flagged glass. */
function glass(material: HookedMaterial, object: GlassObject): boolean {
  if (!material.transparent || material.isMeshPhysicalNodeMaterial) return false
  return (
    object?.userData?.slotId === 'glass' ||
    material.userData.isGlass === true ||
    /glass/i.test(material.name)
  )
}

/** The enhanced viewer's glass: tint, near-mirror roughness, distance/Fresnel opacity, night glow. */
function tunedGlassNodes() {
  const u = daylightUniforms
  const V = normalize(cameraPosition.sub(positionWorld))
  const N = normalWorld
  const fresnel = pow(float(1).sub(abs(dot(N, V))), 5)
  // /next trick: glass gets more opaque + reflective with distance and grazing angle, so façades
  // read as glazing from the street while interiors stay visible up close.
  const far = smoothstep(6, 30, length(cameraPosition.sub(positionWorld)))
  // Night: warm radiance from the lit room behind the pane (strongest from outside / far away).
  const behind = daylightRooms.roomAtNode(positionWorld.sub(N.mul(0.35)))
  const front = daylightRooms.roomAtNode(positionWorld.add(N.mul(0.35)))
  const room = max(behind as any, front as any)
  // Pane tint = the room's actual lamp colour (18% towards white), dark when its lamps are off.
  const lampRad = daylightRooms.roomGlowNode(room)
  const tint = mix(lampRad, vec3(lampRad.dot(vec3(0.33))), 0.18)
  // Per-room variation, like a game city: not every window equally bright.
  const variation = mix(0.55, 1.0, hash(float(room).add(7.13)))
  const strength = u.windowGlow
    .mul(u.glowComp)
    .mul(float(1).add(u.windowEmit.mul(1.8)))
    .mul(variation)
    .mul(mix(1.0, 0.35, fresnel))
    .mul(mix(0.25, 1.0, u.cameraOutside))
    .mul(mix(0.4, 1, far))
  return {
    colorNode: u.glassTint,
    roughnessNode: float(0.04),
    metalnessNode: float(0),
    opacityNode: clamp(u.glassOpacity.add(far.mul(0.18)).add(fresnel.mul(0.7)), 0, 0.72),
    emissiveNode: tint.mul(strength).mul(0.9),
  }
}

let installed = false

export function installDaylightMaterialHooks(): void {
  if (installed) return
  installed = true
  const proto = StandardNodeMaterial.prototype as unknown as {
    setup(this: HookedMaterial, builder: NodeBuilder): unknown
    setupDiffuseColor(this: HookedMaterial, builder: NodeBuilder): void
    setupVariants(this: HookedMaterial, builder: NodeBuilder): void
    setupLightingModel(this: HookedMaterial, builder: NodeBuilder): unknown
    setupLighting(this: HookedMaterial, builder: NodeBuilder): unknown
  }

  const setup = proto.setup
  proto.setup = function (builder) {
    if (!isDaylightRenderer(builder.renderer) || !glass(this, (builder as any).object))
      return setup.call(this, builder)
    // Build-time only: the tuned glass joins this compile without touching the material.
    const own = this as unknown as Record<string, unknown>
    const nodes = tunedGlassNodes()
    const saved = Object.fromEntries(Object.keys(nodes).map((key) => [key, own[key]]))
    Object.assign(own, nodes)
    try {
      return setup.call(this, builder)
    } finally {
      Object.assign(own, saved)
    }
  }

  const setupDiffuseColor = proto.setupDiffuseColor
  proto.setupDiffuseColor = function (builder) {
    setupDiffuseColor.call(this, builder)
    if (!hooked(this, builder)) return
    const rgb = diffuseColor.rgb
    const clamped = rgb.mul(ALBEDO_HI - ALBEDO_LO).add(ALBEDO_LO)
    diffuseColor.assign(vec4(mix(rgb, clamped, daylightUniforms.albedoClamp), diffuseColor.a))
  }

  const setupVariants = proto.setupVariants
  proto.setupVariants = function (builder) {
    setupVariants.call(this, builder)
    if (hooked(this, builder) && matte(this)) diffuseRoughness.assign(daylightUniforms.eon)
  }

  const setupLightingModel = proto.setupLightingModel
  proto.setupLightingModel = function (builder) {
    if (!hooked(this, builder) || !matte(this)) return setupLightingModel.call(this, builder)
    // The eighth flag enables EON rough diffuse (fed by `diffuseRoughness` above).
    return new PhysicalLightingModel(false, false, false, false, false, false, false, true)
  }

  const setupLighting = proto.setupLighting
  proto.setupLighting = function (builder) {
    if (!hooked(this, builder) || !emitter(this)) return setupLighting.call(this, builder)
    // Build-time only: the emission joins this compile without touching the material.
    // Glowing surfaces (screens, signs; lamps get their own materials): brighter at night, kept
    // out of the night exposure lift.
    const u = daylightUniforms
    this.emissiveNode = materialEmissive.mul(
      float(1).add(u.lampLevel.mul(u.emissiveBoost).mul(u.glowComp)),
    )
    try {
      return setupLighting.call(this, builder)
    } finally {
      this.emissiveNode = null
    }
  }

  // Unlit scene surfaces: undo the metered exposure (zones and editor overlays are compensated in
  // the post-processing, on their own layers; the sky capture is radiance and keeps it).
  const basic = MeshBasicNodeMaterial.prototype as unknown as {
    setupLighting(this: MeshBasicNodeMaterial, builder: NodeBuilder): any
  }
  const setupBasicLighting = basic.setupLighting
  basic.setupLighting = function (builder) {
    const light = setupBasicLighting.call(this, builder)
    const object = (builder as any).object as { layers?: { isEnabled(layer: number): boolean } }
    if (
      !isDaylightRenderer(builder.renderer) ||
      this.userData.daylightSky === true ||
      !object?.layers?.isEnabled(SCENE_LAYER)
    )
      return light
    return light.mul(daylightUniforms.emitterExpInv)
  }
}
