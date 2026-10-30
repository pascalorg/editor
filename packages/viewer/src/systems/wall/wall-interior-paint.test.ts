import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_EXTERIOR_WALL_FINISH,
  DEFAULT_INTERIOR_WALL_PAINT,
  getWallAssemblyPreset,
  WallNode,
} from '@pascal-app/core'
import { createMaterialFromPresetRef } from '../../lib/materials'
import { getMaterialsForWall } from './wall-materials'

// An unpainted interior face wears the interior paint, Seattle grey, where it once showed raw
// drywall; an unpainted exterior face with no cladding keeps raw drywall. Library materials are
// cached by preset, so a face is told by the instance it gets.
let serial = 0
function wall(extra: Record<string, unknown> = {}) {
  serial += 1
  return WallNode.parse({
    id: `wall_interior_paint_${serial}`,
    start: [0, 0],
    end: [4, 0],
    ...extra,
  })
}
const faces = (node: WallNode) => {
  const visible = getMaterialsForWall(node, 'rendered', true, 'clay', undefined, {}).visible
  return { a: visible[1]!, b: visible[2]! }
}
const library = (ref: string) => createMaterialFromPresetRef(ref)!
const grey = () => library(DEFAULT_INTERIOR_WALL_PAINT)
const drywall = () => library(DEFAULT_EXTERIOR_WALL_FINISH)
const sided = (extra: Record<string, unknown> = {}) =>
  wall({
    frontSide: 'exterior',
    backSide: 'interior',
    assembly: getWallAssemblyPreset('exterior-2x6-siding')!.assembly,
    ...extra,
  })

describe('an unpainted interior wall face', () => {
  test('both faces of a partition wear Seattle grey, not raw drywall', () => {
    const partitions = [
      wall(),
      wall({ frontSide: 'interior', backSide: 'interior' }),
      wall({
        frontSide: 'interior',
        backSide: 'interior',
        assembly: getWallAssemblyPreset('interior-2x4-drywall')!.assembly,
      }),
    ]
    for (const partition of partitions) {
      const { a, b } = faces(partition)
      expect(a).toBe(grey())
      expect(b).toBe(grey())
      expect(a).not.toBe(drywall())
    }
  })

  test('the inside face of an exterior wall wears Seattle grey; the cladding outside is unchanged', () => {
    const { a, b } = faces(sided())
    expect(a).toBe(library('library:siding-lap-white'))
    expect(b).toBe(grey())
    const turned = faces(sided({ frontSide: 'interior', backSide: 'exterior' }))
    expect(turned.a).toBe(grey())
    expect(turned.b).toBe(library('library:siding-lap-white'))
  })

  test('the outside face of an exterior wall with no cladding keeps raw drywall', () => {
    // An old save's exterior wall: sides detected, no assembly.
    const old = faces(wall({ frontSide: 'exterior', backSide: 'interior' }))
    expect(old.a).toBe(drywall())
    expect(old.b).toBe(grey())
    const turned = faces(wall({ frontSide: 'interior', backSide: 'exterior' }))
    expect(turned.a).toBe(grey())
    expect(turned.b).toBe(drywall())
    // A freestanding wall outdoors on both sides has no inside face.
    const outdoors = faces(wall({ frontSide: 'exterior', backSide: 'exterior' }))
    expect(outdoors.a).toBe(drywall())
    expect(outdoors.b).toBe(drywall())
  })

  test('a face re-skins when its room is detected on the other side', () => {
    const id = 'wall_interior_paint_turned'
    const before = faces(WallNode.parse({ id, start: [0, 0], end: [4, 0] }))
    expect(before.a).toBe(grey())
    const after = faces(
      WallNode.parse({
        id,
        start: [0, 0],
        end: [4, 0],
        frontSide: 'exterior',
        backSide: 'interior',
      }),
    )
    expect(after.a).toBe(drywall())
    expect(after.b).toBe(grey())
  })

  test('a painted face keeps its paint, raw drywall picked on purpose included', () => {
    const { a, b } = faces(
      sided({ slots: { a: 'library:preset-sage', b: 'library:concrete-drywall' } }),
    )
    expect(a).toBe(library('library:preset-sage'))
    expect(b).toBe(library('library:concrete-drywall'))
    const outside = faces(
      wall({ frontSide: 'exterior', backSide: 'interior', slots: { a: 'library:preset-sage' } }),
    )
    expect(outside.a).toBe(library('library:preset-sage'))
  })
})
