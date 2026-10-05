import {
  type AnyNode,
  area,
  emitter,
  type FloorOpeningNode,
  intersection,
  openingsForSurface,
  removeFloorOpening,
  structureChangeBatch,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { markToolCancelConsumed } from '../hooks/use-keyboard'
import useEditor from '../store/use-editor'
import { cancelOpeningDraft } from './floor-opening-draft'
import { completeElementAction } from './room-zone-routing'

// "Edit floor": the room's floor openings, outlined in 3D and on the plan,
// each a click away, with "Cut opening" to draw another. Like "Edit ceiling"
// it is a standing mode rather than an interaction scope, so the scene stays
// clickable; it ends with Done or Escape (back to the room), when the room is
// deselected, or when another room is picked.

export type FloorEditSession = { zoneId: string; levelId: string }

export const useFloorEditSession = create<{ session: FloorEditSession | null }>(() => ({
  session: null,
}))

type Nodes = Readonly<Record<string, AnyNode>>

/**
 * The openings through one surface of a room: those whose cut reaches that
 * surface on the room's level (a floor opening here, a ceiling opening from
 * the storey below) and overlap the room's outline.
 */
export function roomSurfaceOpenings(
  nodes: Nodes,
  zoneId: string,
  surface: 'floor' | 'ceiling',
): FloorOpeningNode[] {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return []
  const outline = { outer: zone.polygon, holes: zone.holes ?? [] }
  const mezzanine = zone.floor?.support === 'open'
  return openingsForSurface(nodes, zone.parentId, surface).filter((opening) =>
    mezzanine
      ? opening.hostZoneId === zoneId
      : !opening.hostZoneId && area(intersection(opening.polygon, outline)) > 1e-6,
  )
}

let stop: (() => void) | null = null

export function startFloorEdit(zoneId: string): boolean {
  const zone =
    useScene.getState().nodes[zoneId as keyof ReturnType<typeof useScene.getState>['nodes']]
  if (zone?.type !== 'zone' || !zone.parentId) return false
  endFloorEdit()
  useFloorEditSession.setState({ session: { zoneId, levelId: zone.parentId } })
  stop = watch(zoneId)
  return true
}

export function endFloorEdit() {
  stop?.()
  stop = null
  if (useFloorEditSession.getState().session) useFloorEditSession.setState({ session: null })
}

/** Done / Escape: ends the session on the room it edited. */
export function finishFloorEdit() {
  const session = useFloorEditSession.getState().session
  if (!session) return false
  endFloorEdit()
  completeElementAction({ room: session, point: null })
  return true
}

function watch(zoneId: string) {
  const stopEditor = useEditor.subscribe((state) => {
    if (state.room?.zoneId !== zoneId && !openingSelectedIn(zoneId)) endFloorEdit()
  })
  const stopScene = useScene.subscribe((state) => {
    if (state.nodes[zoneId as keyof typeof state.nodes]?.type !== 'zone') endFloorEdit()
  })
  const onToolCancel = () => {
    if (useViewer.getState().selection.selectedIds.length) return
    if (finishFloorEdit()) markToolCancelConsumed()
  }
  emitter.on('tool:cancel', onToolCancel)
  return () => {
    stopEditor()
    stopScene()
    emitter.off('tool:cancel', onToolCancel)
  }
}

function openingSelectedIn(zoneId: string) {
  const nodes = useScene.getState().nodes as Nodes
  const [id] = useViewer.getState().selection.selectedIds
  return (
    !!id &&
    nodes[id]?.type === 'floor-opening' &&
    roomSurfaceOpenings(nodes, zoneId, 'floor').some((opening) => opening.id === id)
  )
}

/** The room an opening belongs to: the selected room, else the room it overlaps most. */
export function openingRoom(nodes: Nodes, opening: FloorOpeningNode): string | null {
  if (opening.hostZoneId) return opening.hostZoneId
  const selected = useEditor.getState().room
  if (selected && selected.levelId === opening.parentId) return selected.zoneId
  let best: { id: string; overlap: number } | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.parentId !== opening.parentId || node.spaceRole !== 'room')
      continue
    const overlap = area(
      intersection(opening.polygon, { outer: node.polygon, holes: node.holes ?? [] }),
    )
    if (overlap > (best?.overlap ?? 1e-6)) best = { id: node.id, overlap }
  }
  return best?.id ?? null
}

/** Deletes an opening (one undo step) and lands on its room. */
export function deleteFloorOpening(openingId: string) {
  const nodes = useScene.getState().nodes as Nodes
  const opening = nodes[openingId]
  if (opening?.type !== 'floor-opening' || useScene.getState().readOnly) return false
  if (opening.source === 'stair' || opening.source === 'elevator') return false
  const zoneId = openingRoom(nodes, opening)
  cancelOpeningDraft()
  const plan = removeFloorOpening(nodes, openingId)
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  useViewer.getState().setSelection({ selectedIds: [] })
  if (zoneId && opening.parentId)
    completeElementAction({ room: { levelId: opening.parentId, zoneId }, point: null })
  return true
}

/** Done in the opening's panel: back to its room. */
export function finishFloorOpening(openingId: string) {
  const nodes = useScene.getState().nodes as Nodes
  const opening = nodes[openingId]
  if (opening?.type !== 'floor-opening') return false
  const zoneId = openingRoom(nodes, opening)
  useViewer.getState().setSelection({ selectedIds: [] })
  if (zoneId && opening.parentId)
    completeElementAction({ room: { levelId: opening.parentId, zoneId }, point: null })
  return true
}
