'use client'

import {
  type AnyNodeId,
  DEFAULT_LEVEL_HEIGHT,
  getStoredLevelHeight,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { commitDeck } from './deck-commit'
import { DeckDrawTool } from './deck-draw'
import { quantizeDeckElevation } from './deck-plan'

/**
 * Mezzanine tool — draw a deck footprint on the active storey; one gesture
 * (and one undo step) creates a thin deck slab at half the storey height,
 * fence railings on the open edges, and a straight stair up to the deck.
 * The elevation is plain slab placement afterwards — adjust it in the slab
 * panel. See `commitDeck` for the composition.
 */
export const MezzanineTool: React.FC = () => {
  const currentLevelId = useViewer((s) => s.selection.levelId)
  const elevation = useScene((s) => {
    const level = currentLevelId
      ? (s.nodes[currentLevelId as AnyNodeId] as LevelNode | undefined)
      : undefined
    const storeyHeight =
      level?.type === 'level' ? getStoredLevelHeight(level) : DEFAULT_LEVEL_HEIGHT
    return quantizeDeckElevation(storeyHeight / 2)
  })

  return (
    <DeckDrawTool
      elevation={elevation}
      onCommit={(levelId, points) =>
        commitDeck({ levelId, points, elevation, withStair: true, namePrefix: 'Mezzanine' })
      }
    />
  )
}

export default MezzanineTool
