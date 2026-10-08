import {
  type AnyNode,
  area,
  type BuildingNode,
  buildUnitReport,
  type CameraControlFrameEvent,
  containsPoint,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  getLevelDisplayName,
  type LevelNode,
  type NodeEvent,
  resolveSelectionProxyId,
  sceneRegistry,
  type UnitNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CameraControlsImpl } from '@react-three/drei'
import { useEffect } from 'react'
import {
  Box3,
  type Camera,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three'
import { nodeDisplayLabel } from './node-display-label'
import { roomFloorElevation } from './room-handle-drag'
import { RoomSelectionIndex, type RoomSelectionRecord, resolveRoomHit } from './room-selection'
import type { SelectionModifierKeys } from './selection-routing'

// One selection model for every viewer surface: the published viewer (baked
// GLB or parametric), its embed and the editor's Preview. Each renderer only
// turns a pointer hit into a `ViewerPick`; these rules decide what it selects,
// on `useViewer.selection`:
//   levelId     the current floor
//   zoneId      the selected room (or zone)
//   selectedIds the selected element or item

export type ViewerNodes = Readonly<Record<string, AnyNode>>

/** The scene a viewer surface shows: its graph, and the 3D object standing for an id. */
export type ViewerSource = {
  nodes: ViewerNodes
  objectFor: (id: string) => Object3D | undefined
}

/** A pointer hit, whichever renderer took it: the node and the hit in its level's local XZ. */
export type ViewerPick = { nodeId: string; point: readonly [number, number] | null }

export type ViewerSelection = {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  zoneId: ZoneNode['id'] | null
  selectedIds: string[]
}

type ViewerTarget =
  | { kind: 'room'; levelId: string; zoneId: string }
  | { kind: 'node'; levelId: string | null; nodeId: string; zoneId: string | null }

const NO_MODIFIERS: SelectionModifierKeys = { alt: false, ctrl: false, meta: false, shift: false }

/** Surfaces a room is picked through, room first: its walls, its floor, its ceiling. */
const ROOM_SURFACES = new Set(['wall', 'slab', 'ceiling'])

/** Kinds a viewer click never lands on: they pass the pointer to what lies behind. */
export const VIEWER_PASS_THROUGH_KINDS: ReadonlySet<string> = new Set([
  'site',
  'building',
  'level',
  'zone',
  'ceiling',
  'scan',
  'guide',
  'spawn',
])

const indexes = new WeakMap<ViewerNodes, Map<string, RoomSelectionIndex>>()

function roomIndex(levelId: string, nodes: ViewerNodes) {
  let levels = indexes.get(nodes)
  if (!levels) {
    levels = new Map()
    indexes.set(nodes, levels)
  }
  let index = levels.get(levelId)
  if (!index) {
    index = new RoomSelectionIndex(levelId)
    levels.set(levelId, index)
  }
  index.update(nodes as Record<string, AnyNode>)
  return index
}

/** The rooms the walls of a level close, as the editor detects them. */
export function viewerRooms(levelId: string, nodes: ViewerNodes): RoomSelectionRecord[] {
  return roomIndex(levelId, nodes).update(nodes as Record<string, AnyNode>)
}

export function levelOfNode(nodeId: string, nodes: ViewerNodes): string | null {
  const seen = new Set<string>()
  let current = nodes[nodeId]
  while (current && !seen.has(current.id)) {
    if (current.type === 'level') return current.id
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

function buildingOfLevel(levelId: string | null, nodes: ViewerNodes): BuildingNode['id'] | null {
  const level = levelId ? nodes[levelId] : undefined
  const parent = level?.parentId ? nodes[level.parentId] : undefined
  if (parent?.type === 'building') return parent.id
  const building = Object.values(nodes).find((node) => node.type === 'building')
  return (building?.id as BuildingNode['id'] | undefined) ?? null
}

const hitPoint = new Vector3()

/**
 * The parametric hit source: a node event as a pick, with the hit in its
 * level's local XZ. A hit on a hidden floor, or on a kind a click passes
 * through, is no pick: the pointer goes on to what lies behind it.
 */
export function viewerPickFromNodeEvent(event: NodeEvent, nodes: ViewerNodes): ViewerPick | null {
  if (VIEWER_PASS_THROUGH_KINDS.has(event.node.type)) return null
  const levelId = levelOfNode(event.node.id, nodes)
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined
  if (level?.visible === false) return null
  if (!level) return { nodeId: event.node.id, point: null }
  level.updateWorldMatrix(true, false)
  hitPoint.set(...event.position)
  level.worldToLocal(hitPoint)
  return { nodeId: event.node.id, point: [hitPoint.x, hitPoint.z] }
}

/**
 * What a pick acts on. A wall, floor or ceiling picks the room it bounds;
 * once that room is selected, its own surfaces are picked as themselves.
 * Anything else (an item, a door, a stair) is picked directly. Alt, Shift,
 * Ctrl and Meta skip the room, as in the editor.
 */
export function resolveViewerTarget(
  selection: Pick<ViewerSelection, 'zoneId'>,
  pick: ViewerPick,
  nodes: ViewerNodes,
  modifiers: SelectionModifierKeys = NO_MODIFIERS,
): ViewerTarget | null {
  const node = nodes[pick.nodeId]
  if (!node || VIEWER_PASS_THROUGH_KINDS.has(node.type)) return null
  const levelId = levelOfNode(node.id, nodes)
  const bypass = modifiers.alt || modifiers.shift || modifiers.ctrl || modifiers.meta
  if (!bypass && levelId && pick.point && ROOM_SURFACES.has(node.type)) {
    const room = resolveRoomHit(
      roomIndex(levelId, nodes),
      levelId,
      node,
      [pick.point[0], pick.point[1]],
      '3d',
    )
    if (room) {
      const { zoneId } = room.key
      return selection.zoneId === zoneId
        ? { kind: 'node', levelId, nodeId: node.id, zoneId }
        : { kind: 'room', levelId, zoneId }
    }
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const owner = node.type === 'roof-segment' && parent?.type === 'roof' ? parent : node
  const nodeId = resolveSelectionProxyId(owner, nodes as Record<string, AnyNode | undefined>)
  return { kind: 'node', levelId, nodeId, zoneId: null }
}

/**
 * The selection a click makes. Empty space clears the room and the element
 * and keeps the floor; nothing pops the user up a level.
 */
export function resolveViewerClick(
  selection: ViewerSelection,
  pick: ViewerPick | null,
  nodes: ViewerNodes,
  modifiers: SelectionModifierKeys = NO_MODIFIERS,
): ViewerSelection {
  const target = pick ? resolveViewerTarget(selection, pick, nodes, modifiers) : null
  if (!target) return { ...selection, zoneId: null, selectedIds: [] }
  const levelId = (target.levelId as LevelNode['id'] | null) ?? selection.levelId
  const buildingId = buildingOfLevel(levelId, nodes) ?? selection.buildingId
  if (target.kind === 'room') {
    return { buildingId, levelId, zoneId: target.zoneId as ZoneNode['id'], selectedIds: [] }
  }
  const toggles = modifiers.shift || modifiers.ctrl || modifiers.meta
  const sameFloor = levelId === selection.levelId
  const selectedIds =
    toggles && sameFloor
      ? selection.selectedIds.includes(target.nodeId)
        ? selection.selectedIds.filter((id) => id !== target.nodeId)
        : [...selection.selectedIds, target.nodeId]
      : [target.nodeId]
  return {
    buildingId,
    levelId,
    zoneId: target.zoneId as ZoneNode['id'] | null,
    selectedIds,
  }
}

/** What a hover would select: a room's id (its highlight) or the element's (its outline). */
export function resolveViewerHover(
  selection: Pick<ViewerSelection, 'zoneId'>,
  pick: ViewerPick | null,
  nodes: ViewerNodes,
): string | null {
  const target = pick ? resolveViewerTarget(selection, pick, nodes) : null
  if (!target) return null
  return target.kind === 'room' ? target.zoneId : target.nodeId
}

/**
 * The current floor reads as the editor shows it: the levels above it step
 * aside (in the stacked display) so its rooms are in view and in reach. Mount
 * it in the surface's DOM tree, beside the editor's own level display, so one
 * hands the flag to the other in order.
 */
export function useViewerFloorDisplay() {
  // A walkthrough tours the whole building.
  const walking = useViewer((s) => s.walkthroughMode)
  useEffect(() => {
    if (walking) return
    useViewer.setState({ hideLevelsAboveSelection: true })
    return () => {
      useViewer.setState({ hideLevelsAboveSelection: false })
    }
  }, [walking])
}

// ── Applying it to the shared store ──────────────────────────────────────────

function writeSelection(selection: ViewerSelection) {
  const viewer = useViewer.getState()
  viewer.setSelection(selection)
  if (viewer.focusedUnitId) viewer.setFocusedUnit(null)
  viewer.setHoveredId(null)
}

export function applyViewerClick(
  pick: ViewerPick | null,
  nodes: ViewerNodes,
  modifiers: SelectionModifierKeys = NO_MODIFIERS,
) {
  writeSelection(resolveViewerClick(useViewer.getState().selection, pick, nodes, modifiers))
}

export function applyViewerHover(pick: ViewerPick | null, nodes: ViewerNodes) {
  const viewer = useViewer.getState()
  const hovered = resolveViewerHover(viewer.selection, pick, nodes)
  viewer.setHoveredId(hovered as never)
}

/** A floor from the floor list: the floor alone, framed. */
export function selectViewerLevel(levelId: string, source: ViewerSource) {
  writeSelection({
    buildingId: buildingOfLevel(levelId, source.nodes),
    levelId: levelId as LevelNode['id'],
    zoneId: null,
    selectedIds: [],
  })
  frameViewerNode(levelId, source)
}

/** The whole building again, framed. */
export function selectViewerBuilding(source: ViewerSource) {
  const buildingId = buildingOfLevel(null, source.nodes)
  writeSelection({ buildingId, levelId: null, zoneId: null, selectedIds: [] })
  if (buildingId) frameViewerNode(buildingId, source)
}

/** A room or zone picked by its pill: selected on its floor, the camera stays. */
export function selectViewerRoomInPlace(zoneId: string, nodes: ViewerNodes): boolean {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return false
  const levelId = zone.parentId as LevelNode['id']
  writeSelection({
    buildingId: buildingOfLevel(levelId, nodes),
    levelId,
    zoneId: zone.id,
    selectedIds: [],
  })
  return true
}

/** A room or zone from the bar or the sidebar: selected on its floor, framed. */
export function selectViewerRoom(zoneId: string, source: ViewerSource) {
  if (selectViewerRoomInPlace(zoneId, source.nodes)) frameViewerNode(zoneId, source)
}

/**
 * A unit from the sidebar: its rooms highlighted and framed. The floor stays
 * when it holds one of the unit's rooms, else the unit's lowest floor shows.
 */
export function selectViewerUnit(unitId: string, source: ViewerSource) {
  const unit = source.nodes[unitId]
  if (unit?.type !== 'unit') return
  const viewer = useViewer.getState()
  const levels = unitLevels(unit, source.nodes)
  const current = viewer.selection.levelId
  const levelId = (current && levels.includes(current) ? current : (levels[0] ?? current)) as
    | LevelNode['id']
    | null
  viewer.setSelection({
    buildingId: buildingOfLevel(levelId, source.nodes),
    levelId,
    zoneId: null,
    selectedIds: [],
  })
  viewer.setHoveredId(null)
  viewer.setFocusedUnit(unit.id)
  frameViewerNode(unit.id, source)
}

function unitLevels(unit: UnitNode, nodes: ViewerNodes): string[] {
  const ordinals = new Map<string, number>()
  for (const member of buildUnitReport(unit, nodes).members) {
    if (member.levelId && member.levelOrdinal !== null)
      ordinals.set(member.levelId, member.levelOrdinal)
  }
  return [...ordinals.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

// ── Framing ──────────────────────────────────────────────────────────────────

const corner = new Vector3()
const box = new Box3()

function expandByZone(target: Box3, zone: ZoneNode, source: ViewerSource) {
  const level = zone.parentId ? source.objectFor(zone.parentId) : undefined
  level?.updateWorldMatrix(true, false)
  const floorY = roomFloorElevation(source.nodes as Record<string, AnyNode>, zone.id)
  for (const [x, z] of zone.polygon) {
    for (const y of [floorY, floorY + DEFAULT_LEVEL_HEIGHT]) {
      corner.set(x, y, z)
      if (level) corner.applyMatrix4(level.matrixWorld)
      target.expandByPoint(corner)
    }
  }
}

/** The frame request for a node: its saved view, else the box it spans. */
function viewerFrameEvent(id: string, source: ViewerSource): CameraControlFrameEvent | null {
  const node = source.nodes[id]
  if (!node) return null
  const saved = node.camera
  if (saved?.position && saved.target) {
    return { bounds: null, pose: { position: saved.position, target: saved.target } }
  }
  box.makeEmpty()
  if (node.type === 'zone') expandByZone(box, node, source)
  else if (node.type === 'unit') {
    for (const memberId of node.members) {
      const member = source.nodes[memberId]
      if (member?.type === 'zone') expandByZone(box, member, source)
    }
  } else {
    const object = source.objectFor(id)
    if (object) box.setFromObject(object)
  }
  if (box.isEmpty()) return null
  return { bounds: { min: box.min.toArray(), max: box.max.toArray() } }
}

export function frameViewerNode(id: string, source: ViewerSource) {
  const event = viewerFrameEvent(id, source)
  if (event) emitter.emit('camera-controls:frame', event)
}

type Vec3 = [number, number, number]

/**
 * Where a camera frames a box: about 45° above it, far enough for the box to
 * fill the view, along the heading the camera already has so the scene does
 * not swing round.
 */
export function framedLookAt(
  event: CameraControlFrameEvent,
  from: { position: Vec3; target: Vec3 },
  fovDegrees = 50,
): { position: Vec3; target: Vec3 } | null {
  if (event.pose) return event.pose
  if (!event.bounds) return null
  const { min, max } = event.bounds
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 1)
  const halfFov = (Math.min(Math.max(fovDegrees, 10), 120) * Math.PI) / 360
  const distance = Math.max((radius / Math.sin(halfFov)) * 1.6, 6)
  const dx = from.position[0] - from.target[0]
  const dz = from.position[2] - from.target[2]
  const heading = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : Math.PI / 4
  const elevation = Math.PI / 4
  const flat = Math.cos(elevation) * distance
  return {
    position: [
      center[0] + Math.sin(heading) * flat,
      center[1] + Math.sin(elevation) * distance,
      center[2] + Math.cos(heading) * flat,
    ],
    target: center,
  }
}

const framePosition = new Vector3()
const frameTarget = new Vector3()
const frameSphere = new Sphere()

/** Apply the shared framing pose, fitting the orthographic viewport as well. */
export function frameViewerCamera(
  control: CameraControlsImpl,
  camera: Camera,
  event: CameraControlFrameEvent,
) {
  control.getPosition(framePosition)
  control.getTarget(frameTarget)
  const pose = framedLookAt(
    event,
    { position: framePosition.toArray(), target: frameTarget.toArray() },
    (camera as PerspectiveCamera).isPerspectiveCamera
      ? (camera as PerspectiveCamera).fov
      : undefined,
  )
  if (!pose) return
  control.setLookAt(...pose.position, ...pose.target, true)
  if ((camera as OrthographicCamera).isOrthographicCamera && event.bounds && !event.pose) {
    box.min.set(...event.bounds.min)
    box.max.set(...event.bounds.max)
    box.getBoundingSphere(frameSphere)
    frameSphere.radius = Math.max(frameSphere.radius * 1.3, 1)
    control.fitToSphere(frameSphere, true)
  }
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

export type ViewerCrumb = {
  kind: 'building' | 'level' | 'unit' | 'room' | 'node'
  id: string
  label: string
}

export function zoneLabel(zone: ZoneNode): string {
  return zone.name?.trim() || (zone.spaceRole === 'room' ? 'Room' : 'Zone')
}

/**
 * The bar: building › floor › room › element. An element inside a room shows
 * that room (`roomOf`) without selecting it; a focused unit stands where the
 * room would.
 */
export function viewerBreadcrumb(
  selection: ViewerSelection,
  focusedUnitId: string | null,
  nodes: ViewerNodes,
  roomOf: (nodeId: string, levelId: string) => string | null = () => null,
): ViewerCrumb[] {
  const crumbs: ViewerCrumb[] = []
  const elementId = selection.selectedIds[0] ?? null
  const element = elementId ? nodes[elementId] : undefined
  const levelId = selection.levelId ?? (element ? levelOfNode(element.id, nodes) : null)
  const buildingId = selection.buildingId ?? buildingOfLevel(levelId, nodes)
  const building = buildingId ? nodes[buildingId] : undefined
  if (building?.type === 'building') {
    crumbs.push({ kind: 'building', id: building.id, label: building.name || 'Building' })
  }
  const level = levelId ? nodes[levelId] : undefined
  if (level?.type !== 'level') return crumbs
  crumbs.push({ kind: 'level', id: level.id, label: getLevelDisplayName(level) })
  const unit = focusedUnitId ? nodes[focusedUnitId] : undefined
  if (unit?.type === 'unit') crumbs.push({ kind: 'unit', id: unit.id, label: unit.name })
  const roomId = selection.zoneId ?? (element ? roomOf(element.id, level.id) : null)
  const room = roomId ? nodes[roomId] : undefined
  if (room?.type === 'zone') crumbs.push({ kind: 'room', id: room.id, label: zoneLabel(room) })
  if (element) crumbs.push({ kind: 'node', id: element.id, label: nodeDisplayLabel(element) })
  return crumbs
}

/** The room or zone of a level around a level-local point: a detected room first. */
function roomAtLevelPoint(
  levelId: string,
  point: readonly [number, number],
  nodes: ViewerNodes,
): string | null {
  const at: [number, number] = [point[0], point[1]]
  const room = roomIndex(levelId, nodes).roomAtPoint(levelId, at)
  if (room) return room.key.zoneId
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.parentId !== levelId || node.polygon.length < 3) continue
    if (containsPoint([{ outer: node.polygon, holes: node.holes ?? [] }], at)) return node.id
  }
  return null
}

const center = new Vector3()

/** The room an element stands in, from where its object sits on its floor. */
export function roomOfObject(nodeId: string, levelId: string, source: ViewerSource) {
  const object = source.objectFor(nodeId)
  const level = source.objectFor(levelId)
  if (!(object && level)) return null
  box.setFromObject(object)
  if (box.isEmpty()) object.getWorldPosition(center)
  else box.getCenter(center)
  level.updateWorldMatrix(true, false)
  level.worldToLocal(center)
  return roomAtLevelPoint(levelId, [center.x, center.z], source.nodes)
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

export type ViewerSidebarRow = { id: string; label: string; color: string; areaM2: number }
export type ViewerSidebarSection = { kind: 'units' | 'rooms' | 'zones'; rows: ViewerSidebarRow[] }

/**
 * What sits under the current floor: its units, its rooms, its other zones.
 * An empty section is left out.
 */
export function viewerSidebarSections(levelId: string, nodes: ViewerNodes): ViewerSidebarSection[] {
  const zones = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' && node.parentId === levelId && node.visible !== false,
  )
  const zoneRow = (zone: ZoneNode): ViewerSidebarRow => ({
    id: zone.id,
    label: zoneLabel(zone),
    color: zone.color,
    areaM2: area([{ outer: zone.polygon, holes: zone.holes ?? [] }]),
  })
  const byName = (a: ViewerSidebarRow, b: ViewerSidebarRow) => a.label.localeCompare(b.label)
  const units = Object.values(nodes)
    .filter((node): node is UnitNode => node.type === 'unit')
    .flatMap((unit) => {
      const report = buildUnitReport(unit, nodes)
      const here = report.members.filter((member) => member.levelId === levelId)
      if (here.length === 0) return []
      return [
        {
          id: unit.id,
          label: unit.name,
          color: unit.color,
          areaM2: here.reduce((sum, member) => sum + member.areaM2, 0),
        },
      ]
    })
    .sort(byName)
  const sections: ViewerSidebarSection[] = [
    { kind: 'units', rows: units },
    {
      kind: 'rooms',
      rows: zones
        .filter((zone) => zone.spaceRole === 'room')
        .map(zoneRow)
        .sort(byName),
    },
    {
      kind: 'zones',
      rows: zones
        .filter((zone) => zone.spaceRole !== 'room')
        .map(zoneRow)
        .sort(byName),
    },
  ]
  return sections.filter((section) => section.rows.length > 0)
}
