import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  derivedFieldViolations,
  emitter,
  isDerivedNode,
  type LevelNode,
  resolveLevelId,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { create } from 'zustand'
import { markToolCancelConsumed } from '../hooks/use-keyboard'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { selectRoom } from './room-selection-commands'
import { completeElementAction } from './room-zone-routing'

/**
 * The explicit "Edit ceiling" session: while it holds a ceiling, and only then,
 * that ceiling shows its corner brackets, polygon editor and height handle.
 *
 * A tiny store rather than an interaction scope: a non-idle scope turns off
 * selection picking and hides every overlay, while the session is a standing
 * mode in which the rest of the scene must stay hoverable and clickable. The
 * polygon drags inside it still run their own `reshaping` scope.
 */
export type CeilingEditSession = {
  ceilingId: CeilingNode['id']
  /** The room the ceiling belonged to at start; a polygon edit detaches the link. */
  zoneId: string | null
  levelId: string
}

export const useCeilingEditSession = create<{ session: CeilingEditSession | null }>(() => ({
  session: null,
}))

/** The ceiling whose edit controls may show, or null outside a session. */
export function useCeilingEditCeilingId(): string | null {
  return useCeilingEditSession((state) => state.session?.ceilingId ?? null)
}

export function getCeilingEditSession(): CeilingEditSession | null {
  return useCeilingEditSession.getState().session
}

type Nodes = Record<string, AnyNode>

function resolveCeiling(nodes: Nodes, target: string): CeilingNode | null {
  const node = nodes[target]
  if (node?.type === 'ceiling') return node
  if (node?.type !== 'zone') return null
  const linked = Object.values(nodes).filter(
    (candidate): candidate is CeilingNode =>
      candidate.type === 'ceiling' && candidate.zoneId === target,
  )
  return (
    linked.find((ceiling) => ceiling.parentId === node.parentId && ceiling.boundary === 'auto') ??
    linked.find((ceiling) => ceiling.parentId === node.parentId) ??
    linked[0] ??
    null
  )
}

let stopLifecycle: (() => void) | null = null

/**
 * Starts editing the ceiling `target` names: a ceiling id, or a room zone id
 * (its linked ceiling). Selects the ceiling on its level, going inside the
 * building first. Returns false when there is no such ceiling.
 */
export function startCeilingEdit(target: string): boolean {
  const nodes = useScene.getState().nodes as Nodes
  const ceiling = resolveCeiling(nodes, target)
  if (!ceiling) return false
  endCeilingEdit()

  const levelId = resolveLevelId(ceiling, nodes)
  const zone = ceiling.zoneId ? nodes[ceiling.zoneId] : nodes[target]
  const zoneId = zone?.type === 'zone' ? zone.id : null
  if (useEditor.getState().phase === 'site') useEditor.getState().setPhase('building')

  useCeilingEditSession.setState({ session: { ceilingId: ceiling.id, zoneId, levelId } })
  const level = nodes[levelId]
  const selection = useViewer.getState().selection
  useViewer.getState().setSelection({
    ...(level?.parentId && level.parentId !== selection.buildingId
      ? { buildingId: level.parentId as BuildingNode['id'] }
      : {}),
    ...(levelId !== selection.levelId ? { levelId: levelId as LevelNode['id'] } : {}),
    selectedIds: [ceiling.id],
  })
  stopLifecycle = watchSession()
  return true
}

/**
 * The scene-graph entry: a plain tree click that left exactly this ceiling
 * selected opens its session. Modifier multi-selection does not.
 */
export function startCeilingEditFromTreeSelection(nodeId: string): boolean {
  const { selectedIds } = useViewer.getState().selection
  if (selectedIds.length !== 1 || selectedIds[0] !== nodeId) return false
  return startCeilingEdit(nodeId)
}

export function endCeilingEdit() {
  stopLifecycle?.()
  stopLifecycle = null
  const session = getCeilingEditSession()
  if (!session) return
  useCeilingEditSession.setState({ session: null })
  // The hole editor mounts only inside the session; a hole scope it leaves behind
  // would keep selection picking off with no editor to end it.
  useInteractionScope
    .getState()
    .endIf(
      (scope) =>
        scope.kind === 'reshaping' &&
        scope.reshape === 'hole' &&
        scope.nodeId === session.ceilingId,
    )
}

/** Ends the session with the editor that owns it, so none outlives an unmount. */
export function useCeilingEditSessionOwner() {
  useEffect(() => endCeilingEdit, [])
}

/**
 * Writes a ceiling's holes. Manual holes are authored data the derived-node
 * guard allows on an auto ceiling, so this is a plain update that keeps the
 * room link (only a polygon edit detaches); a write that would change a
 * room-cut hole is refused (returns false).
 */
export function setCeilingHoles(
  ceilingId: string,
  patch: Pick<CeilingNode, 'holes'> & Partial<Pick<CeilingNode, 'holeMetadata'>>,
): boolean {
  const scene = useScene.getState()
  const ceiling = scene.nodes[ceilingId as AnyNodeId]
  if (ceiling?.type !== 'ceiling') return false
  if (isDerivedNode(ceiling) && derivedFieldViolations(ceiling, patch).length > 0) return false
  scene.updateNode(ceilingId as AnyNodeId, patch)
  return true
}

/** Escape: leaves the session for the ceiling's room, or for nothing when it has none. */
export function exitCeilingEditToRoom(): boolean {
  const session = getCeilingEditSession()
  if (!session) return false
  endCeilingEdit()
  const zone = session.zoneId ? useScene.getState().nodes[session.zoneId as AnyNodeId] : undefined
  if (zone?.type !== 'zone') {
    useViewer.getState().setSelection({ selectedIds: [] })
    return true
  }
  const room = { levelId: session.levelId, zoneId: zone.id }
  // A room the index no longer knows (its walls just opened) is still where the user came from.
  if (!completeElementAction({ room, point: null })) selectRoom(room)
  return true
}

function watchSession() {
  const active = () => getCeilingEditSession()
  const stopViewer = useViewer.subscribe((state) => {
    const session = active()
    if (!session) return
    const { selectedIds, levelId } = state.selection
    if (
      levelId !== session.levelId ||
      selectedIds.length !== 1 ||
      selectedIds[0] !== session.ceilingId
    )
      endCeilingEdit()
  })
  const stopEditor = useEditor.subscribe((state, previous) => {
    if (state.phase !== previous.phase) endCeilingEdit()
  })
  const stopScene = useScene.subscribe((state) => {
    const session = active()
    if (session && state.nodes[session.ceilingId as AnyNodeId]?.type !== 'ceiling') endCeilingEdit()
  })
  // A reshape in flight owns Escape (it cancels the drag); only an idle session exits.
  const onToolCancel = () => {
    if (
      !active() ||
      useEditor.getState().mode !== 'select' ||
      useInteractionScope.getState().scope.kind !== 'idle'
    )
      return
    exitCeilingEditToRoom()
    markToolCancelConsumed()
  }
  emitter.on('tool:cancel', onToolCancel)
  return () => {
    stopViewer()
    stopEditor()
    stopScene()
    emitter.off('tool:cancel', onToolCancel)
  }
}
