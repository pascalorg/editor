'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getLevelAbove,
  getLevelBelow,
  getLevelDisplayName,
  useScene, usePascalI18n,
} from '@pascal-app/core'
import { buildExteriorWallCopy, levelExteriorWalls } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { getDrawnWallTypes } from '../../lib/wall-draw-variant'

type Offer = { levelId: string; sourceLevelId: string; direction: 'below' | 'above' }

/**
 * The one open "Copy exterior walls?" offer, for the level just added. While it is open the plan
 * traces the source level's walls on the new one; that trace is the offer's, never the saved
 * Walls below / above preference, and it goes with the offer.
 */
export const useLevelWallCopyOffer = create<{
  offer: Offer | null
  setOffer: (offer: Offer | null) => void
}>((set) => ({ offer: null, setOffer: (offer) => set({ offer }) }))

let stopWatchingLevel: (() => void) | null = null

/** Opens `offer` (or closes the open one); picking another level closes it. */
function setOffer(offer: Offer | null) {
  stopWatchingLevel?.()
  stopWatchingLevel = null
  useLevelWallCopyOffer.getState().setOffer(offer)
  if (!offer) return
  stopWatchingLevel = useViewer.subscribe((state) => {
    if (state.selection.levelId !== offer.levelId) setOffer(null)
  })
}

/**
 * After a level is added next to `sourceLevelId` (by default the level under it, else the one over
 * it, for a basement), and selected: when that level has an outline, offer to copy its exterior
 * walls up or down, tracing them dashed on the plan while the offer is open.
 */
export function offerExteriorWallCopy(levelId: string, sourceLevelId?: string) {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const graph = nodes as Record<AnyNodeId, AnyNode>
  sourceLevelId ??= (getLevelBelow(levelId, graph) ?? getLevelAbove(levelId, graph))?.id
  const source = sourceLevelId ? nodes[sourceLevelId] : undefined
  const level = nodes[levelId]
  if (!sourceLevelId || source?.type !== 'level' || level?.type !== 'level') return setOffer(null)
  const direction = source.level < level.level ? 'below' : 'above'
  setOffer(
    levelExteriorWalls(nodes, sourceLevelId).length ? { levelId, sourceLevelId, direction } : null,
  )
}

/** Closes the open offer without copying. */
export function dismissExteriorWallCopy() {
  setOffer(null)
}

/** Copies the offered walls in place, as one undo step of its own. */
export function acceptExteriorWallCopy(offer: Offer): number {
  const walls = buildExteriorWallCopy({
    nodes: useScene.getState().nodes as Record<string, AnyNode>,
    fromLevelId: offer.sourceLevelId,
    toLevelId: offer.levelId,
    // Foundation walls copied above grade are built as the Build panel's exterior walls.
    exteriorConstruction: getDrawnWallTypes().exterior,
  })
  if (walls.length) useScene.getState().applyNodeChanges({ create: walls })
  setOffer(null)
  return walls.length
}

/**
 * "Copy exterior walls from the level below?" — a small card under the level list, never in the
 * way: it goes when answered or when another level is picked, and hides once the level has walls.
 */
export function LevelWallCopyPrompt() {
  const i18n = usePascalI18n()
  const offer = useLevelWallCopyOffer((state) => state.offer)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const sourceName = useScene((state) => {
    const source = offer ? state.nodes[offer.sourceLevelId as never] : undefined
    return source?.type === 'level' ? getLevelDisplayName(source) : null
  })
  const levelHasWalls = useScene((state) => {
    const level = offer ? state.nodes[offer.levelId as AnyNodeId] : undefined
    return (
      level?.type === 'level' &&
      level.children.some((id) => state.nodes[id as AnyNodeId]?.type === 'wall')
    )
  })
  if (!offer || !sourceName || activeLevelId !== offer.levelId || levelHasWalls) return null
  return (
    <div
      className="mt-2 w-56 rounded-xl border border-border bg-background/95 p-3 text-xs shadow-2xl backdrop-blur-md"
      data-level-wall-copy={offer.levelId}
      role="status"
    >
      <p className="font-medium text-foreground text-sm">
        {i18n._({ id: 'editor.levelWallCopyPrompt.copyExteriorWallsFromTheLevel', message: 'Copy exterior walls from the level {direction}?', values: { direction: offer.direction } })}</p>
      <p className="mt-0.5 text-muted-foreground">
        {i18n._({ id: 'editor.levelWallCopyPrompt.sourcenameSOutsideWallsInPlace', message: '{sourceName}’s outside walls, in place, so this level lines up with it.', values: { sourceName } })}</p>
      <div className="mt-2.5 flex gap-2">
        <button
          className="flex-1 rounded-full bg-foreground px-3 py-1.5 font-medium text-background transition-opacity hover:opacity-90"
          data-level-wall-copy-accept
          onClick={() => acceptExteriorWallCopy(offer)}
          type="button"
        >
          {i18n._({ id: 'editor.levelWallCopyPrompt.copy', message: 'Copy' })}
        </button>
        <button
          className="flex-1 rounded-full border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-accent"
          onClick={dismissExteriorWallCopy}
          type="button"
        >
          {i18n._({ id: 'editor.levelWallCopyPrompt.noThanks', message: 'No thanks' })}
        </button>
      </div>
    </div>
  )
}
