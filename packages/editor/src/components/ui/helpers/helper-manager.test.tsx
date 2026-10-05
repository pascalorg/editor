import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SELECT_HUD_TITLE, toolHudTitle } from '../../../lib/hud-title'
import { snapContextOf } from '../../../lib/snapping-mode'
import { TooltipProvider } from '../primitives/tooltip'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { ROOM_DIVIDE_HINTS } from './helper-manager'

describe('Divide HUD', () => {
  test('uses the wall draft snapping context', () => {
    expect(
      snapContextOf({
        scope: { kind: 'room-divide' },
        mode: 'select',
        tool: null,
        profileOf: () => undefined,
      }),
    ).toBe('wall')
  })

  test('reads like the wall draft: snapping chips and the path keys', () => {
    // Server rendering reads each store's initial state: the wall context starts
    // on Grid with a 0.5 m step.
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel hints={ROOM_DIVIDE_HINTS} snapContext="wall" />
      </TooltipProvider>,
    )
    expect(html).toContain('Snapping: Grid')
    expect(html).toContain('Grid: 0.50 m')
    for (const label of ['Add point', 'Remove last point', 'Finish at the edge', 'Cancel'])
      expect(html).toContain(label)
    expect(ROOM_DIVIDE_HINTS.map((hint) => hint.keys)).toEqual([
      ['Left click'],
      ['Backspace'],
      ['Enter'],
      ['Esc'],
    ])
  })
})

describe('HUD header', () => {
  test('names the tool in hand with its icon and key, above the gesture rows', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel
          hints={[
            { keys: ['Left click'], label: 'Set one corner, then the opposite' },
            { keys: ['Esc'], label: 'Cancel' },
          ]}
          snapContext="wall"
          title={toolHudTitle('wall', 'rectangle')}
        />
      </TooltipProvider>,
    )
    expect(html).toContain('data-hud-title="Rectangle room"')
    expect(html).toContain('src="/icons/room.webp"')
    // Header, then the gesture, then the mode chips, with Esc last.
    const order = ['Rectangle room', 'Set one corner', 'Snapping: Grid', 'Cancel'].map((text) =>
      html.indexOf(text),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('select mode is titled Select with its V key', () => {
    expect(SELECT_HUD_TITLE).toMatchObject({ label: 'Select', shortcut: 'V' })
  })
})
