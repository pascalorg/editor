import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SELECT_HUD_TITLE, toolHudTitle } from '../../../lib/hud-title'
import { snapContextOf } from '../../../lib/snapping-mode'
import { cornerHintRows } from '../../../store/use-corner-snap-hint'
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

  test('shows snapping controls and the primary gesture with expandable secondary shortcuts', () => {
    // Server rendering reads each store's initial state: the wall context starts
    // on Grid with a 0.5 m step.
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel hints={ROOM_DIVIDE_HINTS} snapContext="wall" />
      </TooltipProvider>,
    )
    expect(html).toContain('Snapping: Grid')
    expect(html).toContain('Grid: 0.50 m')
    for (const label of ['Add point', 'More shortcuts', 'Cancel'])
      expect(html).toContain(label)
    expect(html).toContain('aria-expanded="false"')
    for (const label of ['Remove last point', 'Finish at the edge'])
      expect(html).not.toContain(label)
    expect(ROOM_DIVIDE_HINTS.map((hint) => hint.keys)).toEqual([
      ['Left click'],
      ['Backspace'],
      ['Enter'],
      ['Esc'],
    ])
  })

  test('keeps active secondary gestures visible while shortcuts are collapsed', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel
          hints={ROOM_DIVIDE_HINTS.map((hint) => ({
            ...hint,
            active: hint.keys.includes('Enter'),
          }))}
          snapContext="wall"
        />
      </TooltipProvider>,
    )
    for (const label of ['Add point', 'Finish at the edge', 'Cancel'])
      expect(html).toContain(label)
    expect(html).not.toContain('Remove last point')
    expect(html).toContain('aria-expanded="false"')
  })

  test('keeps a note row visible while shortcuts are collapsed', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel
          hints={[
            { keys: ['Left click'], label: 'Place' },
            ...cornerHintRows('free_end'),
            { keys: ['R', 'T'], label: 'Rotate' },
            { keys: ['Esc'], label: 'Cancel' },
          ]}
        />
      </TooltipProvider>,
    )
    for (const label of ['Place', 'No wall meets here', 'More shortcuts', 'Cancel'])
      expect(html).toContain(label)
    expect(html).not.toContain('Rotate')
  })

  test('offers More shortcuts only when collapsing hides a row', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel
          hints={[{ keys: ['Left click'], label: 'Place' }, ...cornerHintRows('free_end')]}
        />
      </TooltipProvider>,
    )
    expect(html).toContain('No wall meets here')
    expect(html).not.toContain('More shortcuts')
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
