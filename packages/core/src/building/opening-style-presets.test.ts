import { describe, expect, test } from 'bun:test'
import { DoorNode, WindowNode } from '../schema'
import {
  DOOR_STYLE_LABELS,
  DOOR_STYLES,
  doorStyleLook,
  doorStylesOf,
  getWindowStyleOverrides,
  WINDOW_STYLE_LABELS,
  WINDOW_STYLES,
  windowStylesOf,
} from './opening-style-presets'

/**
 * The door and window panels show the agents' styles. What goes wrong, written first: a
 * style the panel cannot read back (it shows Custom for a door just given it); a second style
 * keeping the first one's fields (modern's flush padding left on a panel door); an old or
 * hand-made leaf shown as a style it isn't.
 */

const door = (fields: Partial<DoorNode> = {}) => DoorNode.parse({ id: 'door_style', ...fields })
const windowNode = (fields: Partial<WindowNode> = {}) =>
  WindowNode.parse({ id: 'window_style', ...fields })

describe('door styles in the panel', () => {
  test('every style has a display label', () => {
    expect(Object.keys(DOOR_STYLE_LABELS).sort()).toEqual([...DOOR_STYLES].sort())
    for (const label of Object.values(DOOR_STYLE_LABELS)) expect(label).toMatch(/^[A-Z][^A-Z]*$/)
  })

  for (const style of DOOR_STYLES)
    test(`a door given ${style} reads back as ${style}, whatever it had before`, () => {
      for (const before of [
        door(),
        door(doorStyleLook('modern')),
        door(doorStyleLook('six-panel')),
      ])
        expect(doorStylesOf({ ...before, ...doorStyleLook(style) })).toEqual([style])
    })

  test('a new door is a panel door', () => {
    expect(doorStylesOf(door())).toEqual(['panel'])
  })

  test('a leaf made by hand, or an old empty modern leaf, is no style', () => {
    const [top, bottom] = door().segments
    expect(doorStylesOf(door({ segments: [top!, { ...bottom!, heightRatio: 0.7 }] }))).toEqual([])
    expect(
      doorStylesOf(
        door({
          segments: [
            {
              type: 'empty',
              heightRatio: 1,
              columnRatios: [1],
              dividerThickness: 0.03,
              panelDepth: 0.01,
              panelInset: 0.04,
            },
          ],
        }),
      ),
    ).toEqual([])
  })
})

describe('window styles in the panel', () => {
  test('every style has a display label', () => {
    expect(Object.keys(WINDOW_STYLE_LABELS).sort()).toEqual([...WINDOW_STYLES].sort())
    for (const label of Object.values(WINDOW_STYLE_LABELS)) expect(label).toMatch(/^[A-Z][^A-Z]*$/)
  })

  // Held out from the door rule: panes, not segments.
  for (const style of WINDOW_STYLES)
    test(`a window given ${style} reads back with ${style} among its styles`, () => {
      const styled = windowNode(getWindowStyleOverrides(style))
      expect(windowStylesOf(styled)).toContain(style)
    })

  test('a single pane is both single and picture, which draw the same', () => {
    expect(windowStylesOf(windowNode())).toEqual(['single', 'picture'])
  })

  test('panes set by hand are no style', () => {
    expect(windowStylesOf(windowNode({ columnRatios: [0.3, 0.7], rowRatios: [1] }))).toEqual([])
  })
})
