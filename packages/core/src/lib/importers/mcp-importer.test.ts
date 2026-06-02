import { describe, expect, test } from 'bun:test'
import type { CoordsJSON } from './dxf-geometry-parser'
import type { MergeResult } from './dxf-merge-engine'
import { type SceneOps, importDxfScene } from './mcp-importer'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal CoordsJSON for a 10 m × 8 m room. */
const COORDS: CoordsJSON = {
  unit: 'm',
  bbox: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
  walls: [],
  openings: [],
  closedRegions: [],
  confidence: 0.9,
  warnings: [],
}

/** Minimal valid MergeResult: two walls, one door, one zone. */
function makeMergeResult(overrides: Partial<MergeResult> = {}): MergeResult {
  return {
    walls: [
      {
        kind: 'wall',
        id: 'w_001',
        start: [0, 0.1],
        end: [10, 0.1],
        thickness: 0.2,
        height: 2.8,
        wallType: 'exterior',
        layerName: 'WALL',
        needsReview: false,
      },
      {
        kind: 'wall',
        id: 'w_002',
        start: [0.1, 0],
        end: [0.1, 8],
        thickness: 0.2,
        height: 2.8,
        wallType: 'load_bearing',
        // layerName intentionally omitted to test absence in metadata
        needsReview: true,
        importWarning: 'position_mismatch',
      },
    ],
    openings: [
      {
        kind: 'door',
        id: 'o_001',
        wallId: 'w_001',
        positionAlongWall: 0.3,
        width: 0.9,
        height: 2.1,
        confidence: 0.85,
        source: 'channel_a',
      },
      {
        kind: 'window',
        id: 'o_002',
        wallId: 'w_001',
        positionAlongWall: 0.7,
        width: 1.2,
        height: 1.2,
        confidence: 0.8,
        source: 'channel_b',
      },
    ],
    zones: [
      {
        kind: 'zone',
        id: 'z_001',
        polygon: [
          [0.1, 0.1],
          [9.9, 0.1],
          [9.9, 7.9],
          [0.1, 7.9],
        ],
        name: '客厅',
        approxAreaM2: 60,
      },
    ],
    warnings: ['来自合并的警告'],
    ...overrides,
  }
}

/** Mock SceneOps that records calls and returns predictable ids. */
function mockOps(opts: {
  throwOnCall?: number // throw CONFLICT on this createNode call (1-based)
  alwaysThrow?: boolean
} = {}): {
  ops: SceneOps
  calls: Array<{ nodeType: string; parentId: string | undefined }>
  reloadCount: number
} {
  let callN = 0
  let reloadCount = 0
  const calls: Array<{ nodeType: string; parentId: string | undefined }> = []

  const ops: SceneOps = {
    createNode(node, parentId) {
      callN++
      calls.push({ nodeType: node.type, parentId })
      const shouldThrow = opts.alwaysThrow || callN === opts.throwOnCall
      if (shouldThrow) throw new Error('live_sync_version_conflict')
      return `${node.type}-${callN}`
    },
    async reloadScene() {
      reloadCount++
      return true
    },
  }
  return { ops, calls, get reloadCount() { return reloadCount } }
}

// ─── Write order ──────────────────────────────────────────────────────────────

describe('importDxfScene — write order', () => {
  test('creates building before level', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const types = calls.map(c => c.nodeType)
    expect(types.indexOf('building')).toBeLessThan(types.indexOf('level'))
  })

  test('creates level before walls', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const types = calls.map(c => c.nodeType)
    const firstWall = types.indexOf('wall')
    expect(types.indexOf('level')).toBeLessThan(firstWall)
  })

  test('creates all walls before any door', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const types = calls.map(c => c.nodeType)
    const lastWall = types.lastIndexOf('wall')
    const firstDoor = types.indexOf('door')
    expect(lastWall).toBeLessThan(firstDoor)
  })

  test('creates doors before windows', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const types = calls.map(c => c.nodeType)
    expect(types.indexOf('door')).toBeLessThan(types.indexOf('window'))
  })

  test('creates openings before zones', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const types = calls.map(c => c.nodeType)
    const lastOpening = Math.max(types.lastIndexOf('door'), types.lastIndexOf('window'))
    expect(lastOpening).toBeLessThan(types.indexOf('zone'))
  })

  test('creates guide after zones when URL provided', async () => {
    const { ops, calls } = mockOps()
    await importDxfScene(makeMergeResult(), COORDS, ops, {
      guideImageUrl: 'https://example.com/dxf.png',
    })
    const types = calls.map(c => c.nodeType)
    expect(types.indexOf('zone')).toBeLessThan(types.indexOf('guide'))
  })
})

// ─── Node parentage ───────────────────────────────────────────────────────────

describe('importDxfScene — node parentage', () => {
  test('level is a child of building', async () => {
    const { ops, calls } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    const levelCall = calls.find(c => c.nodeType === 'level')!
    expect(levelCall.parentId).toBe(result.buildingId)
  })

  test('walls are children of level', async () => {
    const { ops, calls } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    const wallCalls = calls.filter(c => c.nodeType === 'wall')
    for (const wc of wallCalls) expect(wc.parentId).toBe(result.levelId)
  })

  test('door is a child of the referenced wall', async () => {
    const { ops, calls } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    const doorCall = calls.find(c => c.nodeType === 'door')!
    expect(doorCall.parentId).toBe(result.wallIds['w_001'])
  })

  test('window is a child of the referenced wall', async () => {
    const { ops, calls } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    const windowCall = calls.find(c => c.nodeType === 'window')!
    expect(windowCall.parentId).toBe(result.wallIds['w_001'])
  })

  test('zone is a child of level', async () => {
    const { ops, calls } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    const zoneCall = calls.find(c => c.nodeType === 'zone')!
    expect(zoneCall.parentId).toBe(result.levelId)
  })
})

// ─── Return value ─────────────────────────────────────────────────────────────

describe('importDxfScene — return value', () => {
  test('buildingId and levelId are non-empty strings', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.buildingId).toBeTruthy()
    expect(result.levelId).toBeTruthy()
  })

  test('wallIds maps merge ids to scene ids', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.wallIds['w_001']).toBeTruthy()
    expect(result.wallIds['w_002']).toBeTruthy()
    // Scene ids must differ from merge ids
    expect(result.wallIds['w_001']).not.toBe('w_001')
  })

  test('openingIds maps merge ids to scene ids', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.openingIds['o_001']).toBeTruthy()
    expect(result.openingIds['o_002']).toBeTruthy()
  })

  test('zoneIds maps merge ids to scene ids', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.zoneIds['z_001']).toBeTruthy()
  })

  test('guideId is undefined when no guideImageUrl', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.guideId).toBeUndefined()
  })

  test('guideId is set when guideImageUrl is provided', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops, {
      guideImageUrl: 'https://example.com/dxf.png',
    })
    expect(result.guideId).toBeTruthy()
  })
})

// ─── Wall metadata ────────────────────────────────────────────────────────────

describe('importDxfScene — wall metadata', () => {
  test('importSource is "dxf" on every wall', async () => {
    const seenWalls: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _parentId) {
        if (node.type === 'wall') seenWalls.push(node)
        return `${node.type}-${seenWalls.length}`
      },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    for (const w of seenWalls as Array<{ metadata: Record<string, unknown> }>) {
      expect(w.metadata?.importSource).toBe('dxf')
    }
  })

  test('wallType is preserved from MergeResult', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'wall') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const walls = seen as Array<{ metadata: Record<string, unknown> }>
    expect(walls[0]!.metadata.wallType).toBe('exterior')
    // w_002 has wallType: 'load_bearing'
    expect(walls[1]!.metadata.wallType).toBe('load_bearing')
  })

  test('needsReview=true is preserved', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'wall') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const walls = seen as Array<{ metadata: Record<string, unknown> }>
    expect(walls[1]!.metadata.needsReview).toBe(true)
    expect(walls[1]!.metadata.importWarning).toBe('position_mismatch')
  })

  test('layerName is present when set, absent when null', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'wall') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const walls = seen as Array<{ metadata: Record<string, unknown> }>
    expect(walls[0]!.metadata.layerName).toBe('WALL')
    expect(walls[1]!.metadata.layerName).toBeUndefined() // layerName was null
  })
})

// ─── Opening positioning ──────────────────────────────────────────────────────

describe('importDxfScene — opening positioning', () => {
  test('door position[1] = height / 2', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'door') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const door = seen[0] as { position: [number, number, number]; height: number }
    expect(door.position[1]).toBeCloseTo(door.height / 2, 3)
  })

  test('window sill is at 0.9 m — position[1] = 0.9 + height / 2', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'window') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const win = seen[0] as { position: [number, number, number]; height: number }
    expect(win.position[1]).toBeCloseTo(0.9 + win.height / 2, 3)
  })

  test('door localX is clamped: opening fits within wall length', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { if (node.type === 'door') seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    // Wall w_001: length = 10 m, door width = 0.9 m, t = 0.3 → localX = 3.0 m
    await importDxfScene(makeMergeResult(), COORDS, ops)
    const door = seen[0] as { position: [number, number, number]; width: number }
    expect(door.position[0]).toBeGreaterThanOrEqual(door.width / 2)
  })
})

// ─── Version-conflict retry ───────────────────────────────────────────────────

describe('importDxfScene — version conflict retry', () => {
  test('reloads scene and retries on first conflict', async () => {
    // Throw conflict on the 1st createNode call (building), succeed on 2nd attempt
    let callN = 0
    let reloads = 0
    const ops: SceneOps = {
      createNode(node) {
        callN++
        if (callN === 1) throw new Error('live_sync_version_conflict')
        return `${node.type}-${callN}`
      },
      async reloadScene() { reloads++; return true },
    }
    const result = await importDxfScene(makeMergeResult(), COORDS, ops, { sceneId: 'scene-1' })
    expect(result.buildingId).toBeTruthy()
    expect(reloads).toBe(1)
  })

  test('reloadScene receives the correct sceneId', async () => {
    let capturedId = ''
    let callN = 0
    const ops: SceneOps = {
      createNode(node) {
        callN++
        if (callN === 1) throw new Error('live_sync_version_conflict')
        return `${node.type}-${callN}`
      },
      async reloadScene(id) { capturedId = id; return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops, { sceneId: 'my-scene-42' })
    expect(capturedId).toBe('my-scene-42')
  })

  test('throws user-readable message after 3 retries are exhausted', async () => {
    const { ops } = mockOps({ alwaysThrow: true })
    await expect(
      importDxfScene(makeMergeResult(), COORDS, ops, { sceneId: 'x' }),
    ).rejects.toThrow('导入冲突，请刷新页面后重试')
  })

  test('non-conflict errors are rethrown immediately without retry', async () => {
    let reloads = 0
    const ops: SceneOps = {
      createNode() { throw new Error('schema_validation_failed') },
      async reloadScene() { reloads++; return true },
    }
    await expect(importDxfScene(makeMergeResult(), COORDS, ops)).rejects.toThrow(
      'schema_validation_failed',
    )
    expect(reloads).toBe(0)
  })
})

// ─── Edge cases & warnings ────────────────────────────────────────────────────

describe('importDxfScene — edge cases', () => {
  test('MergeResult warnings are propagated to ImportResult', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(makeMergeResult(), COORDS, ops)
    expect(result.warnings).toContain('来自合并的警告')
  })

  test('opening with unknown wallId emits a warning and is skipped', async () => {
    const { ops } = mockOps()
    const merge = makeMergeResult({
      openings: [
        {
          kind: 'door',
          id: 'o_bad',
          wallId: 'w_does_not_exist',
          positionAlongWall: 0.5,
          width: 0.9,
          height: 2.1,
          confidence: 0.8,
          source: 'channel_a',
        },
      ],
    })
    const result = await importDxfScene(merge, COORDS, ops)
    expect(result.openingIds['o_bad']).toBeUndefined()
    expect(result.warnings.some(w => w.includes('o_bad'))).toBe(true)
  })

  test('unresolved opening emits warning and is skipped', async () => {
    const { ops } = mockOps()
    const merge = makeMergeResult({
      openings: [
        {
          kind: 'unresolved',
          id: 'o_unresolved',
          wallId: 'w_001',
          positionAlongWall: 0.5,
          width: 0.9,
          height: 2.1,
          confidence: 0.4,
          source: 'channel_b',
        },
      ],
    })
    const result = await importDxfScene(merge, COORDS, ops)
    expect(result.openingIds['o_unresolved']).toBeUndefined()
    expect(result.warnings.some(w => w.includes('unresolved'))).toBe(true)
  })

  test('zone with fewer than 3 vertices is skipped with a warning', async () => {
    const { ops } = mockOps()
    const merge = makeMergeResult({
      zones: [
        { kind: 'zone', id: 'z_bad', polygon: [[0, 0], [1, 0]], name: undefined },
      ],
    })
    const result = await importDxfScene(merge, COORDS, ops)
    expect(result.zoneIds['z_bad']).toBeUndefined()
    expect(result.warnings.some(w => w.includes('z_bad'))).toBe(true)
  })

  test('empty walls/openings/zones produce empty id maps', async () => {
    const { ops } = mockOps()
    const result = await importDxfScene(
      makeMergeResult({ walls: [], openings: [], zones: [] }),
      COORDS,
      ops,
    )
    expect(Object.keys(result.wallIds)).toHaveLength(0)
    expect(Object.keys(result.openingIds)).toHaveLength(0)
    expect(Object.keys(result.zoneIds)).toHaveLength(0)
  })

  test('levelLabel option is used as the level metadata label', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops, { levelLabel: '一楼' })
    const level = (seen as Array<{ type: string; metadata?: Record<string, unknown> }>).find(
      n => n.type === 'level',
    )
    expect(level?.metadata?.label).toBe('一楼')
  })

  test('guide scaleReference uses bbox width as realLengthMeters', async () => {
    const seen: unknown[] = []
    const ops: SceneOps = {
      createNode(node, _) { seen.push(node); return `n-${seen.length}` },
      async reloadScene() { return true },
    }
    await importDxfScene(makeMergeResult(), COORDS, ops, {
      guideImageUrl: 'https://example.com/dxf.png',
    })
    const guide = (seen as Array<{ type: string; scaleReference?: { realLengthMeters: number } }>).find(
      n => n.type === 'guide',
    )
    // COORDS bbox width = 10 m
    expect(guide?.scaleReference?.realLengthMeters).toBe(10)
  })
})
