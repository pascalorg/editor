import { describe, expect, test } from 'bun:test'
import {
  assertAdjacency,
  assertAllRoomsReachable,
  assertBounds,
  assertModification,
  assertPlanFirstResult,
  assertRoomCounts,
  assertTotalArea,
  assertWindowsRequiredFor,
  diffSnapshots,
  rollupAssertions,
  type SceneSnapshot,
  type WallInfo,
  type ZoneInfo,
} from './assertions'

// A 2-room layout: bedroom [0,4]×[0,3], living [4,8]×[0,3], shared wall x=4.
function zone(id: string, name: string, x0: number, z0: number, x1: number, z1: number): ZoneInfo {
  const polygon: Array<[number, number]> = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const areaSqMeters = Math.round((x1 - x0) * (z1 - z0) * 100) / 100
  return { id, name, polygon, areaSqMeters, bounds: { width: x1 - x0, depth: z1 - z0 } }
}

function wall(id: string, x0: number, z0: number, x1: number, z1: number, openings: string[] = []): WallInfo {
  return { id, start: [x0, z0], end: [x1, z1], openings: openings.map(type => ({ type })) }
}

describe('assertRoomCounts', () => {
  const zones = [zone('b', '主卧', 0, 0, 4, 3), zone('l', '客厅', 4, 0, 8, 3)]
  test('pass on exact match', () => {
    const [bed, living] = assertRoomCounts(zones, { 卧室: 1, 客厅: 1 })
    expect(bed?.status).toBe('pass')
    expect(living?.status).toBe('pass')
  })
  test('fail on wrong count', () => {
    const [bed] = assertRoomCounts(zones, { 卧室: 2 })
    expect(bed?.status).toBe('fail')
    expect(bed?.actual).toBe(1)
  })
  test('unsupported on unknown room type', () => {
    const [r] = assertRoomCounts(zones, { 地下室: 1 })
    expect(r?.status).toBe('unsupported')
  })

  test('客厅 and 餐厅 are counted as distinct room types (两厅)', () => {
    const twoHalls = [zone('l', '客厅', 0, 0, 4, 3), zone('d', '餐厅', 4, 0, 7, 3)]
    const [living, dining] = assertRoomCounts(twoHalls, { 客厅: 1, 餐厅: 1 })
    expect(living?.status).toBe('pass')
    expect(dining?.status).toBe('pass')
    // A dining room must NOT be miscounted as a second living room.
    const [asLiving] = assertRoomCounts(twoHalls, { 客厅: 2 })
    expect(asLiving?.status).toBe('fail')
  })
})

describe('assertTotalArea', () => {
  const zones = [zone('b', '卧室', 0, 0, 4, 3), zone('l', '客厅', 4, 0, 8, 3)] // 12 + 12 = 24
  test('pass within tolerance', () => {
    expect(assertTotalArea(zones, { target: 25, tolerance: 0.1 }).status).toBe('pass')
  })
  test('fail outside tolerance', () => {
    expect(assertTotalArea(zones, { target: 40, tolerance: 0.1 }).status).toBe('fail')
  })
  test('unsupported when no zones (missing data)', () => {
    expect(assertTotalArea([], { target: 40, tolerance: 0.1 }).status).toBe('unsupported')
  })
})

describe('assertWindowsRequiredFor', () => {
  // bedroom occupies [0,4]×[0,3]; exterior boundary includes x=0 and z=0.
  const zones = [zone('b', '卧室', 0, 0, 4, 3), zone('l', '客厅', 4, 0, 8, 3)]
  test('pass when the bedroom has an exterior window', () => {
    const walls = [wall('w', 0, 0, 0, 3, ['window'])] // west exterior wall of bedroom
    const [r] = assertWindowsRequiredFor(zones, walls, ['卧室'])
    expect(r?.status).toBe('pass')
  })
  test('fail when the window is only on an interior wall', () => {
    const walls = [wall('w', 4, 0, 4, 3, ['window'])] // shared interior wall x=4
    const [r] = assertWindowsRequiredFor(zones, walls, ['卧室'])
    expect(r?.status).toBe('fail')
  })
})

describe('assertAllRoomsReachable', () => {
  const zones = [zone('b', '卧室', 0, 0, 4, 3), zone('l', '客厅', 4, 0, 8, 3)]
  test('open kitchen (no wall on shared edge) counts as reachable', () => {
    // Entry: exterior door on living room south wall; bedroom shares an OPEN
    // boundary with living (no wall on x=4) → reachable without a door.
    const walls = [wall('entry', 4, 0, 8, 0, ['door'])]
    expect(assertAllRoomsReachable(zones, walls).status).toBe('pass')
  })
  test('a bedroom sealed off by a doorless wall is unreachable', () => {
    const walls = [
      wall('entry', 4, 0, 8, 0, ['door']), // exterior entry into living
      wall('shared', 4, 0, 4, 3, []), // solid wall between bedroom and living, no door
    ]
    expect(assertAllRoomsReachable(zones, walls).status).toBe('fail')
  })

  test('two zones sharing several boundary segments connect if ANY segment has a door (case-03 regression)', () => {
    // Kitchen carved out of an L-shaped living hub: they share BOTH the
    // kitchen's west edge (solid wall) and its south edge (has the door).
    // The old first-shared-segment check saw only the solid wall and marked
    // the kitchen unreachable.
    const lShapedLiving = {
      id: 'liv',
      name: '客厅',
      polygon: [[0, 0], [3.7, 0], [3.7, 2.4], [7.1, 2.4], [7.1, 5], [0, 5]] as Array<[number, number]>,
      areaSqMeters: 27,
      bounds: { width: 7.1, depth: 5 },
    }
    const kitchen = zone('kit', '厨房', 3.7, 0, 7.1, 2.4)
    const walls = [
      wall('entry', 0, 0, 3.7, 0, ['door']), // exterior entry into living
      wall('kit-west', 3.7, 0, 3.7, 2.4, []), // solid shared wall, no door
      wall('kit-south', 3.7, 2.4, 7.1, 2.4, ['door']), // the actual kitchen door
    ]
    const result = assertAllRoomsReachable([lShapedLiving, kitchen], walls)
    expect(result.status).toBe('pass')
  })
})

describe('assertAdjacency ensuite', () => {
  // bedroom [0,4]x[0,3], bath [4,6]x[0,3], living [6,10]x[0,3]
  const zones = [zone('bed', '主卧', 0, 0, 4, 3), zone('bath', '卫生间', 4, 0, 6, 3), zone('liv', '客厅', 6, 0, 10, 3)]
  test('pass when a bathroom connects only to one bedroom', () => {
    const walls = [
      wall('bed-bath', 4, 0, 4, 3, ['door']), // door between bedroom and bath
      wall('bath-liv', 6, 0, 6, 3, []), // solid wall bath|living, no door
      wall('entry', 6, 0, 10, 0, ['door']),
    ]
    const r = assertAdjacency(zones, walls, { a: '卧室', b: '卫生间', relation: 'ensuite' })
    expect(r.status).toBe('pass')
  })
  test('unsupported when bath shares a wall with a bedroom but no door confirms it', () => {
    const walls = [
      wall('bed-bath', 4, 0, 4, 3, []), // shared wall, NO door → ambiguous
      wall('bath-liv', 6, 0, 6, 3, ['door']),
      wall('entry', 6, 0, 10, 0, ['door']),
    ]
    const r = assertAdjacency(zones, walls, { a: '卧室', b: '卫生间', relation: 'ensuite' })
    expect(r.status).toBe('unsupported')
  })
})

describe('assertBounds', () => {
  const zones = [zone('a', '客厅', 0, 0, 5, 9), zone('b', '卧室', 0, 9, 5, 18)] // 5 wide, 18 deep
  test('pass on matching footprint', () => {
    expect(assertBounds(zones, { width: 5, depth: 18, tolerance: 0.1 }).status).toBe('pass')
  })
  test('pass with swapped orientation', () => {
    expect(assertBounds(zones, { width: 18, depth: 5, tolerance: 0.1 }).status).toBe('pass')
  })
  test('fail when footprint is wrong', () => {
    expect(assertBounds(zones, { width: 10, depth: 10, tolerance: 0.1 }).status).toBe('fail')
  })
})

describe('diffSnapshots + assertModification', () => {
  const before: SceneSnapshot = {
    zoneBed: { type: 'zone', name: '卧室' },
    zoneLiv: { type: 'zone', name: '客厅' },
    item1: { type: 'item', name: '沙发' },
    wallX: { type: 'wall' },
  }
  test('diff detects added / deleted / modified', () => {
    const after: SceneSnapshot = {
      zoneBed: { type: 'zone', name: '卧室' },
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' }, // added
      item1: { type: 'item', name: '沙发（移动后）' }, // modified
      // wallX deleted
    }
    const diff = diffSnapshots(before, after)
    expect(diff.added).toEqual(['zoneStudy'])
    expect(diff.modified).toContain('item1')
    expect(diff.deleted).toEqual(['wallX'])
    expect(diff.addedByType.zone).toBe(1)
  })

  test('modification passes when a study is added, connected, and nothing removed', () => {
    const afterZones = [zone('bed', '卧室', 0, 0, 4, 3), zone('liv', '客厅', 4, 0, 8, 3), zone('study', '书房', 8, 0, 11, 3)]
    const afterWalls = [wall('liv-study', 8, 0, 8, 3, ['door'])] // study connects to living via door
    const afterSnap: SceneSnapshot = {
      zoneBed: { type: 'zone', name: '卧室' },
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' },
      item1: { type: 'item', name: '沙发' },
    }
    const results = assertModification(before, afterSnap, { zones: afterZones, walls: afterWalls }, {
      addedRoomType: '书房',
      adjacentTo: '客厅',
      preserveRoomCounts: true,
      preserveFurniture: true,
    })
    const rollup = rollupAssertions(results)
    expect(rollup.failed).toBe(0)
    expect(rollup.unsupported).toBe(0)
    expect(rollup.allPassed).toBe(true)
  })

  test('modification fails when too many original walls are deleted', () => {
    const beforeWithWalls: SceneSnapshot = {
      zoneBed: { type: 'zone', name: '卧室' },
      zoneLiv: { type: 'zone', name: '客厅' },
      w1: { type: 'wall' },
      w2: { type: 'wall' },
      w3: { type: 'wall' },
      d1: { type: 'door' },
    }
    // After deletes 3 original walls (threshold is 2) → fail.
    const afterSnap: SceneSnapshot = {
      zoneBed: { type: 'zone', name: '卧室' },
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' },
      d1: { type: 'door' },
    }
    const afterZones = [zone('bed', '卧室', 0, 0, 4, 3), zone('liv', '客厅', 4, 0, 8, 3), zone('study', '书房', 8, 0, 11, 3)]
    const afterWalls = [wall('liv-study', 8, 0, 8, 3, ['door'])]
    const results = assertModification(beforeWithWalls, afterSnap, { zones: afterZones, walls: afterWalls }, {
      addedRoomType: '书房',
      maxDeletedOriginalWalls: 2,
    })
    const wallCheck = results.find(r => r.name === 'modification:deletedOriginalWalls')
    expect(wallCheck?.status).toBe('fail')
    expect(rollupAssertions(results).allPassed).toBe(false)
  })

  test('modification fails when an original door/window is deleted', () => {
    const beforeWithOpening: SceneSnapshot = {
      zoneLiv: { type: 'zone', name: '客厅' },
      d1: { type: 'door' },
      win1: { type: 'window' },
    }
    const afterSnap: SceneSnapshot = {
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' },
      d1: { type: 'door' },
      // win1 deleted
    }
    const afterZones = [zone('liv', '客厅', 0, 0, 4, 3), zone('study', '书房', 4, 0, 7, 3)]
    const afterWalls = [wall('liv-study', 4, 0, 4, 3, ['door'])]
    const results = assertModification(beforeWithOpening, afterSnap, { zones: afterZones, walls: afterWalls }, {
      addedRoomType: '书房',
      preserveOriginalOpenings: true,
    })
    const openingCheck = results.find(r => r.name === 'modification:preserveOpenings')
    expect(openingCheck?.status).toBe('fail')
  })

  test('a wall that only gained a door child does NOT count as a modified original wall', () => {
    // Case-13 semantics: hosting a necessary new door on an existing wall
    // changes wall.children but not the wall itself; the full-JSON diff used
    // to count this against maxModifiedOriginalWalls=0.
    const beforeSnap: SceneSnapshot = {
      zoneLiv: { type: 'zone', name: '客厅' },
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5, children: [] },
    }
    const afterSnap: SceneSnapshot = {
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' },
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5, children: ['dNew'] },
      dNew: { type: 'door' },
    }
    const afterZones = [zone('liv', '客厅', 0, 0, 4, 3), zone('study', '书房', 4, 0, 7, 3)]
    const afterWalls = [wall('liv-study', 4, 0, 4, 3, ['door'])]
    const results = assertModification(beforeSnap, afterSnap, { zones: afterZones, walls: afterWalls }, {
      maxModifiedOriginalWalls: 0,
    })
    const check = results.find(r => r.name === 'modification:modifiedOriginalWalls')
    expect(check?.status).toBe('pass')
  })

  test('a wall whose geometry moved DOES count as a modified original wall', () => {
    const beforeSnap: SceneSnapshot = {
      w1: { type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, height: 2.5, children: [] },
    }
    const afterSnap: SceneSnapshot = {
      w1: { type: 'wall', start: [0, 0], end: [3, 0], thickness: 0.2, height: 2.5, children: [] },
    }
    const results = assertModification(beforeSnap, afterSnap, { zones: [], walls: [] }, {
      maxModifiedOriginalWalls: 0,
    })
    const check = results.find(r => r.name === 'modification:modifiedOriginalWalls')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('w1')
  })

  test('a moved/re-hosted original window is caught by the opening-node check', () => {
    const beforeSnap: SceneSnapshot = {
      win1: { type: 'window', position: [1, 1.5, 0], width: 1.5, height: 1.5, parentId: 'w1' },
    }
    const movedSnap: SceneSnapshot = {
      win1: { type: 'window', position: [2.5, 1.5, 0], width: 1.5, height: 1.5, parentId: 'w1' },
    }
    const rehostedSnap: SceneSnapshot = {
      win1: { type: 'window', position: [1, 1.5, 0], width: 1.5, height: 1.5, parentId: 'w2' },
    }
    const unchangedSnap: SceneSnapshot = structuredClone(beforeSnap)
    const check = (after: SceneSnapshot) =>
      assertModification(beforeSnap, after, { zones: [], walls: [] }, { preserveOriginalOpenings: true })
        .find(r => r.name === 'modification:modifiedOriginalOpenings')
    expect(check(movedSnap)?.status).toBe('fail')
    expect(check(rehostedSnap)?.status).toBe('fail')
    expect(check(unchangedSnap)?.status).toBe('pass')
  })

  test('modification fails when original furniture was deleted', () => {
    const afterZones = [zone('bed', '卧室', 0, 0, 4, 3), zone('liv', '客厅', 4, 0, 8, 3), zone('study', '书房', 8, 0, 11, 3)]
    const afterWalls = [wall('liv-study', 8, 0, 8, 3, ['door'])]
    const afterSnap: SceneSnapshot = {
      zoneBed: { type: 'zone', name: '卧室' },
      zoneLiv: { type: 'zone', name: '客厅' },
      zoneStudy: { type: 'zone', name: '书房' },
      // item1 deleted
    }
    const results = assertModification(before, afterSnap, { zones: afterZones, walls: afterWalls }, {
      addedRoomType: '书房',
      preserveFurniture: true,
    })
    const furniture = results.find(r => r.name === 'modification:preserveFurniture')
    expect(furniture?.status).toBe('fail')
  })

  test('modification checks the newly added room area', () => {
    const beforeSnap: SceneSnapshot = {
      living: { type: 'zone', name: '客厅', polygon: [[0, 0], [8, 0], [8, 6], [0, 6]] },
    }
    const afterSnap: SceneSnapshot = {
      living: { type: 'zone', name: '客厅', polygon: [[0, 0], [7, 0], [7, 6], [0, 6]] },
      study: { type: 'zone', name: '书房', polygon: [[7, 0], [8, 0], [8, 6], [7, 6]] },
    }
    const results = assertModification(
      beforeSnap,
      afterSnap,
      {
        zones: [zone('living', '客厅', 0, 0, 7, 6), zone('study', '书房', 7, 0, 8, 6)],
        walls: [wall('partition', 7, 0, 7, 6, ['door'])],
      },
      { addedRoomType: '书房', addedRoomArea: { type: '书房', min: 6, max: 8 } },
    )
    expect(results.find(r => r.name === 'modification:addedRoomArea:书房')?.status).toBe('pass')
  })

  test('modification fails when the added room area is outside the configured range', () => {
    const beforeSnap: SceneSnapshot = {
      living: { type: 'zone', name: '客厅', polygon: [[0, 0], [8, 0], [8, 6], [0, 6]] },
    }
    const afterSnap: SceneSnapshot = {
      living: { type: 'zone', name: '客厅', polygon: [[0, 0], [6, 0], [6, 6], [0, 6]] },
      study: { type: 'zone', name: '书房', polygon: [[6, 0], [8, 0], [8, 6], [6, 6]] },
    }
    const results = assertModification(
      beforeSnap,
      afterSnap,
      { zones: [zone('living', '客厅', 0, 0, 6, 6), zone('study', '书房', 6, 0, 8, 6)], walls: [] },
      { addedRoomArea: { type: '书房', min: 6, max: 8 } },
    )
    expect(results.find(r => r.name === 'modification:addedRoomArea:书房')?.status).toBe('fail')
  })

  test('modification requires the exterior bounds to stay unchanged', () => {
    const beforeSnap: SceneSnapshot = {
      living: { type: 'zone', name: '客厅', polygon: [[0, 0], [8, 0], [8, 6], [0, 6]] },
    }
    const unchanged = assertModification(
      beforeSnap,
      beforeSnap,
      { zones: [zone('living', '客厅', 0, 0, 8, 6)], walls: [] },
      { preserveExteriorBounds: true },
    )
    expect(unchanged.find(r => r.name === 'modification:preserveExteriorBounds')?.status).toBe('pass')

    const expanded = assertModification(
      beforeSnap,
      beforeSnap,
      { zones: [zone('living', '客厅', 0, 0, 9, 6)], walls: [] },
      { preserveExteriorBounds: true },
    )
    expect(expanded.find(r => r.name === 'modification:preserveExteriorBounds')?.status).toBe('fail')
  })

  test('modification checks the target room area by type and name', () => {
    const afterZones = [
      zone('master', '主卧', 0, 0, 4, 4),
      zone('secondary', '次卧', 4, 0, 7, 3),
    ]
    const results = assertModification(
      {},
      {},
      { zones: afterZones, walls: [] },
      { targetRoomArea: { type: '卧室', min: 16, nameIncludes: ['主卧', 'master'] } },
    )
    expect(results.find(r => r.name === 'modification:targetRoomArea:卧室')?.status).toBe('pass')
  })

  test('modification fails when the named target room is still too small', () => {
    const results = assertModification(
      {},
      {},
      { zones: [zone('master', '主卧', 0, 0, 3, 4)], walls: [] },
      { targetRoomArea: { type: '卧室', min: 16, nameIncludes: ['主卧'] } },
    )
    expect(results.find(r => r.name === 'modification:targetRoomArea:卧室')?.status).toBe('fail')
  })
})

describe('批次 D: assertPlanFirstResult', () => {
  test('all gates passed + within budget + full placement → all pass', () => {
    const results = assertPlanFirstResult(
      { gateFailures: [], modelCallsUsed: 7, furniture: { placed: 10, required: 10 } },
      { maxModelCalls: 15 },
    )
    expect(results.map(r => [r.name, r.status])).toEqual([
      ['gatesPassed', 'pass'],
      ['modelCallBudget', 'pass'],
      ['furniturePlacementRate', 'pass'],
    ])
  })

  test('gate failures and budget overrun judge fail', () => {
    const results = assertPlanFirstResult(
      { gateFailures: ['卧室「主卧」缺少必备家具：床'], modelCallsUsed: 21, furniture: { placed: 8, required: 10 } },
      { maxModelCalls: 20 },
    )
    const byName = new Map(results.map(r => [r.name, r.status]))
    expect(byName.get('gatesPassed')).toBe('fail')
    expect(byName.get('modelCallBudget')).toBe('fail')
    // 8/10 = 80% < 90%
    expect(byName.get('furniturePlacementRate')).toBe('fail')
  })

  test('placement rate at exactly 90% passes', () => {
    const results = assertPlanFirstResult({ gateFailures: [], furniture: { placed: 9, required: 10 } })
    expect(results.find(r => r.name === 'furniturePlacementRate')?.status).toBe('pass')
  })

  test('missing fields are unsupported (blocks allPassed, never silently skipped)', () => {
    const results = assertPlanFirstResult({}, { maxModelCalls: 15 })
    expect(results.every(r => r.status === 'unsupported')).toBe(true)
    expect(rollupAssertions(results).allPassed).toBe(false)
  })

  test('budget assertion only appears when the case declares a limit', () => {
    const results = assertPlanFirstResult({ gateFailures: [], furniture: { placed: 1, required: 1 } })
    expect(results.some(r => r.name === 'modelCallBudget')).toBe(false)
  })
})
