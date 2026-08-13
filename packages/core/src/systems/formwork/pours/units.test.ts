import { describe, expect, it } from 'bun:test'
import { ColumnNode } from '../../../schema/nodes/column'
import { ConstructionJointNode } from '../../../schema/nodes/construction-joint'
import { SlabNode } from '../../../schema/nodes/slab'
import { WallNode } from '../../../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../../../schema/types'
import type { CastableElement } from '../coverage/elements'
import { toCastableElement } from '../coverage/elements'
import { splitIntoLifts } from './lifts'
import {
  hardCutsForElement,
  pourLimitsForElement,
  pourUnits,
  pourUnitsForElement,
  pourUnitsInScene,
  specifiedLiftJoints,
} from './units'

function wall(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}) {
  return WallNode.parse({
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 9,
    formworkType: 'plywood',
    ...overrides,
  })
}

function element(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}): CastableElement {
  const castable = toCastableElement(wall(overrides))
  if (!castable) throw new Error('not castable')
  return castable
}

/** The element for a wall node already in the scene — same id, so a joint can name it. */
function castable(node: ReturnType<typeof wall>): CastableElement {
  const out = toCastableElement(node)
  if (!out) throw new Error('not castable')
  return out
}

function joint(overrides: Partial<Parameters<typeof ConstructionJointNode.parse>[0]> = {}) {
  return ConstructionJointNode.parse({ ...overrides })
}

describe('pourUnitsForElement', () => {
  it('yields one unit per element with no limits configured', () => {
    const units = pourUnitsForElement(element())
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      segmentIndex: 0,
      liftIndex: 0,
      startAlong: 0,
      endAlong: 40,
      baseElevation: 0,
      topElevation: 9,
      hasJointBelow: false,
    })
  })

  it('crosses segments with lifts into a rectangular grid', () => {
    const units = pourUnitsForElement(element(), { maxPourLength: 12, maxLiftHeight: 4 })
    expect(units).toHaveLength(12)
    const keys = units.map((u) => `${u.segmentIndex}/${u.liftIndex}`)
    expect(new Set(keys).size).toBe(12)
  })

  it('computes the volume of each unit, not of the element', () => {
    const units = pourUnitsForElement(element(), { maxPourLength: 12, maxLiftHeight: 4 })
    // 10 m × 3 m × 0.3 m per unit; 12 units restore the element's 108 m³.
    for (const unit of units) expect(unit.volumeCuM).toBeCloseTo(9, 9)
    expect(units.reduce((sum, u) => sum + u.volumeCuM, 0)).toBeCloseTo(40 * 9 * 0.3, 9)
  })

  it('marks only the bottom lift of each segment as bearing on the substrate', () => {
    const units = pourUnitsForElement(element(), { maxPourLength: 12, maxLiftHeight: 4 })
    expect(units.filter((u) => !u.hasJointBelow)).toHaveLength(4)
    for (const unit of units.filter((u) => !u.hasJointBelow)) expect(unit.liftIndex).toBe(0)
  })

  it('carries the cut reason from the segment onto every lift of it', () => {
    const units = pourUnitsForElement(element(), { maxPourLength: 12, maxLiftHeight: 4 })
    for (const unit of units.filter((u) => u.segmentIndex === 1)) {
      expect(unit.startCutReason).toBe('MAX_POUR_LENGTH')
      expect(unit.endCutReason).toBe('MAX_POUR_LENGTH')
    }
  })

  it('applies a hard cut to the plan split', () => {
    const units = pourUnitsForElement(element(), {}, [{ along: 15 }])
    expect(units.map((u) => [u.startAlong, u.endAlong])).toEqual([
      [0, 15],
      [15, 40],
    ])
  })
})

describe('hardCutsForElement', () => {
  it('reads an expansion joint that names the element', () => {
    const w = wall()
    const j = joint({ kind: 'expansion', elementIds: [w.id], along: 15 })
    expect(hardCutsForElement(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([{ along: 15 }])
  })

  it('reads an isolation joint', () => {
    const w = wall()
    const j = joint({ kind: 'isolation', elementIds: [w.id], along: 20 })
    expect(hardCutsForElement(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([{ along: 20 }])
  })

  it('ignores a construction joint, which is the solver’s own soft cut', () => {
    // Treating it as hard input would freeze whatever split the previous run
    // produced, so a later change to the pour limits could never move it.
    const w = wall()
    const j = joint({ kind: 'construction', elementIds: [w.id], along: 15, solverPlaced: true })
    expect(hardCutsForElement(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([])
  })

  it('ignores a joint that names a different element', () => {
    const w = wall()
    const other = wall({ start: [0, 5], end: [40, 5] })
    const j = joint({ kind: 'expansion', elementIds: [other.id], along: 15 })
    expect(hardCutsForElement(w.id as AnyNodeId, [w, other, j] as AnyNode[])).toEqual([])
  })

  it('ignores a joint with no position along the element', () => {
    // An interface joint between two elements is positioned by where they meet,
    // so it is not a cut inside either one.
    const w = wall()
    const j = joint({ kind: 'expansion', elementIds: [w.id] })
    expect(hardCutsForElement(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([])
  })
})

describe('pour units of a point-like or planar element', () => {
  function column(overrides: Partial<Parameters<typeof ColumnNode.parse>[0]> = {}) {
    const castable = toCastableElement(
      ColumnNode.parse({
        position: [0, 0, 0],
        crossSection: 'square',
        width: 0.4,
        depth: 0.4,
        height: 9,
        ...overrides,
      }),
    )
    if (!castable) throw new Error('not castable')
    return castable
  }

  function slab(overrides: Partial<Parameters<typeof SlabNode.parse>[0]> = {}) {
    const castable = toCastableElement(
      SlabNode.parse({
        polygon: [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
        thickness: 0.2,
        ...overrides,
      }),
    )
    if (!castable) throw new Error('not castable')
    return castable
  }

  it('takes a column’s volume from its plan area — length × thickness is zero for a point', () => {
    const units = pourUnitsForElement(column())
    expect(units).toHaveLength(1)
    expect(units[0]?.volumeCuM).toBeCloseTo(0.4 * 0.4 * 9, 9)
  })

  it('splits a tall column into lifts and keeps the total', () => {
    const units = pourUnitsForElement(column(), { maxLiftHeight: 4 })
    expect(units).toHaveLength(3)
    expect(units.reduce((sum, u) => sum + u.volumeCuM, 0)).toBeCloseTo(0.4 * 0.4 * 9, 9)
  })

  it('never lifts a column past its own plan — a pour length cannot cut it', () => {
    expect(pourUnitsForElement(column(), { maxPourLength: 0.1 })).toHaveLength(1)
  })

  it('pours a slab as one unit — a lift height cannot slice it through its thickness', () => {
    const units = pourUnitsForElement(slab(), { maxLiftHeight: 0.05, maxPourLength: 2 })
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ segmentIndex: 0, liftIndex: 0, hasJointBelow: false })
    expect(units[0]?.volumeCuM).toBeCloseTo(6 * 4 * 0.2, 9)
  })

  it('takes a slab’s holes out of its volume', () => {
    const units = pourUnitsForElement(
      slab({
        holes: [
          [
            [1, 1],
            [3, 1],
            [3, 3],
            [1, 3],
          ],
        ],
      }),
    )
    expect(units[0]?.volumeCuM).toBeCloseTo((6 * 4 - 4) * 0.2, 9)
  })
})

describe('pourUnits', () => {
  it('keys units by element', () => {
    const a = wall()
    const b = wall({ start: [0, 5], end: [10, 5], height: 3 })
    const map = pourUnits([a, b] as AnyNode[], { maxLiftHeight: 4 })
    expect(map.get(a.id as AnyNodeId)).toHaveLength(3)
    expect(map.get(b.id as AnyNodeId)).toHaveLength(1)
  })

  it('applies each element’s own hard cuts', () => {
    const a = wall()
    const b = wall({ start: [0, 5], end: [40, 5] })
    const j = joint({ kind: 'expansion', elementIds: [a.id], along: 15 })
    const map = pourUnits([a, b, j] as AnyNode[])
    expect(map.get(a.id as AnyNodeId)).toHaveLength(2)
    expect(map.get(b.id as AnyNodeId)).toHaveLength(1)
  })
})

describe('specifiedLiftJoints', () => {
  it('reads a construction joint somebody placed at an elevation', () => {
    const w = wall()
    const j = joint({ kind: 'construction', elementIds: [w.id], elevation: 4.6 })
    expect(specifiedLiftJoints(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([4.6])
  })

  it('ignores the solver’s own joints, which are a record of the last split', () => {
    const w = wall()
    const j = joint({
      kind: 'construction',
      elementIds: [w.id],
      elevation: 4.5,
      solverPlaced: true,
    })
    expect(specifiedLiftJoints(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([])
  })

  it('ignores an expansion joint, which partitions the plan rather than the height', () => {
    const w = wall()
    const j = joint({ kind: 'expansion', elementIds: [w.id], elevation: 4.6 })
    expect(specifiedLiftJoints(w.id as AnyNodeId, [w, j] as AnyNode[])).toEqual([])
  })
})

describe('a specified lift joint in the scene', () => {
  it('splits an element the project put no lift cap on', () => {
    const w = wall({ end: [5, 0] })
    const j = joint({ kind: 'construction', elementIds: [w.id], elevation: 4.6 })
    const units = pourUnitsInScene(castable(w), [w, j] as AnyNode[])
    expect(units.map((u) => [u.baseElevation, u.topElevation])).toEqual([
      [0, 4.6],
      [4.6, 9],
    ])
  })

  it('survives the uniform division, which would have cut at 4.5 m', () => {
    const w = wall({ end: [5, 0] })
    const j = joint({ kind: 'construction', elementIds: [w.id], elevation: 4.6 })
    const units = pourUnitsInScene(castable(w), [w, j] as AnyNode[], {
      maxLiftHeight: 5,
    })
    // The 4.5 m uniform cut snapped onto the specified joint rather than joining it —
    // two cuts 100 mm apart would be a lift nobody can form.
    expect(units.map((u) => u.baseElevation)).toEqual([0, 4.6])
  })

  it('is permitted as well as required, so the validator does not fault it', () => {
    const w = wall({ end: [5, 0] })
    const j = joint({ kind: 'construction', elementIds: [w.id], elevation: 4.6 })
    const limits = pourLimitsForElement(w.id as AnyNodeId, [w, j] as AnyNode[])
    expect(limits.requiredJointElevations).toEqual([4.6])
    expect(limits.permittedJointElevations).toEqual([4.6])
    // And the split records it as on a permitted elevation, which is the field the
    // off-permitted-elevation warning reads.
    expect(splitIntoLifts(castable(w), limits)[1]?.snappedTo).toBe(4.6)
  })
})
