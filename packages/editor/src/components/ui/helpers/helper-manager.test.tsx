import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AXIS_MOVE_DRAG_LABEL,
  PATH_POINT_DRAG_LABEL,
  ROTATE_HANDLE_DRAG_LABEL,
} from '../../../lib/contextual-help'
import { COMMENT_HUD_TITLE, SELECT_HUD_TITLE, toolHudTitle } from '../../../lib/hud-title'
import { snapContextOf } from '../../../lib/snapping-mode'
import { cornerHintRows } from '../../../store/use-corner-snap-hint'
import { TooltipProvider } from '@pascal-app/viewer/ui'
import { ContextualHelperPanel } from './contextual-helper-panel'
import {
  commentToolHints,
  mepHandleGesture,
  mepHandleGestureHints,
  mezzanineHints,
  openingHints,
  ROOM_DIVIDE_HINTS,
  toolHintsOwnPlacing,
} from './helper-manager'

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
    expect(html).toContain('Grid: 0.50\u00a0m')
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
    expect(SELECT_HUD_TITLE).toMatchObject({
      label: expect.objectContaining({ message: 'Select' }),
      shortcut: 'V',
    })
  })
})

describe('MEP handle HUD', () => {
  const english = (hints: ReturnType<typeof mepHandleGestureHints>) =>
    hints.map((hint) => (typeof hint.label === 'string' ? hint.label : hint.label.message))
  const drag = (label: string) => ({ nodeId: 'pipe_a', label })

  test('names a run point drag and an axis slide, and leaves rotate and resize to their own HUDs', () => {
    expect(mepHandleGesture(drag(PATH_POINT_DRAG_LABEL))).toBe('edit-path')
    expect(mepHandleGesture(drag(AXIS_MOVE_DRAG_LABEL))).toBe('move')
    expect(mepHandleGesture(drag(ROTATE_HANDLE_DRAG_LABEL))).toBeNull()
    expect(mepHandleGesture(drag('resize-diameter'))).toBeNull()
    expect(mepHandleGesture(null)).toBeNull()
  })

  test('keeps "Alt: Detach the joint" on screen for the whole run point drag', () => {
    const idle = mepHandleGestureHints('edit-path', false)
    expect(english(idle)).toEqual(['Detach the joint', 'Cancel'])
    expect(idle.map((hint) => hint.keys)).toEqual([['Alt'], ['Esc']])
    expect(idle[0]?.active).toBe(false)
    expect(mepHandleGestureHints('edit-path', true)[0]?.active).toBe(true)
    expect(english(mepHandleGestureHints('move', false))).toEqual(['Cancel'])

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel hints={idle} snapContext="polygon" />
      </TooltipProvider>,
    )
    for (const label of ['Detach the joint', 'Cancel', 'Snapping: Grid']) expect(html).toContain(label)
  })

  test('a handle drag snaps in its kind context, and a rotate arc in angles', () => {
    const contextOf = (handle: string, profile: 'item' | 'structural') =>
      snapContextOf({
        scope: { kind: 'handle-drag', nodeId: 'pipe_a', handle },
        mode: 'select',
        tool: null,
        profileOf: () => undefined,
        profileOfNode: () => profile,
      })
    expect(contextOf(PATH_POINT_DRAG_LABEL, 'structural')).toBe('polygon')
    expect(contextOf(AXIS_MOVE_DRAG_LABEL, 'structural')).toBe('polygon')
    expect(contextOf(AXIS_MOVE_DRAG_LABEL, 'item')).toBe('item')
    expect(contextOf('resize-diameter', 'item')).toBe('item')
    expect(contextOf(ROTATE_HANDLE_DRAG_LABEL, 'item')).toBe('rotation')
  })
})

describe('Cut opening HUD', () => {
  test('names the drag gesture "Draw the opening", not the mezzanine', () => {
    // The drag row folds under "More shortcuts", so read the rows the HUD is given.
    const english = (hints: ReturnType<typeof openingHints>) =>
      hints.map((hint) => (typeof hint.label === 'string' ? hint.label : hint.label.message))
    expect(english(openingHints('rectangle'))).toContain('Draw the opening')
    expect(english(openingHints('rectangle'))).not.toContain('Draw the mezzanine')
    expect(english(mezzanineHints('rectangle'))).toContain('Draw the mezzanine')
  })
})

// The roof tool holds its draft in a placing scope, so the HUD read "Move roof · Left click: Place"
// while a click set a footprint corner; the tool's own hints say what the click does.
describe('a registry tool holding its draft', () => {
  const placing = (driver: 'registry-tool' | 'move-tool', nodeType = 'roof') => ({
    kind: 'placing' as const,
    node: { id: 'roof_draft', type: nodeType } as never,
    nodeId: 'roof_draft',
    nodeType,
    view: '3d' as const,
    pressDrag: false,
    driver,
  })

  test("shows the armed tool's hints", () => {
    expect(toolHintsOwnPlacing(placing('registry-tool'), 'roof', 3)).toBe(true)
  })

  test('leaves a move, a catalog placement or a tool with no hints to the move rows', () => {
    expect(toolHintsOwnPlacing(placing('move-tool'), 'roof', 3)).toBe(false)
    expect(toolHintsOwnPlacing(placing('registry-tool', 'item'), 'roof', 3)).toBe(false)
    expect(toolHintsOwnPlacing(placing('registry-tool'), 'roof', 0)).toBe(false)
    expect(
      toolHintsOwnPlacing(
        { kind: 'moving', node: { id: 'r', type: 'roof' } as never, nodeId: 'r', nodeType: 'roof', view: '3d' },
        'roof',
        3,
      ),
    ).toBe(false)
  })
})

describe('Comment tool HUD', () => {
  test('declares Comment title with 3D comment icon and C shortcut', () => {
    expect(COMMENT_HUD_TITLE.label.id).toBe('editor.lib.hudTitle.comment')
    expect(COMMENT_HUD_TITLE.label.message).toBe('Comment')
    expect(COMMENT_HUD_TITLE.icon).toEqual({
      kind: 'url',
      src: '/icons/comment.webp',
    })
    expect(COMMENT_HUD_TITLE.shortcut).toBe('C')
  })

  test('pointing mode renders all primary gestures uncollapsed and marks Alt active when held', () => {
    const hints = commentToolHints({
      altPressed: false,
      shiftPressed: false,
      composing: false,
      enrichedRegions: true,
      freeClick: true,
    })
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel hints={hints} title={COMMENT_HUD_TITLE} />
      </TooltipProvider>,
    )
    expect(html).toContain('data-hud-title="Comment"')
    for (const label of [
      'Pin a comment',
      'Any object, wall, or space',
      'Smart capture',
      'Frame an area with colour map',
      'Target deeper surface',
      'Wall or floor behind a room',
      'Exit comment',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('More shortcuts')

    const activeAltHints = commentToolHints({
      altPressed: true,
      shiftPressed: false,
      composing: false,
      enrichedRegions: true,
      freeClick: true,
    })
    expect(activeAltHints.find((hint) => hint.keys.includes('Alt'))?.active).toBe(true)
  })

  test('composing mode renders save, Ask Architect, multi-select, and dismiss rows and marks Shift active', () => {
    const hints = commentToolHints({
      altPressed: false,
      shiftPressed: true,
      composing: true,
      enrichedRegions: true,
      freeClick: true,
    })
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ContextualHelperPanel hints={hints} title={COMMENT_HUD_TITLE} />
      </TooltipProvider>,
    )
    for (const label of [
      'Save comment',
      'Pin without asking Architect',
      'Ask Architect',
      'Start an AI thread here',
      'Add or remove element',
      'Dismiss',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('More shortcuts')
    expect(hints.find((hint) => hint.keys.includes('Shift'))?.active).toBe(true)
  })

  test('commentToolHints defaults fall back to generic capture descriptions when flags are omitted', () => {
    const textOf = (value: { message?: string } | string | undefined) =>
      typeof value === 'string' ? value : value?.message

    const idle = { altPressed: false, shiftPressed: false }
    const pointing = commentToolHints({ ...idle, composing: false })
    expect(pointing.map((hint) => textOf(hint.label))).toEqual([
      'Pin a comment',
      'Smart capture',
      'Target deeper surface',
      'Exit comment',
    ])
    expect(textOf(pointing[0]?.subtitle)).toBe('Object, wall, or room')
    expect(textOf(pointing[1]?.subtitle)).toBe('Frame an area of the view')
    expect(textOf(pointing[2]?.subtitle)).toBe('Wall or floor behind a room')

    const composing = commentToolHints({ ...idle, composing: true })
    expect(composing.map((hint) => textOf(hint.label))).toEqual([
      'Send',
      'Add or remove element',
      'Dismiss',
    ])
  })
})
