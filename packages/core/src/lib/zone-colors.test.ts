import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ZONE_COLOR,
  deriveZoneColors,
  LevelNode,
  ZoneNode,
  zoneDisplayColor,
} from '../index'

const square = (x: number, z: number, size = 4): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]

// A row of rooms sharing walls, as the reconciler creates them: default blue.
function row(count: number, ids = Array.from({ length: count }, (_, i) => `zone_row${i}`)) {
  return ids.map((id, i) => ZoneNode.parse({ id, name: `Room ${i}`, polygon: square(i * 4, 0) }))
}

describe('derived zone colours', () => {
  test('neighbouring rooms on the default colour show different hues', () => {
    const zones = row(6)
    const colors = deriveZoneColors(zones)
    for (let i = 1; i < zones.length; i++) {
      expect(colors.get(zones[i]!.id)).not.toBe(colors.get(zones[i - 1]!.id))
    }
  })

  test('rooms the AI scene agent stamped light blue count as unpicked too', () => {
    const zones = row(4).map((zone) => ({ ...zone, color: '#60A5FA' }))
    const colors = deriveZoneColors(zones)
    for (let i = 1; i < zones.length; i++) {
      expect(colors.get(zones[i]!.id)).not.toBe(colors.get(zones[i - 1]!.id))
    }
  })

  test('the result depends on ids only, so reloads and collaborators agree', () => {
    const zones = row(5)
    const once = deriveZoneColors(zones)
    const reordered = deriveZoneColors([...zones].reverse())
    expect([...reordered.entries()].sort()).toEqual([...once.entries()].sort())
  })

  test('mixed-case ids use the same order regardless of the client locale', () => {
    const zones = row(2, ['zone_D', 'zone_b'])
    const colors = deriveZoneColors(zones)
    expect(colors.get('zone_D')).toBe('#06b6d4')
    expect(colors.get('zone_b')).toBe('#3b82f6')
  })

  test('a chosen hex colour excludes the same hue regardless of letter case', () => {
    const zones = row(2, ['zone_chosen', 'zone_D'])
    const colors = deriveZoneColors([{ ...zones[0]!, color: '#06B6D4' }, zones[1]!])
    expect(colors.get('zone_chosen')).toBe('#06B6D4')
    expect(colors.get('zone_D')).not.toBe('#06b6d4')
  })

  test('a chosen colour is kept, and its neighbour steps past it', () => {
    const [chosen, derived] = row(2)
    const picked = ZoneNode.parse({ ...chosen!, color: '#a855f7' })
    for (const color of ['#a855f7', '#ef4444', '#22c55e']) {
      const colors = deriveZoneColors([{ ...picked, color }, derived!])
      expect(colors.get(picked.id)).toBe(color)
      expect(colors.get(derived!.id)).not.toBe(color)
    }
  })

  test('the display colour reads the zone siblings through the resolver, without writing', () => {
    const level = LevelNode.parse({ id: 'level_colors' })
    const zones = row(3).map((zone) => ({ ...zone, parentId: level.id }))
    const nodes: Record<string, AnyNode> = {
      [level.id]: { ...level, children: zones.map((zone) => zone.id) } as AnyNode,
      ...Object.fromEntries(zones.map((zone) => [zone.id, zone])),
    }
    const resolve = (id: AnyNodeId) => nodes[id]
    const shown = zones.map((zone) => zoneDisplayColor(zone, resolve))
    expect(new Set(shown).size).toBe(3)
    expect(zones.every((zone) => zone.color === DEFAULT_ZONE_COLOR)).toBe(true)
    expect(shown).toEqual([...deriveZoneColors(zones).values()].slice(0, 3))
  })
})
