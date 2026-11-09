import { describe, expect, test } from 'bun:test'
import { rankedGroups } from '.'

const action = (group: string, label: string, keywords?: string[]) => ({
  id: label,
  group,
  label,
  keywords,
  execute: () => {},
})

// What a host's palette holds: weak fuzzy matches for "theme" registered before the strong one.
const actions = [
  action('Generate', 'Generate house from template: The Poppy', ['template', 'adu', 'poppy']),
  action('Viewer Controls', 'Switch to Solid', ['solid', 'shading', 'render', 'mode']),
  action('View', 'Use dark theme', ['theme', 'appearance', 'interface']),
  action('Export & Share', 'Take Screenshot', ['screenshot', 'capture', 'image']),
]

const order = (search: string) => rankedGroups(actions, search).map(([group]) => group)

describe('command palette groups', () => {
  test('a search lists the group with the best match first', () => {
    expect(order('theme')[0]).toBe('View')
    expect(order('solid')[0]).toBe('Viewer Controls')
  })

  test('with no search the groups keep the order they were registered in', () => {
    expect(order('')).toEqual(['Generate', 'Viewer Controls', 'View', 'Export & Share'])
  })
})
