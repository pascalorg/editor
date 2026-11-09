import { expect, test } from 'bun:test'
import { paintCommitRoute } from './paint-commit-route'

test('only the hovered surface itself keeps the kind commit', () => {
  expect(paintCommitRoute([], 'wall_a', 'a')).toBe('own')
  expect(paintCommitRoute([{ nodeId: 'wall_a', role: 'a' }], 'wall_a', 'a')).toBe('own')
  // A one-wall room: one target, but on the room role.
  expect(paintCommitRoute([{ nodeId: 'wall_a', role: 'room:zone_1' }], 'wall_a', 'a')).toBe(
    'fanout',
  )
  expect(paintCommitRoute([{ nodeId: 'wall_b', role: 'a' }], 'wall_a', 'a')).toBe('fanout')
  expect(
    paintCommitRoute(
      [
        { nodeId: 'wall_a', role: 'a' },
        { nodeId: 'wall_b', role: 'a' },
      ],
      'wall_a',
      'a',
    ),
  ).toBe('fanout')
})

for (const role of ['step:zone_upper', 'edge:zone_upper'])
  test(`${role} retains the room side role through paint routing`, () => {
    expect(paintCommitRoute([{ nodeId: 'slab_platform', role }], 'slab_platform', role)).toBe('own')
    expect(
      paintCommitRoute(
        [
          { nodeId: 'slab_platform', role },
          { nodeId: 'slab_component', role },
        ],
        'slab_platform',
        role,
      ),
    ).toBe('fanout')
  })
