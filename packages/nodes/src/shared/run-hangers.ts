import {
  type AnyNode,
  type AnyNodeId,
  type DuctSegmentNode,
  type FloorplanGeometry,
  type GeometryContext,
  getWallBaseElevationForNodes,
  getWallCurveFrameAt,
  getWallEffectiveHeightForNodes,
  getWallThickness,
  type PipeSegmentNode,
  pointInPolygon,
  resolveCeilingHeight,
} from '@pascal-app/core'
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { rectSectionAxes } from '../duct-segment/geometry'
import { hasWallChildOverlap, resolveWallAttachmentAtPlanPoint } from './wall-attach-target'

export type SupportedRun = DuctSegmentNode | PipeSegmentNode
export type RunHanger = { center: Vector3; anchor: Vector3; direction: Vector3; hostId: AnyNodeId }

export function hangerSceneNodes(ctx?: GeometryContext): Record<AnyNodeId, AnyNode> {
  if (ctx?.sceneNodes) return ctx.sceneNodes
  const nodes: Record<AnyNodeId, AnyNode> = {}
  let root = ctx?.parent
  while (root?.parentId) {
    const parent = ctx?.resolve(root.parentId as AnyNodeId)
    if (!parent || parent.id === root.id) break
    root = parent
  }
  const visit = (node: AnyNode) => {
    if (nodes[node.id]) return
    nodes[node.id] = node
    if ('children' in node && Array.isArray(node.children)) {
      for (const id of node.children) {
        const child = ctx?.resolve(id as AnyNodeId)
        if (child) visit(child)
      }
    }
  }
  if (root) visit(root)
  return nodes
}

export type RunHangerSlot = {
  id: string
  segmentIndex: number
  fraction: number
  center: Vector3
  skipped: boolean
  hanger: RunHanger | null
}

export function planRunHangerSlots(
  run: SupportedRun,
  nodes: Record<AnyNodeId, AnyNode>,
): RunHangerSlot[] {
  if (!run.autoHangers || !run.parentId) return []
  const spacing = run.hangerSpacing ?? 1.5
  const reach = run.hangerMaxReach ?? 2
  if (!(Number.isFinite(spacing) && spacing > 0 && Number.isFinite(reach) && reach > 0)) return []
  const hosts = Object.values(nodes).filter(
    (n) => n.parentId === run.parentId && (n.type === 'wall' || n.type === 'ceiling'),
  )
  const result: RunHangerSlot[] = []
  for (let i = 1; i < run.path.length; i++) {
    const start = new Vector3(...run.path[i - 1]!)
    const delta = new Vector3(...run.path[i]!).sub(start)
    const length = delta.length()
    if (length < 0.05) continue
    const direction = delta.clone().normalize()
    const count = Math.max(1, Math.ceil(length / spacing))
    for (let j = 0; j < count; j++) {
      const id = `${i - 1}:${j}`
      const override = run.hangerOverrides?.[id]
      const fraction = override?.fraction ?? (j + 0.5) / count
      const center = start.clone().addScaledVector(delta, fraction)
      let best: RunHanger | null = null
      let distance = reach
      for (const host of hosts) {
        if (override?.skipped || (override?.hostId && override.hostId !== host.id)) continue
        let anchor: Vector3
        if (host.type === 'ceiling') {
          if (
            !pointInPolygon(center.x, center.z, host.polygon) ||
            host.holes.some((h) => pointInPolygon(center.x, center.z, h))
          )
            continue
          const height = resolveCeilingHeight(host, nodes)
          if (height < center.y) continue
          anchor = new Vector3(center.x, height, center.z)
        } else if (host.type === 'wall') {
          const thickness = getWallThickness(host)
          const hit = resolveWallAttachmentAtPlanPoint(
            host,
            [center.x, center.z],
            reach + thickness,
          )
          if (!hit) continue
          const base = getWallBaseElevationForNodes(host, nodes)
          const top = base + getWallEffectiveHeightForNodes(host, nodes)
          if (center.y < base || center.y > top) continue
          if (hasWallChildOverlap(host.id, nodes, hit.localX, center.y - base, 0.08, 0.08)) continue
          const frame = getWallCurveFrameAt(host, hit.localX / hit.wallLength)
          const side = hit.perpDistance >= 0 ? 1 : -1
          anchor = new Vector3(
            frame.point.x - (hit.dirY * side * thickness) / 2,
            center.y,
            frame.point.y + (hit.dirX * side * thickness) / 2,
          )
          if (Math.abs(hit.perpDistance) < thickness / 2 - 0.001) continue
        } else continue
        const d = anchor.distanceTo(center)
        // A support along the run would overlap its body instead of holding it.
        if (d < 1e-6 || Math.abs(anchor.clone().sub(center).normalize().dot(direction)) > 0.95)
          continue
        if (d <= distance) {
          best = { center, anchor, direction, hostId: host.id }
          distance = d
        }
      }
      result.push({
        id,
        segmentIndex: i - 1,
        fraction,
        center,
        skipped: !!override?.skipped,
        hanger: best,
      })
    }
  }
  return result
}

export function planRunHangers(run: SupportedRun, nodes: Record<AnyNodeId, AnyNode>): RunHanger[] {
  return planRunHangerSlots(run, nodes).flatMap((slot) => (slot.hanger ? [slot.hanger] : []))
}

const BAND_THICKNESS = 0.006
const BAND_WIDTH = 0.025
const BAND_CLEARANCE = 0.002

function hangerProfile(run: SupportedRun) {
  const insulation =
    run.type === 'duct-segment' && run.insulated && run.insulationR > 0
      ? (0.5 + run.insulationR * 0.3125) * 0.0254
      : 0
  const round = run.type === 'pipe-segment' || run.shape === 'round'
  const shape = round ? 'round' : run.shape
  const w = ((round ? run.diameter : run.width) * 0.0254) / 2 + insulation + BAND_CLEARANCE
  const h = ((round ? run.diameter : run.height) * 0.0254) / 2 + insulation + BAND_CLEARANCE
  return { shape, w, h }
}

function profileContour(run: SupportedRun, offset: number): Vector2[] {
  const { shape, w, h } = hangerProfile(run)
  if (shape === 'rect') {
    return [
      new Vector2(-w - offset, -h - offset),
      new Vector2(w + offset, -h - offset),
      new Vector2(w + offset, h + offset),
      new Vector2(-w - offset, h + offset),
    ]
  }
  const radius = Math.min(w, h) + offset
  const straight = Math.abs(w - h)
  const points: Vector2[] = []
  for (const half of [0, 1]) {
    for (let i = 0; i <= 32; i++) {
      const angle = -Math.PI / 2 + half * Math.PI + (i * Math.PI) / 32
      const major = Math.cos(angle) * radius + (half === 0 ? straight : -straight)
      const minor = Math.sin(angle) * radius
      points.push(w >= h ? new Vector2(major, minor) : new Vector2(-minor, major))
    }
  }
  return points
}

export function buildHangerBandGeometry(run: SupportedRun): ExtrudeGeometry {
  // One annular extrusion shares the corner vertices, so the inside and
  // outside edges meet at the same miter without overlapping end caps.
  const shape = new Shape(profileContour(run, BAND_THICKNESS))
  shape.holes.push(new Path(profileContour(run, 0).reverse()))
  const geometry = new ExtrudeGeometry(shape, { depth: BAND_WIDTH, bevelEnabled: false, steps: 1 })
  geometry.translate(0, 0, -BAND_WIDTH / 2)
  return geometry
}

export function hangerSupportLines(run: SupportedRun, hanger: RunHanger): [Vector3, Vector3][] {
  const { center, anchor, direction } = hanger
  const towardHost = anchor.clone().sub(center).normalize()
  const { width, height } = rectSectionAxes(direction, run.type === 'duct-segment' ? run.roll : 0)
  const { shape, w, h } = hangerProfile(run)
  const contact = (axis: Vector3) => {
    const x = axis.dot(width)
    const y = axis.dot(height)
    if (shape === 'rect') {
      return width
        .clone()
        .multiplyScalar(Math.abs(x) < 1e-8 ? 0 : Math.sign(x) * (w + BAND_THICKNESS / 2))
        .addScaledVector(height, Math.abs(y) < 1e-8 ? 0 : Math.sign(y) * (h + BAND_THICKNESS / 2))
    }
    const radius = Math.min(w, h) + BAND_THICKNESS / 2
    const length = Math.hypot(x, y)
    return width
      .clone()
      .multiplyScalar((x / length) * radius + (w > h ? Math.sign(x) * (w - h) : 0))
      .addScaledVector(height, (y / length) * radius + (h > w ? Math.sign(y) * (h - w) : 0))
  }
  if (run.hangerStyle !== 'double') return [[center.clone().add(contact(towardHost)), anchor]]
  const side = new Vector3().crossVectors(direction, towardHost).normalize()
  return [-1, 1].map((sign) => {
    const offset = contact(side.clone().multiplyScalar(sign))
    const from = center.clone().add(offset)
    // Project each connection onto the host plane instead of translating
    // the anchor toward/away from it when the duct cross-section is rolled.
    const to = from.clone().addScaledVector(towardHost, anchor.clone().sub(from).dot(towardHost))
    return [from, to]
  })
}

export function buildRunHangers(run: SupportedRun, ctx?: GeometryContext): Group {
  const group = new Group()
  group.name = 'auto-hangers'
  if (!run.autoHangers) return group
  const hangers = planRunHangers(run, hangerSceneNodes(ctx))
  if (!hangers.length) return group
  const material = new MeshStandardMaterial({ color: '#92989e', metalness: 0.75, roughness: 0.4 })
  const rod = (a: Vector3, b: Vector3, radius = 0.006) => {
    const delta = b.clone().sub(a)
    if (delta.length() < 1e-6) return
    const mesh = new Mesh(new CylinderGeometry(radius, radius, delta.length(), 8), material)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize())
    group.add(mesh)
  }
  for (const hanger of hangers) {
    const { center, anchor, direction } = hanger
    const { width, height } = rectSectionAxes(direction, run.type === 'duct-segment' ? run.roll : 0)
    const band = new Mesh(buildHangerBandGeometry(run), material)
    band.name = 'hanger-band'
    band.position.copy(center)
    band.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(width, height, direction.clone().negate()),
    )
    group.add(band)
    const lines = hangerSupportLines(run, hanger)
    for (const [from, to] of lines) {
      rod(from, to)
      const plate = new Mesh(new BoxGeometry(0.08, 0.08, 0.008), material)
      plate.position.copy(to)
      plate.quaternion.setFromUnitVectors(
        new Vector3(0, 0, 1),
        anchor.clone().sub(center).normalize(),
      )
      group.add(plate)
    }
  }
  return group
}

export function runHangerFloorplan(run: SupportedRun, ctx: GeometryContext): FloorplanGeometry[] {
  if (!run.autoHangers) return []
  return planRunHangers(run, hangerSceneNodes(ctx)).flatMap((hanger): FloorplanGeometry[] => {
    const { center, direction } = hanger
    const side = new Vector3(-direction.z, 0, direction.x)
      .normalize()
      .multiplyScalar(
        ((run.type === 'duct-segment' && run.shape !== 'round' ? run.width : run.diameter) *
          0.0254) /
          2 +
          0.04,
      )
    return [
      {
        kind: 'polyline',
        points: [
          [center.x - side.x, center.z - side.z],
          [center.x + side.x, center.z + side.z],
        ],
        stroke: '#92989e',
        strokeWidth: 2,
        vectorEffect: 'non-scaling-stroke',
      },
      ...hangerSupportLines(run, hanger).map(
        ([from, to]): FloorplanGeometry => ({
          kind: 'polyline',
          points: [
            [from.x, from.z],
            [to.x, to.z],
          ],
          stroke: '#92989e',
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
        }),
      ),
    ]
  })
}
