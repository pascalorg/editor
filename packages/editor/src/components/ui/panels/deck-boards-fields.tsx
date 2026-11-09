'use client'

import {
  type AnyNodeId,
  DECK_BOARD_GAPS,
  DECK_BOARD_SIZES,
  DECK_BOARD_STOCK,
  type DeckBoardDirection,
  type DeckBoardSize,
  deckBoardSettings,
  deckJoistSpacingLimit,
  inchFractionLabel,
  type MessageDescriptor,
  setZoneIntent,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { applyRoomPlan } from '../../../lib/room-structure-commands'
import { SegmentedControl } from '../controls/segmented-control'

const IN = 0.0254

const BOARD_OPTIONS = DECK_BOARD_SIZES.map((value) => ({
  label: DECK_BOARD_STOCK[value].label,
  value,
}))

const GAP_OPTIONS = DECK_BOARD_GAPS.map((gap, index) => ({
  label: `${inchFractionLabel(gap)} in`,
  value: String(index),
}))

const RUN_OPTIONS: ReadonlyArray<{ label: MessageDescriptor; value: DeckBoardDirection }> = [
  {
    label: /* i18n */ {
      id: 'editor.panels.deckBoardsFields.alongHouse',
      message: 'Along house',
    },
    value: 'parallel',
  },
  {
    label: /* i18n */ { id: 'editor.panels.deckBoardsFields.diagonal', message: 'Diagonal' },
    value: 'diagonal',
  },
  {
    label: /* i18n */ {
      id: 'editor.panels.deckBoardsFields.outFromHouse',
      message: 'Out from house',
    },
    value: 'perpendicular',
  },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="shrink-0">{label}</span>
      {children}
    </div>
  )
}

/**
 * A deck's boards (`decking`, through core's `setZoneIntent`): their stock, the gap between them
 * and the way they run against the house. The engine lays them over the deck's frame, and the
 * frame follows: joists 12 in on centre under diagonal 5/4 or composite boards (IRC R507.7), and
 * along the house on beams square to it under boards run out from it.
 */
export function DeckBoardsFields({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const deck = useScene(
    useShallow((scene) => {
      const zone = scene.nodes[zoneId as AnyNodeId]
      if (zone?.type !== 'zone' || zone.roomType !== 'deck') return null
      return deckBoardSettings(zone)
    }),
  )
  if (!deck) return null
  const set = (decking: NonNullable<Parameters<typeof setZoneIntent>[1]['patch']['decking']>) =>
    applyRoomPlan(setZoneIntent(useScene.getState().nodes, { zoneId, patch: { decking } }))
  const stock = DECK_BOARD_STOCK[deck.boardSize]
  const gap = DECK_BOARD_GAPS.findIndex((option) => Math.abs(option - deck.gap) < 1e-6)
  const spacing = Math.min(16 * IN, deckJoistSpacingLimit(deck))
  return (
    <div
      className="mt-3 flex flex-col gap-1.5 text-muted-foreground text-xs"
      data-deck-boards={deck.boardSize}
    >
      <h3 className="font-medium text-xs">
        {i18n._({ id: 'editor.panels.deckBoardsFields.deckBoards', message: 'Deck boards' })}
      </h3>
      <Field label={i18n._({ id: 'editor.panels.deckBoardsFields.boards', message: 'Boards' })}>
        <SegmentedControl
          onChange={(boardSize: DeckBoardSize) => set({ boardSize })}
          options={BOARD_OPTIONS}
          value={deck.boardSize}
        />
      </Field>
      <Field label={i18n._({ id: 'editor.panels.deckBoardsFields.gap', message: 'Gap' })}>
        <SegmentedControl
          mixed={gap < 0}
          onChange={(index: string) => set({ gap: DECK_BOARD_GAPS[Number(index)] })}
          options={GAP_OPTIONS}
          value={String(Math.max(gap, 0))}
        />
      </Field>
      <Field label={i18n._({ id: 'editor.panels.deckBoardsFields.run', message: 'Run' })}>
        <SegmentedControl
          onChange={(direction: DeckBoardDirection) => set({ direction })}
          options={RUN_OPTIONS.map((option) => ({
            label: i18n._(option.label),
            value: option.value,
          }))}
          value={deck.direction}
        />
      </Field>
      <p>
        {i18n._({
          id: 'editor.panels.deckBoardsFields.boardsSummary',
          message:
            '{label} boards {thickness} × {width} in, {gap} in apart, {direction, select, parallel {along the house, on joists square to it} diagonal {at 45° to the house} other {out from the house, on joists along it, carried by beams square to the house}}; joists {spacing} in on centre.',
          values: {
            label: stock.label,
            thickness: inchFractionLabel(stock.thickness),
            width: inchFractionLabel(stock.width),
            gap: inchFractionLabel(deck.gap),
            direction: deck.direction,
            spacing: Math.round(spacing / IN),
          },
        })}
      </p>
    </div>
  )
}
