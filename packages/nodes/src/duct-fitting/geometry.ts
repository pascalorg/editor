import type { GeometryContext } from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import {
  buildOvalSection,
  buildRectSection,
  buildSection,
  createDuctMaterial,
  INCHES_TO_METERS,
} from '../duct-segment/geometry'
import { DUCT_BODY_SLOT_ID } from '../shared/duct-body-paint'
import { localFittingPorts } from './ports'
import type { DuctFittingNode } from './schema'

const RADIAL_SEGMENTS = 24
const UP = new Vector3(0, 1, 0)

/**
 * Mitered rectangular elbow as ONE closed solid — the way sheet-metal
 * square elbows are actually folded. The rect profile sweeps from the
 * inlet face to the outlet face through a single miter ring lying on
 * the corner's bisector plane (the classic 2D miter-join offset:
 * join(u) = (wA + wB) · u / (1 + wA·wB)), so the two legs meet in a
 * crisp seam instead of interpenetrating boxes.
 *
 * Local frame: legs in the XZ plane (ports convention) so the fold hinge
 * is always local Y. `sweepM` is the profile dimension carried through the
 * bend (in the XZ bend plane); `cheekM` is the dimension that stays
 * constant along the hinge. Which physical dimension (width vs height)
 * plays each role depends on the elbow's world orientation and is decided
 * by the caller — a floor turn folds about vertical (cheek = height),
 * a wall riser folds about horizontal (cheek = width).
 *
 * Non-indexed triangles → flat face normals for the folded-metal look;
 * the closed solid renders double-sided so winding never makes a face
 * vanish.
 */
/**
 * Stadium (flat-oval) outline in profile (u, v) coordinates: u-extent
 * `uM`, v-extent `vM`, semicircular caps of the smaller dimension. The
 * caps land on whichever axis is longer, so a riser-rotated profile
 * (swapped roles) stays a valid stadium.
 */
function stadiumOutline(uM: number, vM: number, samplesPerCap = 10): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const r = Math.min(uM, vM) / 2
  const s = (Math.max(uM, vM) - Math.min(uM, vM)) / 2
  const cap = (cu: number, cv: number, startA: number) => {
    for (let i = 0; i <= samplesPerCap; i++) {
      const a = startA + (Math.PI * i) / samplesPerCap
      pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)])
    }
  }
  if (uM >= vM) {
    cap(s, 0, -Math.PI / 2)
    cap(-s, 0, Math.PI / 2)
  } else {
    cap(0, s, 0)
    cap(0, -s, Math.PI)
  }
  return pts
}

function buildMiteredElbow(
  inletPos: Vector3,
  outletPos: Vector3,
  sweepM: number,
  cheekM: number,
  profileShape: 'rect' | 'oval',
  material: Material,
): Mesh {
  const travelIn = inletPos.clone().multiplyScalar(-1).normalize() // inlet → junction
  const travelOut = outletPos.clone().normalize() // junction → outlet
  const wA = new Vector3().crossVectors(UP, travelIn).normalize()
  const wB = new Vector3().crossVectors(UP, travelOut).normalize()
  // Elbow turns are ≤ 90°, so wA·wB ≥ 0 and the join never degenerates.
  const miterScale = 1 / (1 + wA.dot(wB))
  const wJoin = new Vector3().addVectors(wA, wB)

  const hw = sweepM / 2
  const hh = cheekM / 2
  const corners: Array<[number, number]> =
    profileShape === 'oval'
      ? stadiumOutline(sweepM, cheekM)
      : [
          [hw, hh],
          [-hw, hh],
          [-hw, -hh],
          [hw, -hh],
        ]
  const n = corners.length
  const ring = (center: Vector3, uAxis: Vector3, scale = 1): Vector3[] =>
    corners.map(([u, v]) =>
      center
        .clone()
        .addScaledVector(uAxis, u * scale)
        .addScaledVector(UP, v),
    )

  const inletRing = ring(inletPos, wA)
  const miterRing = ring(new Vector3(0, 0, 0), wJoin, miterScale)
  const outletRing = ring(outletPos, wB)

  const positions: number[] = []
  const tri = (a: Vector3, b: Vector3, c: Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    tri(a, b, c)
    tri(a, c, d)
  }
  const skin = (from: Vector3[], to: Vector3[]) => {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n
      quad(from[k]!, to[k]!, to[k2]!, from[k2]!)
    }
  }
  skin(inletRing, miterRing)
  skin(miterRing, outletRing)
  // End caps — triangle fans so any convex profile closes.
  for (let k = 1; k < n - 1; k++) {
    tri(inletRing[0]!, inletRing[k]!, inletRing[k + 1]!)
    tri(outletRing[k + 1]!, outletRing[k]!, outletRing[0]!)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const solidMaterial = material.clone()
  solidMaterial.side = DoubleSide
  const mesh = new Mesh(geometry, solidMaterial)
  mesh.name = `fitting-elbow-${profileShape}`
  return mesh
}

/**
 * Square-to-round loft between a rect ring at `xRect` and a round ring
 * at `xRound`, both centered on the local X axis (the straight-through
 * run). Profiles are sampled at matching polar angles — the rect point
 * is the ray's intersection with the rectangle boundary — so the skin
 * twists nowhere. Non-indexed triangles + computed normals give the
 * faceted gore look of a real shop-made square-to-round.
 */
function buildRectToRoundLoft(
  xRect: number,
  xRound: number,
  widthM: number,
  heightM: number,
  radius: number,
  material: Material,
): Mesh {
  const hw = widthM / 2
  const hh = heightM / 2
  const rectRing: Vector3[] = []
  const roundRing: Vector3[] = []
  for (let i = 0; i < RADIAL_SEGMENTS; i++) {
    const theta = (2 * Math.PI * i) / RADIAL_SEGMENTS
    const cz = Math.cos(theta)
    const sy = Math.sin(theta)
    // Scale the unit ray until it hits the rectangle boundary. Width
    // spans local Z and height local Y — the same axes buildRectSection
    // gives a +X run.
    const t = 1 / Math.max(Math.abs(cz) / hw, Math.abs(sy) / hh)
    rectRing.push(new Vector3(xRect, t * sy, t * cz))
    roundRing.push(new Vector3(xRound, radius * sy, radius * cz))
  }

  const positions: number[] = []
  const tri = (a: Vector3, b: Vector3, c: Vector3) =>
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  for (let i = 0; i < RADIAL_SEGMENTS; i++) {
    const j = (i + 1) % RADIAL_SEGMENTS
    tri(rectRing[i]!, roundRing[i]!, roundRing[j]!)
    tri(rectRing[i]!, roundRing[j]!, rectRing[j]!)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const solidMaterial = material.clone()
  solidMaterial.side = DoubleSide
  const mesh = new Mesh(geometry, solidMaterial)
  mesh.name = 'fitting-transition-loft'
  return mesh
}

/**
 * Pure geometry builder for a duct fitting, in the fitting's LOCAL frame —
 * `<ParametricNodeRenderer>` applies `node.position` / `node.rotation`.
 *
 * Strategy: one cylinder stub per port from the junction center outward
 * (reusing the segment builder's `buildSection`), a sphere at the
 * junction, and a slightly-oversized crimp collar ring at each port
 * opening so fittings read as sheet-metal junctions rather than bare
 * tube ends.
 *
 * The reducer is special-cased: instead of equal stubs + sphere it draws
 * a short inlet stub, a tapered cone, and a short outlet stub inline.
 *
 * Non-round shapes (elbow / tee): run legs carry the fitting's
 * width × height profile — rect prisms or flat-oval stadiums — matching
 * the trunk they join; a tee's branch leg carries its own `shape2`
 * profile (width2 × height2, or round at `diameter2`). The profile's
 * height rides local +Y — for the horizontal-plane orientations trunks
 * are drawn in, that's world-vertical.
 */
export function buildDuctFittingGeometry(
  node: DuctFittingNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  const material = createDuctMaterial(
    node,
    ctx?.materials,
    shading,
    textures,
    colorPreset,
    sceneTheme,
  )
  const radiusMain = (node.diameter * INCHES_TO_METERS) / 2
  const ports = localFittingPorts(node)
  const widthM = node.width * INCHES_TO_METERS
  const heightM = node.height * INCHES_TO_METERS
  // The elbow folds about its local Y. Width spans the XZ bend plane and
  // height rides the hinge ONLY when local Y is world-vertical (a floor
  // turn). For a riser the node is rotated so local Y lands horizontal —
  // then it's width that runs along the hinge, so the roles swap. Pick by
  // where world-up sits in the fitting's local frame.
  const hingeWorld = UP.clone().applyEuler(
    new Euler(node.rotation[0], node.rotation[1], node.rotation[2]),
  )
  const hingeIsVertical = Math.abs(hingeWorld.y) >= Math.SQRT1_2

  if (node.fittingType === 'reducer') {
    const radiusOut = (node.diameter2 * INCHES_TO_METERS) / 2
    const inlet = ports[0]!
    const outlet = ports[1]!
    const taperHalf = Math.abs(inlet.position.x) / 3
    const stubA = buildSection(
      inlet.position,
      new Vector3(-taperHalf, 0, 0),
      radiusMain,
      material,
      'fitting-stub-inlet',
    )
    if (stubA) group.add(stubA)
    const cone = new Mesh(
      new CylinderGeometry(radiusOut, radiusMain, taperHalf * 2, RADIAL_SEGMENTS, 1, false),
      material,
    )
    cone.name = 'fitting-taper'
    cone.quaternion.setFromUnitVectors(UP, new Vector3(1, 0, 0))
    group.add(cone)
    const stubB = buildSection(
      new Vector3(taperHalf, 0, 0),
      outlet.position,
      radiusOut,
      material,
      'fitting-stub-outlet',
    )
    if (stubB) group.add(stubB)
  } else if (node.fittingType === 'transition') {
    // Square-to-round: rect stub on the inlet, lofted gore body through
    // the junction, round stub on the outlet. Same inline layout as the
    // reducer, with the taper replaced by the loft.
    const radiusOut = (node.diameter2 * INCHES_TO_METERS) / 2
    const inlet = ports[0]!
    const outlet = ports[1]!
    const taperHalf = Math.abs(inlet.position.x) / 3
    const stubA = buildRectSection(
      inlet.position,
      new Vector3(-taperHalf, 0, 0),
      widthM,
      heightM,
      material,
      'fitting-stub-inlet',
    )
    if (stubA) group.add(stubA)
    group.add(buildRectToRoundLoft(-taperHalf, taperHalf, widthM, heightM, radiusOut, material))
    const stubB = buildSection(
      new Vector3(taperHalf, 0, 0),
      outlet.position,
      radiusOut,
      material,
      'fitting-stub-outlet',
    )
    if (stubB) group.add(stubB)
  } else if (node.shape !== 'round' && node.fittingType === 'elbow') {
    // One mitered solid — no stubs, no junction blob. Oval profiles
    // sweep the same way; the ring is a stadium instead of 4 corners.
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    group.add(
      buildMiteredElbow(
        inlet.position,
        outlet.position,
        hingeIsVertical ? widthM : heightM,
        hingeIsVertical ? heightM : widthM,
        node.shape,
        material,
      ),
    )
  } else if (node.shape !== 'round' && node.fittingType === 'tee') {
    // Straight rect / oval run inlet→outlet (one prism — nothing to
    // miter) plus a branch leg tapping its side. The branch carries its
    // own profile: rect or oval at width2 × height2, round at diameter2.
    //
    // Same orientation swap as the elbow: the run prism and branch stub
    // are built on the `rectSectionAxes` basis, whose height rides local
    // +Y. That's world-vertical only when the tee's local Y stays vertical
    // (a flat tap off a horizontal trunk). When the tee is rotated so
    // local Y lands horizontal, width and height roles swap so the
    // physical height keeps reading as the vertical face — without this a
    // tee drawn along the perpendicular axis looks squished.
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const branch = ports.find((p) => p.id === 'branch')!
    const width2M = node.width2 * INCHES_TO_METERS
    const height2M = node.height2 * INCHES_TO_METERS
    const buildRunSection = node.shape === 'oval' ? buildOvalSection : buildRectSection
    const run = buildRunSection(
      inlet.position,
      outlet.position,
      hingeIsVertical ? widthM : heightM,
      hingeIsVertical ? heightM : widthM,
      material,
      'fitting-run',
    )
    if (run) group.add(run)
    const buildBranchSection = node.shape2 === 'oval' ? buildOvalSection : buildRectSection
    const stub =
      node.shape2 !== 'round'
        ? buildBranchSection(
            new Vector3(0, 0, 0),
            branch.position,
            hingeIsVertical ? width2M : height2M,
            hingeIsVertical ? height2M : width2M,
            material,
            'fitting-stub-branch',
          )
        : buildSection(
            new Vector3(0, 0, 0),
            branch.position,
            (branch.diameter * INCHES_TO_METERS) / 2,
            material,
            'fitting-stub-branch',
          )
    if (stub) group.add(stub)
  } else if (node.shape !== 'round' && node.fittingType === 'cross') {
    // Straight rect / oval run inlet→outlet plus two opposed branch legs
    // (±Z) carrying the branch profile — both halves of the run that
    // passed through, same size at `width2 × height2` / `diameter2`. Same
    // orientation swap as the tee / elbow so the cross stays upright when
    // rotated so its local Y lands horizontal.
    const inlet = ports.find((p) => p.id === 'inlet')!
    const outlet = ports.find((p) => p.id === 'outlet')!
    const width2M = node.width2 * INCHES_TO_METERS
    const height2M = node.height2 * INCHES_TO_METERS
    const buildRunSection = node.shape === 'oval' ? buildOvalSection : buildRectSection
    const run = buildRunSection(
      inlet.position,
      outlet.position,
      hingeIsVertical ? widthM : heightM,
      hingeIsVertical ? heightM : widthM,
      material,
      'fitting-run',
    )
    if (run) group.add(run)
    const buildBranchSection = node.shape2 === 'oval' ? buildOvalSection : buildRectSection
    for (const id of ['branch', 'branch2'] as const) {
      const branch = ports.find((p) => p.id === id)!
      const stub =
        node.shape2 !== 'round'
          ? buildBranchSection(
              new Vector3(0, 0, 0),
              branch.position,
              hingeIsVertical ? width2M : height2M,
              hingeIsVertical ? height2M : width2M,
              material,
              `fitting-stub-${id}`,
            )
          : buildSection(
              new Vector3(0, 0, 0),
              branch.position,
              (branch.diameter * INCHES_TO_METERS) / 2,
              material,
              `fitting-stub-${id}`,
            )
      if (stub) group.add(stub)
    }
  } else {
    for (const port of ports) {
      const stub = buildSection(
        new Vector3(0, 0, 0),
        port.position,
        (port.diameter * INCHES_TO_METERS) / 2,
        material,
        `fitting-stub-${port.id}`,
      )
      if (stub) group.add(stub)
    }
    const junction = new Mesh(new SphereGeometry(radiusMain * 1.02, RADIAL_SEGMENTS, 12), material)
    junction.name = 'fitting-junction'
    group.add(junction)
  }

  // Joint trim at each opening. Round legs get a crimp-collar torus just
  // proud of the stub; rect legs get a drive-cleat flange — the thin
  // raised rim (TDC/S-cleat) real sheet-metal trunk joints wear where a
  // section meets a fitting. The plate is centered on the collar plane so
  // the rim reads as the seam between fitting and duct. Run legs
  // (inlet/outlet) are rect when `shape` is rect; a rect tee's branch is
  // rect when `shape2` is rect. Reducers ignore shape.
  // Which profile a leg's opening carries: a transition's inlet is its
  // rect end regardless of `shape`; reducers are always round; otherwise
  // the run legs follow `shape` and a tee's branch follows `shape2`
  // (only meaningful when the run itself is non-round).
  const legShape = (portId: string): 'round' | 'rect' | 'oval' => {
    if (node.fittingType === 'transition') return portId === 'inlet' ? 'rect' : 'round'
    if (node.fittingType === 'reducer' || node.shape === 'round') return 'round'
    return portId === 'branch' || portId === 'branch2' ? node.shape2 : node.shape
  }
  // The flange's profile must match the leg it caps: the branch carries
  // its own width2 × height2; elbow legs swap width/height roles when the
  // fold hinge lies horizontal (riser elbows) — same choice as the
  // mitered solid above.
  const rectLegProfile = (portId: string): [number, number] => {
    if (portId === 'branch' || portId === 'branch2') {
      const width2M = node.width2 * INCHES_TO_METERS
      const height2M = node.height2 * INCHES_TO_METERS
      return hingeIsVertical ? [width2M, height2M] : [height2M, width2M]
    }
    if (!hingeIsVertical) return [heightM, widthM]
    return [widthM, heightM]
  }
  const FLANGE_LIP_M = 0.02
  const FLANGE_THICK_M = 0.012
  for (const port of ports) {
    const profile = legShape(port.id)
    if (profile !== 'round') {
      const [w, h] = rectLegProfile(port.id)
      const start = port.position.clone().addScaledVector(port.direction, -FLANGE_THICK_M / 2)
      const end = port.position.clone().addScaledVector(port.direction, FLANGE_THICK_M / 2)
      const buildFlange = profile === 'oval' ? buildOvalSection : buildRectSection
      const flange = buildFlange(
        start,
        end,
        w + FLANGE_LIP_M * 2,
        h + FLANGE_LIP_M * 2,
        material,
        `fitting-flange-${port.id}`,
      )
      if (flange) group.add(flange)
      continue
    }
    const radius = (port.diameter * INCHES_TO_METERS) / 2
    const collar = new Mesh(new TorusGeometry(radius, radius * 0.12, 8, RADIAL_SEGMENTS), material)
    collar.name = `fitting-collar-${port.id}`
    collar.position.copy(port.position)
    collar.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), port.direction)
    group.add(collar)
  }

  group.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) mesh.userData.slotId = DUCT_BODY_SLOT_ID
  })

  return group
}
