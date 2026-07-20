'use client'

import { BALCONY_DECK_ELEVATION, commitDeck } from './deck-commit'
import { DeckDrawTool } from './deck-draw'

/**
 * Balcony tool — draw a deck footprint (typically hanging past the wall
 * line) on the active storey; one gesture (and one undo step) creates the
 * deck slab flush with the interior floor surface plus fence railings on
 * every open edge. See `commitDeck` for the composition.
 */
export const BalconyTool: React.FC = () => (
  <DeckDrawTool
    elevation={BALCONY_DECK_ELEVATION}
    onCommit={(levelId, points) =>
      commitDeck({
        levelId,
        points,
        elevation: BALCONY_DECK_ELEVATION,
        withStair: false,
        namePrefix: 'Balcony',
      })
    }
  />
)

export default BalconyTool
