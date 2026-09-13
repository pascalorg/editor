import { describe, expect, test } from 'bun:test'
import type { Member, RoomSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { BLOCK_CHASE_FLAG, BLOCK_FURRING, furOutOfBlock } from './block-furring'

/** A 6 m block wall along +x at z = 0, 0.248 m thick, the room on its −z side. */
const wall: WallSlice = {
  id: 'w_block',
  start: [0, 0],
  end: [6, 0],
  length: 6,
  dir: [1, 0],
  thickness: 0.248,
  height: 2.74,
  exterior: true,
  openings: [],
  curved: false,
  framingKind: 'cmu',
} as unknown as WallSlice
const room: RoomSlice = {
  id: 'r',
  name: 'Living',
  category: 'living',
  polygon: [
    [0, -0.124],
    [6, -0.124],
    [6, -5],
    [0, -5],
  ],
  boundaryWallIds: ['w_block'],
} as unknown as RoomSlice

function wire(x0: number, x1: number, z: number, y = 0.46): Member {
  const len = Math.abs(x1 - x0)
  return {
    system: 'electrical',
    role: 'wire-run',
    dims: [len, inches(0.4), inches(0.4)],
    length: len,
    position: [(x0 + x1) / 2, y, z],
    rotation: [0, 0, 0],
    material: 'copper',
    sourceId: 'c1',
    label: 'NM-B 14/2 w/G — LTG-1',
  }
}

describe('furOutOfBlock', () => {
  test('a cable laid through the block core moves to the furring space on the room side', () => {
    const r = furOutOfBlock([wire(1, 4, 0)], [{ wall }], [room])
    expect(r.furred).toBe(1)
    const moved = r.members[0] as Member
    // inside face at z = −0.124; gypsum 1/2 in; the furring centre 3/8 in inside that
    const expected = -(0.124 - inches(0.5) - BLOCK_FURRING / 2)
    expect(moved.position[2]).toBeCloseTo(expected, 6)
    expect(moved.position[0]).toBeCloseTo(2.5, 6)
    expect(moved.label).toMatch(/furring space on the block/)
    expect(r.warnings[0]).toMatch(/furring space/)
  })

  test('a riser in the block moves too; a run already in the furring stays put', () => {
    const riser: Member = {
      system: 'plumbing',
      role: 'pipe-run',
      dims: [0.016, 2.0, 0.016],
      length: 2.0,
      position: [2, 1.0, 0.02],
      rotation: [0, 0, 0],
      material: 'copper',
      sourceId: 'p1',
      label: 'Cold ½"',
    }
    const inFurring = wire(1, 4, -(0.124 - inches(0.5) - BLOCK_FURRING / 2))
    const r = furOutOfBlock([riser, inFurring], [{ wall }], [room])
    expect(r.furred).toBe(1)
    expect((r.members[0] as Member).position[2]).toBeLessThan(0)
    expect(r.members[1]).toEqual(inFurring)
  })

  test('a run crossing the block is sleeved, a vent that cannot fit is flagged, a framed wall is untouched', () => {
    const crossing: Member = {
      ...wire(0, 0, 0),
      dims: [0.4, inches(0.4), inches(0.4)],
      length: 0.4,
      position: [3, 0.46, 0],
      rotation: [0, Math.PI / 2, 0],
      label: 'Service entrance 2 AWG Cu',
    }
    const vent: Member = {
      system: 'plumbing',
      role: 'pipe-run',
      dims: [0.04, 2.5, 0.04],
      length: 2.5,
      position: [4, 1.25, 0],
      rotation: [0, 0, 0],
      material: 'pvc',
      sourceId: 'v1',
      label: '1½" re-vent',
    }
    const r = furOutOfBlock([crossing, vent], [{ wall }], [room])
    expect(r.sleeved).toBe(1)
    expect((r.members[0] as Member).label).toMatch(/sleeved through the block/)
    expect(r.flagged).toBe(1)
    expect((r.members[1] as Member).flag).toBe(BLOCK_CHASE_FLAG)
    expect((r.members[1] as Member).position).toEqual(vent.position)
    // no block walls at all: byte-identical
    const w = wire(1, 4, 0)
    expect(furOutOfBlock([w], [], [room]).members).toEqual([w])
  })

  test('a device pigtail across the wall becomes the furring depth on the room side', () => {
    const stub: Member = { ...wire(0, 0, 0), dims: [0.143, inches(0.4), inches(0.4)], length: 0.143, position: [2, 0.46, 0], rotation: [0, Math.PI / 2, 0] }
    const r = furOutOfBlock([stub], [{ wall }], [room])
    expect(r.furred).toBe(1)
    expect(r.sleeved).toBe(0)
    const moved = r.members[0] as Member
    expect(moved.length).toBeCloseTo(BLOCK_FURRING, 6)
    expect(moved.position[2]).toBeLessThan(0)
  })

  test('a mixed knee wall only furs what stands below the block', () => {
    const low = wire(1, 4, 0, 0.4)
    const high = wire(1, 4, 0, 2.0)
    const r = furOutOfBlock([low, high], [{ wall, cmuTopY: 1.0 }], [room])
    expect(r.furred).toBe(1)
    expect(r.members[1]).toEqual(high)
  })
})
