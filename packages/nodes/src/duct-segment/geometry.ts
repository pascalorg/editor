import type { GeometryContext } from '@pascal-app/core'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import { DUCT_BODY_SLOT_DEFAULT, DUCT_BODY_SLOT_ID } from '../shared/duct-body-paint'
import type { DuctSegmentNode } from './schema'

export const INCHES_TO_METERS = 0.0254
// Insulation wraps the duct in a roughly uniform shell. A strictly physical
// mapping (fiberglass ≈ R-3.2 per inch) makes low R-values nearly invisible
// at screen scale — R-1 would add only ~8 mm over a 15 cm duct. So the shell
// uses a perceptual mapping: a visible base jacket as soon as insulation is
// non-zero, plus a clear per-R increment. Anchored so R-8 still lands near
// the real-world ~3" jacket.
const INSULATION_BASE_IN = 0.5
const INSULATION_INCHES_PER_R = 0.3125
function pickInsulationThickness(r: number): number {
  if (r <= 0) return 0
  return (INSULATION_BASE_IN + r * INSULATION_INCHES_PER_R) * INCHES_TO_METERS
}

// Supply/return tint — kept only for the spiral seam ridge accent; the duct
// body itself is plain white (see createDuctMaterial).
const SUPPLY_COLOR = '#d4825a'
const RETURN_COLOR = '#5a8ad4'

const RADIAL_SEGMENTS = 24

const UP = new Vector3(0, 1, 0)

/**
 * Area-equivalent round diameter (inches) for a rect cross-section —
 * what a rect trunk advertises on its ports so round fittings / branches
 * mate at a sensible size.
 */
export function equivalentDiameterIn(widthIn: number, heightIn: number): number {
  return 2 * Math.sqrt((widthIn * heightIn) / Math.PI)
}

/**
 * Area-equivalent round diameter (inches) for a flat-oval cross-section:
 * a rectangle of (width − height) × height plus the two semicircular caps.
 */
export function ovalEquivalentDiameterIn(widthIn: number, heightIn: number): number {
  const minor = Math.min(widthIn, heightIn)
  const major = Math.max(widthIn, heightIn)
  const area = (major - minor) * minor + Math.PI * (minor / 2) ** 2
  return 2 * Math.sqrt(area / Math.PI)
}

/** The diameter (inches) a duct segment presents at its ports. */
export function ductPortDiameterIn(node: {
  shape?: 'round' | 'rect' | 'oval'
  diameter: number
  width?: number
  height?: number
}): number {
  if (node.shape === 'rect' && node.width && node.height) {
    return equivalentDiameterIn(node.width, node.height)
  }
  if (node.shape === 'oval' && node.width && node.height) {
    return ovalEquivalentDiameterIn(node.width, node.height)
  }
  return node.diameter
}

/**
 * Cross-section axes for a rect run along `dir`, rolled `roll` radians
 * about the run direction. At roll 0: width is the horizontal axis
 * (UP × dir) and height the vertical one — vertical runs, where that
 * cross product degenerates, fall back to world X/Z. `roll` rotates the
 * pair in the plane perpendicular to `dir`, letting a riser carry the
 * orientation of the run it turned off instead of the bare fallback.
 */
export function rectSectionAxes(dir: Vector3, roll = 0): { width: Vector3; height: Vector3 } {
  const d = dir.clone().normalize()
  const xBase = new Vector3().crossVectors(UP, d)
  if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
  xBase.normalize()
  const zBase = new Vector3().crossVectors(xBase, d)
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  const width = xBase.clone().multiplyScalar(c).addScaledVector(zBase, s)
  const height = xBase.clone().multiplyScalar(-s).addScaledVector(zBase, c)
  return { width, height }
}

/**
 * Roll (radians) that keeps a rect cross-section continuous across an
 * elbow: the dimension lying along the joint's hinge — the bend-plane
 * normal `portDir × newDir`, perpendicular to both legs — must stay on
 * the same physical face on the new run as on the source run. Returns 0
 * for an in-plane (degenerate-normal) joint, so horizontal turns keep
 * the natural width-horizontal orientation.
 */
export function rollToContinueAcrossElbow(
  sourceDir: Vector3,
  sourceRoll: number,
  portDir: Vector3,
  newDir: Vector3,
): number {
  const n = new Vector3().crossVectors(portDir, newDir)
  if (n.lengthSq() < 1e-8) return 0
  n.normalize()
  const src = rectSectionAxes(sourceDir, sourceRoll)
  const carriesWidth = Math.abs(src.width.dot(n)) >= Math.abs(src.height.dot(n))
  const d = newDir.clone().normalize()
  const xBase = new Vector3().crossVectors(UP, d)
  if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
  xBase.normalize()
  const zBase = new Vector3().crossVectors(xBase, d)
  // Place the hinge-aligned face on the same axis the source carries it.
  return carriesWidth
    ? Math.atan2(n.dot(zBase), n.dot(xBase))
    : Math.atan2(-n.dot(xBase), n.dot(zBase))
}

/**
 * Rect box spanning `start`→`end`. Orientation comes from `rectSectionAxes`
 * (width horizontal, height vertical by default; `roll` reorients a riser
 * to stay continuous through its elbow). Quaternion from an explicit basis
 * — the minimal-rotation `setFromUnitVectors` used for cylinders would roll
 * the cross-section on axis-aligned runs.
 */
export function buildRectSection(
  start: Vector3,
  end: Vector3,
  widthM: number,
  heightM: number,
  material: Material,
  name: string,
  roll = 0,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()

  const { width: x, height: z } = rectSectionAxes(dir, roll)

  const geom = new BoxGeometry(widthM, length, heightM)
  const mesh = new Mesh(geom, material)
  mesh.name = name
  mesh.position.copy(start).addScaledVector(dir, length / 2)
  mesh.quaternion.copy(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, dir, z)))
  return mesh
}

/**
 * Flat-oval (stadium) profile in the XY plane: width along X, height
 * along Y, flat top/bottom joined by semicircular end caps of the height.
 * Degenerates to a circle when width ≤ height.
 */
function stadiumShape(widthM: number, heightM: number): Shape {
  const r = Math.min(widthM, heightM) / 2
  const straight = Math.max(0, widthM - heightM) / 2
  const shape = new Shape()
  shape.absarc(straight, 0, r, -Math.PI / 2, Math.PI / 2, false)
  shape.absarc(-straight, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false)
  shape.closePath()
  return shape
}

/**
 * Centered flat-oval prism with the same local axes as the rect box
 * (X = width, Y = run length, Z = height), so sections and previews
 * orient it with the `rectSectionAxes` basis.
 */
export function createOvalSectionGeometry(
  widthM: number,
  heightM: number,
  lengthM: number,
): ExtrudeGeometry {
  const geom = new ExtrudeGeometry(stadiumShape(widthM, heightM), {
    depth: lengthM,
    bevelEnabled: false,
    curveSegments: RADIAL_SEGMENTS / 2,
  })
  geom.translate(0, 0, -lengthM / 2)
  geom.rotateX(-Math.PI / 2)
  return geom
}

/**
 * Flat-oval section spanning `start`→`end` — the oval counterpart of
 * `buildRectSection`, sharing its orientation basis and roll semantics.
 */
export function buildOvalSection(
  start: Vector3,
  end: Vector3,
  widthM: number,
  heightM: number,
  material: Material,
  name: string,
  roll = 0,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()

  const { width: x, height: z } = rectSectionAxes(dir, roll)

  const mesh = new Mesh(createOvalSectionGeometry(widthM, heightM, length), material)
  mesh.name = name
  mesh.position.copy(start).addScaledVector(dir, length / 2)
  mesh.quaternion.copy(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, dir, z)))
  return mesh
}

/**
 * Cylinder spanning `start`→`end` at `radius`. Shared by the segment and
 * fitting builders — fittings are just short sections + a junction.
 */
export function buildSection(
  start: Vector3,
  end: Vector3,
  radius: number,
  material: Material,
  name: string,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()

  // Capped, front-side-only — ducts should read as solid metal tubes,
  // not hollow open-ended shells.
  const geom = new CylinderGeometry(radius, radius, length, RADIAL_SEGMENTS, 1, false)
  const mesh = new Mesh(geom, material)
  mesh.name = name
  mesh.position.copy(start).addScaledVector(dir, length / 2)
  mesh.quaternion.setFromUnitVectors(UP, dir)
  return mesh
}

/**
 * Helical ridge wound around the cylinder spanning `start`→`end` at the
 * given `pitch` (meters of run per turn) and `ridge` tube radius. The
 * ridge sits centered on the body surface, so half its thickness reads
 * as raised. Two construction details share this: the spiral duct's
 * lock seam (long pitch, thin ridge) and the flex duct's wire helix
 * (tight pitch, fat ridge → corrugated look).
 */
function buildHelixRidge(
  start: Vector3,
  end: Vector3,
  radius: number,
  pitch: number,
  ridge: number,
  material: MeshStandardMaterial,
  name: string,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()

  const turns = length / pitch
  const { width: u, height: v } = rectSectionAxes(dir)
  const samples = Math.min(4096, Math.max(8, Math.ceil(turns * 12)))
  const pts: Vector3[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const theta = 2 * Math.PI * turns * t
    pts.push(
      start
        .clone()
        .addScaledVector(dir, t * length)
        .addScaledVector(u, radius * Math.cos(theta))
        .addScaledVector(v, radius * Math.sin(theta)),
    )
  }
  const geom = new TubeGeometry(new CatmullRomCurve3(pts), samples, ridge, 6, false)
  const mesh = new Mesh(geom, material)
  mesh.name = name
  return mesh
}

/**
 * Helix parameters for a construction material's body detail, or null
 * for materials with a smooth body. Spiral: the machine seam keeps a
 * roughly constant helix angle, so pitch scales with the diameter.
 * Flex: the wire helix is tight and reads as corrugation; its pitch
 * also follows the diameter but is clamped much lower.
 */
function helixRidgeFor(
  ductMaterial: DuctAppearance['ductMaterial'],
  radius: number,
): { pitch: number; ridge: number; color: string } | null {
  if (ductMaterial === 'spiral') {
    return {
      pitch: Math.min(0.3, Math.max(0.08, radius * 1.2)),
      ridge: Math.min(0.006, Math.max(0.002, radius * 0.06)),
      color: '#9b9b9b',
    }
  }
  if (ductMaterial === 'flex') {
    return {
      pitch: Math.min(0.06, Math.max(0.025, radius * 0.5)),
      ridge: Math.min(0.009, Math.max(0.004, radius * 0.12)),
      color: '#737373',
    }
  }
  return null
}

type DuctAppearance = {
  ductMaterial: 'sheet-metal' | 'spiral' | 'flex' | 'duct-board'
  system: 'supply' | 'return'
  slots?: Record<string, string>
}

function getSystemTint(node: DuctAppearance): string {
  return node.system === 'supply' ? SUPPLY_COLOR : RETURN_COLOR
}

/**
 * Standard duct body material — a plain white matte finish so runs and
 * fittings read like walls / other building elements rather than tinted
 * metal. Shared with the fitting builder so connected runs and junctions
 * look like one piece.
 */
export function createDuctMaterial(
  node: DuctAppearance,
  sceneMaterials?: GeometryContext['materials'],
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Material {
  if (!textures) {
    return createSurfaceRoleMaterial('furnishing', colorPreset, undefined, sceneTheme)
  }

  const slotRef = node.slots?.[DUCT_BODY_SLOT_ID]
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)
    if (resolved) return resolved
  }

  return resolveSlotDefaultMaterial(DUCT_BODY_SLOT_DEFAULT, shading, 0.7)
}

/**
 * Pure geometry builder for a round duct segment polyline.
 *
 * Strategy:
 *   - For every consecutive pair of path points, build a cylinder of the
 *     duct's inner diameter.
 *   - Drop a sphere of the same radius at every interior joint to cap the
 *     corner smoothly (no mitering yet — fittings come in a later slice).
 *   - When insulation is non-zero, repeat the same pattern at a larger
 *     radius using a translucent shell material.
 *
 * All children are returned in level-local meters; the framework's
 * `<ParametricNodeRenderer>` handles the node-level transform (currently
 * identity since the schema has no position field — the path itself is
 * absolute within the level).
 */
export function buildDuctSegmentGeometry(
  node: DuctSegmentNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const isRect = node.shape === 'rect'
  const isOval = node.shape === 'oval'
  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const widthM = node.width * INCHES_TO_METERS
  const heightM = node.height * INCHES_TO_METERS
  const ductMaterial = createDuctMaterial(
    node,
    ctx?.materials,
    shading,
    textures,
    colorPreset,
    sceneTheme,
  )

  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  const addRun = (
    half: number,
    rectW: number,
    rectH: number,
    material: Material,
    namePrefix: string,
    endInsetM = 0,
    paintableBody = false,
  ) => {
    for (let i = 0; i < points.length - 1; i++) {
      // Loop bounds + min(2) on the schema guarantee both points exist.
      let a = points[i] as Vector3
      let b = points[i + 1] as Vector3
      // Pull the run's open ends in so this shell's end faces never sit
      // coplanar with the duct's own end caps (z-fighting). Clamped so
      // a short section can't invert.
      if (endInsetM > 0) {
        const dir = new Vector3().subVectors(b, a)
        const length = dir.length()
        if (length < 1e-6) continue
        dir.divideScalar(length)
        const inset = Math.min(endInsetM, length * 0.25)
        if (i === 0) a = a.clone().addScaledVector(dir, inset)
        if (i === points.length - 2) b = b.clone().addScaledVector(dir, -inset)
      }
      const mesh = isRect
        ? buildRectSection(a, b, rectW, rectH, material, `${namePrefix}-section-${i}`, node.roll)
        : isOval
          ? buildOvalSection(a, b, rectW, rectH, material, `${namePrefix}-section-${i}`, node.roll)
          : buildSection(a, b, half, material, `${namePrefix}-section-${i}`)
      if (mesh) {
        if (paintableBody) mesh.userData.slotId = DUCT_BODY_SLOT_ID
        group.add(mesh)
      }
    }
    // Joint caps at interior points only (skip first and last — they're
    // open ends; equipment / terminal / fitting collars cap them). Rect
    // joints are cubes spanning the cross-section (oval joints the same
    // prism in stadium profile); round joints spheres.
    for (let i = 1; i < points.length - 1; i++) {
      const joint = isRect
        ? new Mesh(new BoxGeometry(rectW, rectH, rectW), material)
        : isOval
          ? new Mesh(createOvalSectionGeometry(rectW, rectH, rectW), material)
          : new Mesh(new SphereGeometry(half, RADIAL_SEGMENTS, 12), material)
      joint.name = `${namePrefix}-joint-${i}`
      joint.position.copy(points[i] as Vector3)
      if (paintableBody) joint.userData.slotId = DUCT_BODY_SLOT_ID
      group.add(joint)
    }
  }

  addRun(radius, widthM, heightM, ductMaterial, 'duct', 0, true)

  // Construction body detail: spiral winds its lock seam, flex its wire
  // helix (tight pitch — reads as corrugation) over each round section.
  // These are round-body details, so rect / oval runs render smooth.
  const helix =
    node.shape === 'round' && node.seamDetail ? helixRidgeFor(node.ductMaterial, radius) : null
  if (helix) {
    const ridgeMaterial = new MeshStandardMaterial({
      color: helix.color,
      metalness: node.ductMaterial === 'flex' ? 0.1 : 0.7,
      roughness: node.ductMaterial === 'flex' ? 0.85 : 0.35,
      emissive: getSystemTint(node),
      emissiveIntensity: 0.08,
    })
    for (let i = 0; i < points.length - 1; i++) {
      const seam = buildHelixRidge(
        points[i] as Vector3,
        points[i + 1] as Vector3,
        radius,
        helix.pitch,
        helix.ridge,
        ridgeMaterial,
        `duct-seam-${i}`,
      )
      if (seam) group.add(seam)
    }
  }

  const insulationThickness = node.insulated ? pickInsulationThickness(node.insulationR) : 0
  if (insulationThickness > 0) {
    const insulationMaterial = new MeshStandardMaterial({
      color: '#f0e4c8',
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.25,
    })
    addRun(
      radius + insulationThickness,
      widthM + insulationThickness * 2,
      heightM + insulationThickness * 2,
      insulationMaterial,
      'duct-insulation',
      0.01,
    )
  }

  return group
}
