import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type LevelNode,
  pointInPolygon2D,
  runAsSingleSceneHistoryStep,
  sceneRegistry,
  snapWorldXZToBuildingLocal,
  UnitNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor, { type StructureLayer } from '../store/use-editor'
import { getActiveBuildingPose } from './world-grid-snap'

type Nodes = Readonly<Record<AnyNodeId, AnyNode>>

// Unit focus is a session gesture: the layer the user was on when focus began
// comes back when focus ends, unless they switched layers by hand meanwhile.
let restoreLayer: StructureLayer | null = null
let entering = false
let leaving = false

export function focusedUnitNode(): UnitNode | null {
  const id = useViewer.getState().focusedUnitId
  const node = id ? useScene.getState().nodes[id] : undefined
  return node?.type === 'unit' ? node : null
}

/** Levels carrying member zones, lowest ordinal first. */
export function unitMemberLevels(unit: UnitNode, nodes: Nodes): LevelNode[] {
  const levels = new Map<LevelNode['id'], LevelNode>()
  for (const zoneId of unit.members) {
    const zone = nodes[zoneId]
    const level =
      zone?.type === 'zone' && zone.parentId ? nodes[zone.parentId as AnyNodeId] : undefined
    if (level?.type === 'level') levels.set(level.id, level)
  }
  return [...levels.values()].sort((a, b) => a.level - b.level)
}

export function enterUnitFocus(unitId: UnitNode['id']): void {
  if (entering) return
  entering = true
  try {
    const nodes = useScene.getState().nodes
    const unit = nodes[unitId]
    if (unit?.type !== 'unit') return
    const editor = useEditor.getState()
    if (restoreLayer === null) restoreLayer = editor.structureLayer
    if (editor.phase === 'site') editor.setPhase('building')
    if (useEditor.getState().structureLayer !== 'zones') {
      useEditor.getState().setStructureLayer('zones')
    }
    const viewer = useViewer.getState()
    if (viewer.focusedUnitId !== unitId) viewer.setFocusedUnit(unitId)

    const { selection, setSelection } = useViewer.getState()
    const levels = unitMemberLevels(unit, nodes)
    const levelId = levels.some((level) => level.id === selection.levelId)
      ? selection.levelId
      : (levels[0]?.id ?? selection.levelId)
    const buildingId = (unit.parentId as BuildingNode['id'] | null) ?? selection.buildingId
    const unitSelected = selection.selectedIds.length === 1 && selection.selectedIds[0] === unitId
    if (selection.buildingId !== buildingId || selection.levelId !== levelId || !unitSelected) {
      setSelection({ buildingId, levelId, selectedIds: [unitId] })
    }
  } finally {
    entering = false
  }
}

function finishLeave(unitId: UnitNode['id'], keepLayer: boolean) {
  const layer = restoreLayer
  restoreLayer = null
  const editor = useEditor.getState()
  if (
    !keepLayer &&
    layer &&
    layer !== 'zones' &&
    editor.phase === 'building' &&
    editor.structureLayer === 'zones'
  ) {
    editor.setStructureLayer(layer)
  }
  const { selection, setSelection } = useViewer.getState()
  if (selection.selectedIds.length === 1 && selection.selectedIds[0] === unitId) {
    setSelection({ selectedIds: [] })
  }
}

/** Ends unit focus. Returns false when no unit was focused. */
export function leaveUnitFocus(options?: { keepLayer?: boolean }): boolean {
  const viewer = useViewer.getState()
  const unitId = viewer.focusedUnitId
  if (!unitId) return false
  leaving = true
  try {
    viewer.setFocusedUnit(null)
  } finally {
    leaving = false
  }
  finishLeave(unitId, options?.keepLayer ?? false)
  return true
}

/**
 * Puts a zone in exactly one unit (or none): it leaves every other unit in the
 * same store update, so the move is one undo step.
 */
export function assignZoneToUnit(zoneId: ZoneNode['id'], unitId: UnitNode['id'] | null): void {
  const { nodes, updateNodes } = useScene.getState()
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'unit' || node.id === unitId || !node.members.includes(zoneId)) continue
    updates.push({ id: node.id, data: { members: node.members.filter((id) => id !== zoneId) } })
  }
  const target = unitId ? nodes[unitId] : undefined
  if (target?.type === 'unit' && !target.members.includes(zoneId)) {
    updates.push({ id: target.id, data: { members: [...target.members, zoneId] } })
  }
  if (updates.length > 0) updateNodes(updates)
}

/** The units of the building a zone's level belongs to, and the one listing the zone. */
export function zoneUnits(
  nodes: Nodes,
  zoneId: string,
): { buildingId: BuildingNode['id'] | null; units: UnitNode[]; current: UnitNode | null } {
  const zone = nodes[zoneId as AnyNodeId]
  const level = zone?.parentId ? nodes[zone.parentId as AnyNodeId] : undefined
  const building = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  if (building?.type !== 'building') return { buildingId: null, units: [], current: null }
  const units = building.children.flatMap((id) => {
    const child = nodes[id as AnyNodeId]
    return child?.type === 'unit' ? [child] : []
  })
  return {
    buildingId: building.id,
    units,
    current: units.find((unit) => unit.members.includes(zoneId as ZoneNode['id'])) ?? null,
  }
}

/** Puts a zone in a new unit of its building (named "Unit N"), in one undo step, without focusing it. */
export function addZoneToNewUnit(zoneId: ZoneNode['id']): UnitNode['id'] | null {
  const { buildingId, units } = zoneUnits(useScene.getState().nodes, zoneId)
  if (!buildingId) return null
  const unit = UnitNode.parse({ name: `Unit ${units.length + 1}` })
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().createNode(unit, buildingId)
    assignZoneToUnit(zoneId, unit.id)
  })
  return unit.id
}

export function toggleZoneMembership(unitId: UnitNode['id'], zoneId: ZoneNode['id']): void {
  const unit = useScene.getState().nodes[unitId]
  if (unit?.type !== 'unit') return
  assignZoneToUnit(zoneId, unit.members.includes(zoneId) ? null : unitId)
}

/** How far (m) below a mezzanine's walking surface a hit still counts as on it (its plate and underside). */
const MEZZANINE_HIT_TOLERANCE = 0.05

/**
 * The zone under a point on the current level, in building-local XZ. A 3D
 * click lands on whatever surface is closest (a floor slab sits above the
 * zone fill), so painting resolves the zone from the hit point instead of the
 * hit mesh. Nested zones resolve to the smallest one, except that a mezzanine
 * the hit may be on always wins over its host. With the hit's height (`y`,
 * level-local) a mezzanine counts only when the hit is on or above its plate —
 * the host floor under it is the host's; without one (the plan, seen from
 * above) the mezzanine on top wins.
 */
export function zoneAtLevelPoint(x: number, z: number, y?: number): ZoneNode | null {
  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return null
  const nodes = useScene.getState().nodes
  let best: ZoneNode | null = null
  let bestArea = Number.POSITIVE_INFINITY
  let bestOnTop = false
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.parentId !== levelId) continue
    // An eligible mezzanine is the surface on top: it beats its host whatever
    // their areas (a mezzanine may cover its whole host).
    const onTop = node.floor?.support === 'open'
    if (y !== undefined && onTop) {
      const underside = (node.floor!.elevation ?? 0) - (node.floor!.thickness ?? 0.2)
      if (y < underside - MEZZANINE_HIT_TOLERANCE) continue
    }
    if (bestOnTop && !onTop) continue
    const polygon = node.polygon
    if (!pointInPolygon2D([x, z], polygon)) continue
    let area = 0
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      area += a[0] * b[1] - b[0] * a[1]
    }
    area = Math.abs(area) / 2
    if (area < bestArea || (onTop && !bestOnTop)) {
      best = node
      bestArea = area
      bestOnTop = onTop
    }
  }
  return best
}

/** `worldY` (optional): the hit's height, so a click under a mezzanine picks the host. */
export function zoneAtWorldPoint(worldX: number, worldZ: number, worldY?: number): ZoneNode | null {
  const pose = getActiveBuildingPose()
  const [x, z] = pose
    ? snapWorldXZToBuildingLocal(worldX, worldZ, pose.position, pose.rotationY, 0).local
    : [worldX, worldZ]
  return zoneAtLevelPoint(x, z, worldY === undefined ? undefined : levelLocalY(worldY))
}

function levelLocalY(worldY: number): number {
  const levelId = useViewer.getState().selection.levelId
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined
  if (!level) return worldY
  level.updateWorldMatrix(true, false)
  return worldY - level.matrixWorld.elements[13]!
}

export const ZONE_PAINT_DELAY_MS = 250
const pendingPaints = new Map<ZoneNode['id'], ReturnType<typeof setTimeout>>()

/**
 * The canvas paint gesture. The toggle waits out the double-click window so
 * the second click of a double-click cancels it instead of toggling twice;
 * the double-click itself then selects the zone.
 */
export function paintZoneMembership(unitId: UnitNode['id'], zoneId: ZoneNode['id']): void {
  if (cancelPendingZonePaint(zoneId)) return
  pendingPaints.set(
    zoneId,
    setTimeout(() => {
      pendingPaints.delete(zoneId)
      toggleZoneMembership(unitId, zoneId)
    }, ZONE_PAINT_DELAY_MS),
  )
}

export function cancelPendingZonePaint(zoneId: ZoneNode['id']): boolean {
  const pending = pendingPaints.get(zoneId)
  if (!pending) return false
  clearTimeout(pending)
  pendingPaints.delete(zoneId)
  return true
}

export function createUnitInBuilding(buildingId: BuildingNode['id']): UnitNode['id'] | null {
  const scene = useScene.getState()
  const building = scene.nodes[buildingId]
  if (building?.type !== 'building') return null
  const unitCount = building.children.filter((id) => scene.nodes[id]?.type === 'unit').length
  const unit = UnitNode.parse({ name: `Unit ${unitCount + 1}` })
  scene.createNode(unit, buildingId)
  enterUnitFocus(unit.id)
  return unit.id
}

/**
 * Keeps unit focus coherent with the rest of the editor: a focus set from
 * anywhere (the unit inspector calls the viewer store directly) gets the full
 * enter treatment, and focus ends when the user switches layer or phase by
 * hand, selects anything other than the focused unit, or the unit is deleted.
 */
export function useUnitFocusRules(): void {
  useEffect(() => {
    const unsubscribeViewer = useViewer.subscribe((state, prev) => {
      if (state.focusedUnitId !== prev.focusedUnitId) {
        if (state.focusedUnitId) enterUnitFocus(state.focusedUnitId)
        else if (prev.focusedUnitId && !leaving) finishLeave(prev.focusedUnitId, false)
        return
      }
      const unitId = state.focusedUnitId
      if (!unitId || state.selection === prev.selection) return
      // Selecting a zone keeps focus: renaming or recolouring a zone row is
      // part of arranging the unit, and zones live on the layer focus uses.
      const { selectedIds } = state.selection
      const selectsOther =
        selectedIds.length > 0 && !(selectedIds.length === 1 && selectedIds[0] === unitId)
      if (selectsOther) leaveUnitFocus()
    })
    const unsubscribeEditor = useEditor.subscribe((state, prev) => {
      if (state.structureLayer === prev.structureLayer && state.phase === prev.phase) return
      if (!useViewer.getState().focusedUnitId) return
      if (state.phase !== 'building' || state.structureLayer !== 'zones') {
        leaveUnitFocus({ keepLayer: true })
      }
    })
    const unsubscribeScene = useScene.subscribe((state, prev) => {
      if (state.nodes === prev.nodes) return
      const unitId = useViewer.getState().focusedUnitId
      if (unitId && state.nodes[unitId]?.type !== 'unit') leaveUnitFocus()
    })
    return () => {
      unsubscribeViewer()
      unsubscribeEditor()
      unsubscribeScene()
      for (const pending of pendingPaints.values()) clearTimeout(pending)
      pendingPaints.clear()
    }
  }, [])
}
