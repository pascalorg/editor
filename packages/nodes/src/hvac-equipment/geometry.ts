import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  TorusGeometry,
  Vector3,
} from 'three'
import {
  createOvalSectionGeometry,
  INCHES_TO_METERS,
  rectSectionAxes,
} from '../duct-segment/geometry'
import { localEquipmentPorts, localRefrigerantPorts } from './ports'
import type { HvacEquipmentNode } from './schema'

const RADIAL_SEGMENTS = 24
const SMALL_SEGMENTS = 16

// Shared cabinet white used by every equipment body (furnace, air handler,
// condenser) so the units read as one product family.
const EQUIPMENT_WHITE = '#eef0f2'
const EQUIPMENT_TRIM = '#cfd3d8'

const CABINET_COLOR = EQUIPMENT_WHITE
const PANEL_COLOR = EQUIPMENT_TRIM
const CONTROL_COLOR = '#3f4549'
const CONDENSER_COLOR = EQUIPMENT_WHITE
const CONDENSER_FRAME_COLOR = EQUIPMENT_TRIM
const CONDENSER_FIN_COLOR = '#9aa1a8'
const FAN_COLOR = '#3f4549'
const BLOWER_COLOR = '#2f6fb0'
const BLOWER_BLADE_COLOR = '#274f7d'
const BURNER_COLOR = '#d9772e'
const GAS_PIPE_COLOR = '#d2691e'
const AIR_HANDLER_COLOR = EQUIPMENT_WHITE
const FAN_GRILLE_COLOR = '#3a3f44'
const FAN_BLADE_COLOR = '#d7dade'
const COIL_FIN_COLOR = '#9aa1a8'
const COPPER_COLOR = '#b06b3f'
const SERVICE_VALVE_COLOR = '#7a8086'

const UP = new Vector3(0, 1, 0)

/**
 * Pure geometry builder for an HVAC equipment cabinet, in the node's
 * LOCAL frame (origin at base center, +Z front, +X right) —
 * `<ParametricNodeRenderer>` applies `position` + yaw.
 *
 * Furnace / air handler: the cabinet is built from individual sheet-metal
 * walls (not a solid box) so the lower front can be left OPEN — a real
 * cut that exposes the squirrel-cage circulating fan and, on a furnace,
 * the orange burner manifold and gas valve. Furnaces also get the
 * combustion train from the reference drawing: a draft hood + vent
 * connector elbow on top and a gas pipe with drip leg down the front-left.
 *
 * Air handler: tall white cabinet with two stacked guarded axial fans on
 * the front and finned coil bands down the sides (vertical fan-coil look).
 * Condenser: squat cabinet with a fan ring and hub on top.
 */
export function buildHvacEquipmentGeometry(node: HvacEquipmentNode): Group {
  const group = new Group()
  if (node.equipmentType === 'condenser') return buildCondenser(node, group)
  if (node.equipmentType === 'air-handler') return buildAirHandler(node, group)

  const W = node.width
  const H = node.height
  const D = node.depth
  const hw = W / 2
  const hd = D / 2
  const t = Math.min(0.02, W * 0.04, D * 0.04)

  // Single-sided. Each wall is a thin slab whose interior-facing face is an
  // outward face of its own box, so the cut still shows metal inside — and
  // single-sided culling means coplanar butt joints can't z-fight.
  const cabinet = new MeshStandardMaterial({
    color: CABINET_COLOR,
    metalness: 0.55,
    roughness: 0.45,
  })

  const addBox = (
    w: number,
    h: number,
    dd: number,
    mat: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    name: string,
  ) => {
    const mesh = new Mesh(new BoxGeometry(w, h, dd), mat)
    mesh.name = name
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  const frontZ = hd - t / 2
  buildCabinetShell(node, group, cabinet, false)

  // Front opening: framed sill, jambs and an upper control panel, all inset
  // to (W - 2t) so they tuck between the side walls. The gap between sill
  // and panel (and inside the jambs) is the visible cut.
  const openBottom = H * 0.1
  const openTop = H * 0.58
  const jamb = W * 0.08
  const frontW = W - 2 * t
  const frontHalf = frontW / 2
  const panelMat = new MeshStandardMaterial({
    color: PANEL_COLOR,
    metalness: 0.5,
    roughness: 0.5,
  })
  addBox(frontW, openBottom - t, t, cabinet, 0, (t + openBottom) / 2, frontZ, 'equipment-sill')
  addBox(frontW, H - t - openTop, t, panelMat, 0, (openTop + H - t) / 2, frontZ, 'equipment-panel')
  addBox(
    jamb,
    openTop - openBottom,
    t,
    cabinet,
    -frontHalf + jamb / 2,
    (openBottom + openTop) / 2,
    frontZ,
    'equipment-jamb-l',
  )
  addBox(
    jamb,
    openTop - openBottom,
    t,
    cabinet,
    frontHalf - jamb / 2,
    (openBottom + openTop) / 2,
    frontZ,
    'equipment-jamb-r',
  )

  // ── Control area on the upper front panel (fan-limit switch + cover).
  const ctrlMat = new MeshStandardMaterial({
    color: CONTROL_COLOR,
    metalness: 0.4,
    roughness: 0.6,
  })
  addBox(
    W * 0.34,
    (H - openTop) * 0.5,
    0.012,
    ctrlMat,
    W * 0.18,
    (openTop + H) / 2,
    frontZ + 0.008,
    'equipment-control',
  )
  addBox(
    W * 0.1,
    (H - openTop) * 0.3,
    0.02,
    ctrlMat,
    -W * 0.22,
    (openTop + H) / 2,
    frontZ + 0.012,
    'equipment-switch',
  )

  // ── Squirrel-cage circulating fan, seated in the open lower cavity. The
  // round scroll housing faces front (+Z) so it shows through the cut.
  const rB = Math.min(W * 0.34, (openTop - openBottom) * 0.42)
  const housingD = D * 0.42
  const cy = openBottom + rB + 0.01
  const zc = hd - t - housingD / 2 - 0.01
  const blowerMat = new MeshStandardMaterial({
    color: BLOWER_COLOR,
    metalness: 0.3,
    roughness: 0.6,
  })
  const bladeMat = new MeshStandardMaterial({
    color: BLOWER_BLADE_COLOR,
    metalness: 0.2,
    roughness: 0.75,
  })
  const housing = new Mesh(new CylinderGeometry(rB, rB, housingD, RADIAL_SEGMENTS), blowerMat)
  housing.name = 'blower-housing'
  housing.rotation.x = Math.PI / 2 // axis Y → axis Z (round face toward front)
  housing.position.set(0, cy, zc)
  group.add(housing)
  const intake = new Mesh(new TorusGeometry(rB * 0.7, rB * 0.12, 10, RADIAL_SEGMENTS), blowerMat)
  intake.name = 'blower-intake'
  intake.position.set(0, cy, hd - t - 0.005)
  group.add(intake)
  const hub = new Mesh(
    new CylinderGeometry(rB * 0.18, rB * 0.18, housingD * 0.9, SMALL_SEGMENTS),
    bladeMat,
  )
  hub.name = 'blower-hub'
  hub.rotation.x = Math.PI / 2
  hub.position.set(0, cy, zc)
  group.add(hub)
  // Radial cage blades around the hub axis (Z).
  const BLADES = 14
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2
    const blade = new Mesh(new BoxGeometry(0.006, rB * 0.62, housingD * 0.82), bladeMat)
    blade.name = `blower-blade-${i}`
    blade.position.set(Math.cos(a) * rB * 0.5, cy + Math.sin(a) * rB * 0.5, zc)
    blade.rotation.z = a
    group.add(blade)
  }

  buildCombustionTrain(node, group, { hw, hd, H, openTop, frontZ })
  buildGasLine(node, group, { hw, hd, H })

  buildCollars(node, group)
  buildServiceValves(node, group)
  return group
}

/** Orange burner manifold + gas valve above the blower (furnace only). */
function buildCombustionTrain(
  node: HvacEquipmentNode,
  group: Group,
  dims: { hw: number; hd: number; H: number; openTop: number; frontZ: number },
): void {
  const { hw, hd, H, openTop } = dims
  const burnerMat = new MeshStandardMaterial({
    color: BURNER_COLOR,
    metalness: 0.35,
    roughness: 0.55,
    emissive: BURNER_COLOR,
    emissiveIntensity: 0.12,
  })
  const y = openTop - 0.12
  const z = hd - node.depth * 0.32

  // Manifold pipe running across the unit (axis X), feeding the burners.
  const manifold = new Mesh(
    new CylinderGeometry(0.018, 0.018, node.width * 0.66, SMALL_SEGMENTS),
    burnerMat,
  )
  manifold.name = 'burner-manifold'
  manifold.rotation.z = Math.PI / 2
  manifold.position.set(-node.width * 0.05, y, z)
  group.add(manifold)

  // 4 burner tubes shooting back into the heat exchanger (axis Z).
  const tubes = 4
  for (let i = 0; i < tubes; i++) {
    const x = (-(tubes - 1) / 2 + i) * (node.width * 0.16)
    const tube = new Mesh(
      new CylinderGeometry(0.022, 0.022, node.depth * 0.34, SMALL_SEGMENTS),
      burnerMat,
    )
    tube.name = `burner-tube-${i}`
    tube.rotation.x = Math.PI / 2
    tube.position.set(x, y, z - node.depth * 0.17)
    group.add(tube)
  }

  // Gas valve block at the right end of the manifold.
  const valve = new Mesh(new BoxGeometry(0.08, 0.07, 0.09), burnerMat)
  valve.name = 'gas-valve'
  valve.position.set(hw - 0.07, y, z + 0.02)
  group.add(valve)
}

/** Gas supply pipe with a capped drip leg, down the front-left (furnace). */
function buildGasLine(
  node: HvacEquipmentNode,
  group: Group,
  dims: { hw: number; hd: number; H: number },
): void {
  const { hw, hd, H } = dims
  const gasMat = new MeshStandardMaterial({
    color: GAS_PIPE_COLOR,
    metalness: 0.4,
    roughness: 0.5,
  })
  const r = 0.014
  const x = -hw + 0.06
  const z = hd + 0.03
  const teeY = H * 0.34

  // Vertical main running down the front-left face.
  const mainTop = H * 0.92
  const mainLen = mainTop - teeY
  const main = new Mesh(new CylinderGeometry(r, r, mainLen, SMALL_SEGMENTS), gasMat)
  main.name = 'gas-main'
  main.position.set(x, teeY + mainLen / 2, z)
  group.add(main)

  // Tee into the cabinet toward the gas valve (axis X, +).
  const tee = new Mesh(new CylinderGeometry(r, r, 0.12, SMALL_SEGMENTS), gasMat)
  tee.name = 'gas-tee'
  tee.rotation.z = Math.PI / 2
  tee.position.set(x + 0.06, teeY, z)
  group.add(tee)

  // Drip leg: short capped vertical pipe below the tee to catch sediment.
  const legLen = H * 0.14
  const leg = new Mesh(new CylinderGeometry(r, r, legLen, SMALL_SEGMENTS), gasMat)
  leg.name = 'gas-drip-leg'
  leg.position.set(x, teeY - legLen / 2, z)
  group.add(leg)
  const cap = new Mesh(new CylinderGeometry(r * 1.4, r * 1.4, 0.02, SMALL_SEGMENTS), gasMat)
  cap.name = 'gas-drip-cap'
  cap.position.set(x, teeY - legLen, z)
  group.add(cap)
}

type LocalPort = ReturnType<typeof localEquipmentPorts>[number]

type CollarSection = { shape: 'round' | 'rect' | 'oval'; widthM: number; heightM: number }

/**
 * Radial clearance (meters) the collar sleeve carries over the duct's
 * nominal cross-section. A duct run leaves the port at the advertised size;
 * the collar is built one clearance larger on every side so it reads as a
 * sheet-metal sleeve wrapping the duct — and so their faces never coincide
 * (no z-fighting where the run overlaps the stub). ~5 mm ≈ a real slip joint.
 */
const COLLAR_CLEARANCE_M = 0.005

/**
 * Collar cross-section in meters, already grown by `COLLAR_CLEARANCE_M` so
 * the sleeve sits over the duct. Round collapses to a single diameter on
 * both axes; rect / oval carry the explicit width × height (width is the
 * horizontal face, height the vertical). For round the port's `diameter`
 * is the true round size; for rect / oval it is the area-equivalent value
 * the port advertises, so the mesh uses width / height instead.
 */
function collarSection(port: LocalPort): CollarSection {
  const shape = port.shape ?? 'round'
  const grow = 2 * COLLAR_CLEARANCE_M
  if (shape === 'round') {
    const d = port.diameter * INCHES_TO_METERS + grow
    return { shape, widthM: d, heightM: d }
  }
  return {
    shape,
    widthM: (port.width ?? port.diameter) * INCHES_TO_METERS + grow,
    heightM: (port.height ?? port.diameter) * INCHES_TO_METERS + grow,
  }
}

/** Collar sleeve geometry with the run length on local Y and the
 * cross-section on local X (width) × Z (height) — the basis the caller
 * orients with `rectSectionAxes`. Round stays open-ended so you can see
 * straight through into the hole. */
function collarGeometry(section: CollarSection, length: number): BufferGeometry {
  if (section.shape === 'rect') return new BoxGeometry(section.widthM, length, section.heightM)
  if (section.shape === 'oval') {
    return createOvalSectionGeometry(section.widthM, section.heightM, length)
  }
  const r = section.widthM / 2
  return new CylinderGeometry(r, r, length, RADIAL_SEGMENTS, 1, true)
}

/**
 * Hole `Path` in the plate's local XY (width → X, height → Y), centered at
 * (`hx`, `hy`) and clamped to keep it inside the plate. Three.js corrects
 * hole winding when extruding, so the path direction here is irrelevant.
 */
function collarHolePath(
  section: CollarSection,
  hx: number,
  hy: number,
  maxHalfW: number,
  maxHalfH: number,
): Path | null {
  if (section.shape === 'rect') {
    const hw = Math.min(section.widthM / 2, maxHalfW)
    const hh = Math.min(section.heightM / 2, maxHalfH)
    if (hw <= 0 || hh <= 0) return null
    return new Path()
      .moveTo(hx - hw, hy - hh)
      .lineTo(hx + hw, hy - hh)
      .lineTo(hx + hw, hy + hh)
      .lineTo(hx - hw, hy + hh)
      .closePath()
  }
  if (section.shape === 'oval') {
    const w = Math.min(section.widthM, maxHalfW * 2)
    const h = Math.min(section.heightM, maxHalfH * 2)
    const r = Math.min(w, h) / 2
    const straight = Math.max(0, w - h) / 2
    if (r <= 0) return null
    const path = new Path()
    path.absarc(hx + straight, hy, r, -Math.PI / 2, Math.PI / 2, false)
    path.absarc(hx - straight, hy, r, Math.PI / 2, (3 * Math.PI) / 2, false)
    path.closePath()
    return path
  }
  const r = Math.min(section.widthM / 2, maxHalfW, maxHalfH)
  if (r <= 0) return null
  const path = new Path()
  path.absarc(hx, hy, r, 0, Math.PI * 2, true)
  return path
}

/**
 * Flat rectangular plate of `thickness`, centered on the origin in its own
 * XY plane (width → X, height → Y) and centered through the thickness on Z,
 * with the duct opening for `port` punched at (`hx`, `hy`). Callers rotate /
 * position it into a wall; the hole takes the collar's round / rect / oval
 * cross-section.
 */
function buildHolePlate(
  width: number,
  height: number,
  thickness: number,
  holes: { port: LocalPort; x: number; y: number }[],
  material: MeshStandardMaterial,
): Mesh {
  const hw = width / 2
  const hh = height / 2
  const shape = new Shape()
    .moveTo(-hw, -hh)
    .lineTo(hw, -hh)
    .lineTo(hw, hh)
    .lineTo(-hw, hh)
    .lineTo(-hw, -hh)

  for (const { port, x, y } of holes) {
    const hole = collarHolePath(
      collarSection(port),
      x,
      y,
      Math.max(0, hw - Math.abs(x)) * 0.95,
      Math.max(0, hh - Math.abs(y)) * 0.95,
    )
    if (hole) shape.holes.push(hole)
  }

  const geom = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  geom.translate(0, 0, -thickness / 2)
  geom.computeVertexNormals()
  return new Mesh(geom, material)
}

function buildCabinetShell(
  node: HvacEquipmentNode,
  group: Group,
  material: MeshStandardMaterial,
  front: boolean,
) {
  const { width: w, height: h, depth: d } = node
  const t = Math.min(0.02, w * 0.04, d * 0.04)
  const ports = localEquipmentPorts(node)
  const top = buildHolePlate(
    w,
    d,
    t,
    ports
      .filter((port) => port.direction.y > 0)
      .map((port) => ({ port, x: port.position.x, y: -port.position.z })),
    material,
  )
  top.name = 'equipment-top'
  top.rotation.x = -Math.PI / 2
  top.position.y = h - t / 2
  group.add(top)
  for (const side of [-1, 1]) {
    const wall = buildHolePlate(
      d,
      h - 2 * t,
      t,
      ports
        .filter((port) => port.direction.x === side)
        .map((port) => ({ port, x: -side * port.position.z, y: port.position.y - h / 2 })),
      material,
    )
    wall.name = side < 0 ? 'equipment-left' : 'equipment-right'
    wall.rotation.y = (side * Math.PI) / 2
    wall.position.set(side * (w / 2 - t / 2), h / 2, 0)
    group.add(wall)
  }
  const bottom = new Mesh(new BoxGeometry(w, t, d), material)
  bottom.position.y = t / 2
  group.add(bottom)
  for (const side of front ? [-1, 1] : [-1]) {
    const wall = new Mesh(new BoxGeometry(w - 2 * t, h - 2 * t, t), material)
    wall.position.set(0, h / 2, side * (d / 2 - t / 2))
    group.add(wall)
  }
}

/**
 * Sheet-metal sleeves at the supply/return ports. Each collar straddles the
 * wall hole — part inside the cabinet, part outside — so a duct run slides
 * through the opening instead of dead-ending on a panel. The collar takes
 * the port's round / rect / oval cross-section, oriented with the same
 * width-horizontal / height-vertical basis as the hole it sits in.
 */
function buildCollars(node: HvacEquipmentNode, group: Group): void {
  const collarMaterial = new MeshStandardMaterial({
    color: '#c2c2c2',
    metalness: 0.6,
    roughness: 0.4,
    side: 2,
  })
  const OUT = 0.12 // sleeve length outside the cabinet
  const IN = 0.05 // sleeve length reaching inside past the hole
  const length = OUT + IN
  for (const port of localEquipmentPorts(node)) {
    const dir = port.direction.clone().normalize()
    const sleeve = new Mesh(collarGeometry(collarSection(port), length), collarMaterial)
    sleeve.name = `equipment-collar-${port.id}`
    const { width: wAxis, height: hAxis } = rectSectionAxes(dir)
    sleeve.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(wAxis, dir, hAxis))
    sleeve.position.copy(port.position).addScaledVector(dir, (OUT - IN) / 2)
    group.add(sleeve)
  }
}

/** Sleeves wrap the outgoing lines at the cabinet face, preserving legacy port positions. */
function buildServiceValves(node: HvacEquipmentNode, group: Group): void {
  const valveMat = new MeshStandardMaterial({
    color: SERVICE_VALVE_COLOR,
    metalness: 0.7,
    roughness: 0.35,
  })
  const copperMat = new MeshStandardMaterial({
    color: COPPER_COLOR,
    metalness: 0.8,
    roughness: 0.3,
  })
  for (const port of localRefrigerantPorts(node)) {
    const dir = port.direction.clone().normalize()
    const radius = (port.diameter * INCHES_TO_METERS) / 2
    const body = new Mesh(new BoxGeometry(0.05, 0.06, Math.max(0.04, radius * 2.5)), valveMat)
    body.name = `service-valve-body-${port.id}`
    body.position.copy(port.position).addScaledVector(dir, 0.025)
    group.add(body)
    const stubLen = 0.07
    const stub = new Mesh(
      new CylinderGeometry(radius + 0.002, radius + 0.002, stubLen, SMALL_SEGMENTS, 1, true),
      copperMat,
    )
    stub.name = `service-valve-stub-${port.id}`
    stub.position.copy(port.position).addScaledVector(dir, stubLen / 2)
    stub.quaternion.setFromUnitVectors(UP, dir)
    group.add(stub)
  }
}

/**
 * Residential split-system condenser, matching the reference photos: a
 * greenish-grey body wrapped in vertical louvered coil fins on all four
 * sides, a dark base and dark top frame, and a top-mounted fan with a
 * radial wire guard (concentric rings + spokes) over a recessed throat.
 */
function buildCondenser(node: HvacEquipmentNode, group: Group): Group {
  const W = node.width
  const H = node.height
  const D = node.depth
  const hw = W / 2
  const hd = D / 2

  const bodyMat = new MeshStandardMaterial({
    color: CONDENSER_COLOR,
    metalness: 0.5,
    roughness: 0.5,
  })
  const frameMat = new MeshStandardMaterial({
    color: CONDENSER_FRAME_COLOR,
    metalness: 0.4,
    roughness: 0.6,
  })
  const finMat = new MeshStandardMaterial({
    color: CONDENSER_FIN_COLOR,
    metalness: 0.65,
    roughness: 0.4,
  })

  const frameH = Math.min(0.07, H * 0.09)
  const post = Math.min(0.04, W * 0.07)

  // Inner body the fins wrap around (inset so corner posts read proud).
  const body = new Mesh(new BoxGeometry(W - post, H - 2 * frameH, D - post), bodyMat)
  body.name = 'equipment-body'
  body.position.set(0, H / 2, 0)
  group.add(body)

  // Dark base + top frame rings.
  const base = new Mesh(new BoxGeometry(W, frameH, D), frameMat)
  base.name = 'condenser-base'
  base.position.set(0, frameH / 2, 0)
  group.add(base)
  const topFrame = new Mesh(new BoxGeometry(W, frameH, D), frameMat)
  topFrame.name = 'condenser-top-frame'
  topFrame.position.set(0, H - frameH / 2, 0)
  group.add(topFrame)

  // Corner posts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new Mesh(new BoxGeometry(post, H, post), frameMat)
      p.name = `condenser-post-${sx > 0 ? 'r' : 'l'}${sz > 0 ? 'f' : 'b'}`
      p.position.set(sx * (hw - post / 2), H / 2, sz * (hd - post / 2))
      group.add(p)
    }
  }

  // Vertical louvered coil fins on all four faces. Each fin is a thin
  // vertical slat standing slightly proud of the body; the gaps between
  // them read as the coil louvers.
  const finY = H / 2
  const finH = H - 2 * frameH
  const addFins = (count: number, span: number, fixed: number, axis: 'x' | 'z', sign: number) => {
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const c = -span / 2 + t * span
      const fin =
        axis === 'x'
          ? new Mesh(new BoxGeometry(0.006, finH, 0.018), finMat)
          : new Mesh(new BoxGeometry(0.018, finH, 0.006), finMat)
      fin.name = `condenser-fin-${axis}${sign > 0 ? '+' : '-'}-${i}`
      if (axis === 'x') fin.position.set(c, finY, sign * fixed)
      else fin.position.set(sign * fixed, finY, c)
      group.add(fin)
    }
  }
  const finsAlongW = Math.max(10, Math.round(W / 0.025))
  const finsAlongD = Math.max(10, Math.round(D / 0.025))
  addFins(finsAlongW, W - post, hd - post / 2 + 0.004, 'x', 1) // front
  addFins(finsAlongW, W - post, hd - post / 2 + 0.004, 'x', -1) // back
  addFins(finsAlongD, D - post, hw - post / 2 + 0.004, 'z', 1) // right
  addFins(finsAlongD, D - post, hw - post / 2 + 0.004, 'z', -1) // left

  buildCondenserFanGuard(group, W, H, D)
  buildServiceValves(node, group)
  return group
}

/** Top fan: recessed throat + hub/blades under a radial wire guard. */
function buildCondenserFanGuard(group: Group, W: number, H: number, D: number): void {
  const fanMat = new MeshStandardMaterial({
    color: FAN_COLOR,
    metalness: 0.3,
    roughness: 0.7,
  })
  const guardMat = new MeshStandardMaterial({
    color: CONDENSER_FRAME_COLOR,
    metalness: 0.4,
    roughness: 0.6,
  })
  const r = Math.min(W, D) * 0.4
  const deckY = H

  // Recessed throat dropping below the top deck so the fan reads as an
  // opening, not a disc sitting on the lid.
  const throat = new Mesh(new CylinderGeometry(r, r, H * 0.12, RADIAL_SEGMENTS, 1, true), fanMat)
  throat.name = 'condenser-fan-throat'
  throat.position.set(0, deckY - H * 0.06, 0)
  group.add(throat)

  // Hub + swept blades just below the deck.
  const bladeMat = new MeshStandardMaterial({
    color: '#5a6066',
    metalness: 0.3,
    roughness: 0.6,
  })
  const hub = new Mesh(new CylinderGeometry(r * 0.16, r * 0.16, 0.04, SMALL_SEGMENTS), bladeMat)
  hub.name = 'condenser-fan-hub'
  hub.position.set(0, deckY - 0.02, 0)
  group.add(hub)
  const BLADES = 6
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2
    const blade = new Mesh(new BoxGeometry(r * 0.7, 0.006, r * 0.28), bladeMat)
    blade.name = `condenser-fan-blade-${i}`
    blade.position.set(Math.cos(a) * r * 0.45, deckY - 0.02, Math.sin(a) * r * 0.45)
    blade.rotation.y = a
    blade.rotation.x = 0.35
    group.add(blade)
  }

  // Radial wire guard: concentric rings + spokes, slightly domed above deck.
  const guardY = deckY + 0.012
  for (let k = 1; k <= 5; k++) {
    const rr = (r * k) / 5
    const ring = new Mesh(new TorusGeometry(rr, 0.004, 6, RADIAL_SEGMENTS), guardMat)
    ring.name = `condenser-guard-ring-${k}`
    ring.rotation.x = Math.PI / 2
    ring.position.set(0, guardY, 0)
    group.add(ring)
  }
  const SPOKES = 8
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI
    const spoke = new Mesh(new BoxGeometry(r * 2, 0.004, 0.004), guardMat)
    spoke.name = `condenser-guard-spoke-${i}`
    spoke.position.set(0, guardY, 0)
    spoke.rotation.y = a
    group.add(spoke)
  }
}

/**
 * Guarded axial fan on the front (+Z) face: a recessed dark throat, a
 * spider hub with swept blades, and a concentric wire grille — the look of
 * the units in the air-handler reference. Centered at (`x`, `y`) on the
 * cabinet front at `frontZ`, radius `r`.
 */
function buildAxialFan(
  group: Group,
  x: number,
  y: number,
  frontZ: number,
  r: number,
  index: number,
): void {
  const grilleMat = new MeshStandardMaterial({
    color: FAN_GRILLE_COLOR,
    metalness: 0.4,
    roughness: 0.6,
  })
  const bladeMat = new MeshStandardMaterial({
    color: FAN_BLADE_COLOR,
    metalness: 0.3,
    roughness: 0.5,
  })

  // Recessed throat behind the blades so the fan reads as an opening.
  const throat = new Mesh(new CylinderGeometry(r, r, 0.04, RADIAL_SEGMENTS), grilleMat)
  throat.name = `fan-${index}-throat`
  throat.rotation.x = Math.PI / 2
  throat.position.set(x, y, frontZ - 0.02)
  group.add(throat)

  // Hub + swept blades, sitting just proud of the throat.
  const hub = new Mesh(new CylinderGeometry(r * 0.18, r * 0.18, 0.03, SMALL_SEGMENTS), bladeMat)
  hub.name = `fan-${index}-hub`
  hub.rotation.x = Math.PI / 2
  hub.position.set(x, y, frontZ + 0.005)
  group.add(hub)

  const BLADES = 5
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2
    const blade = new Mesh(new BoxGeometry(r * 0.34, 0.006, r * 0.78), bladeMat)
    blade.name = `fan-${index}-blade-${i}`
    // Position blade outward from hub, then tilt for an airfoil sweep.
    const br = r * 0.5
    blade.position.set(x + Math.cos(a) * br, y + Math.sin(a) * br, frontZ + 0.005)
    blade.rotation.z = a
    blade.rotation.y = 0.5
    group.add(blade)
  }

  // Concentric wire grille (rings) over the front of the fan.
  const ringMat = new MeshStandardMaterial({
    color: EQUIPMENT_TRIM,
    metalness: 0.5,
    roughness: 0.4,
  })
  for (let k = 1; k <= 3; k++) {
    const rr = (r * k) / 3
    const ring = new Mesh(new TorusGeometry(rr, 0.004, 6, RADIAL_SEGMENTS), ringMat)
    ring.name = `fan-${index}-grille-${k}`
    ring.position.set(x, y, frontZ + 0.02)
    group.add(ring)
  }
}

/**
 * Air handler / vertical fan-coil: a tall white cabinet with two stacked
 * guarded axial fans on the front and finned coil bands down both sides —
 * the unit in the reference photo. Keeps the supply/return collars (built
 * by the shared `buildCollars`) so duct runs still connect.
 */
function buildAirHandler(node: HvacEquipmentNode, group: Group): Group {
  const W = node.width
  const H = node.height
  const D = node.depth
  const hw = W / 2
  const hd = D / 2

  const cabinetMat = new MeshStandardMaterial({
    color: AIR_HANDLER_COLOR,
    metalness: 0.3,
    roughness: 0.55,
  })
  const finMat = new MeshStandardMaterial({
    color: COIL_FIN_COLOR,
    metalness: 0.6,
    roughness: 0.45,
  })

  buildCabinetShell(node, group, cabinetMat, true)
  const capH = Math.min(0.05, H * 0.06)

  // Two stacked axial fans on the front face, sized to the cabinet width.
  const frontZ = hd + 0.001
  const fanR = Math.min(W * 0.4, H * 0.22)
  const margin = capH + fanR + H * 0.04
  buildAxialFan(group, 0, H - margin, frontZ, fanR, 0)
  buildAxialFan(group, 0, margin, frontZ, fanR, 1)

  // Finned coil bands down both sides (horizontal slats = condenser fins).
  const fins = Math.max(6, Math.floor(H / 0.06))
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < fins; i++) {
      const fy = capH + ((i + 0.5) / fins) * (H - 2 * capH)
      const fin = new Mesh(new BoxGeometry(0.004, 0.012, D * 0.82), finMat)
      fin.name = `coil-fin-${side > 0 ? 'r' : 'l'}-${i}`
      fin.position.set(side * (hw + 0.002), fy, 0)
      group.add(fin)
    }
  }

  buildCollars(node, group)
  buildServiceValves(node, group)
  return group
}
