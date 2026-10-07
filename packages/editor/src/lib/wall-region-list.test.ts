import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type SceneMaterial,
  type SceneMaterialId,
  WALL_FACE_REGION_LIMIT,
  type WallFaceRegion,
  WallNode,
} from '@pascal-app/core'
import {
  describeRegionFinish,
  formatRegionBounds,
  wallRegionCapNotice,
  wallRegionFaceLabels,
  wallRegionRows,
} from './wall-region-list'

const LEVEL = 'level_region-list'
const SCENE_ID = 'scene-material_region-list' as SceneMaterialId
const materials = {
  [SCENE_ID]: {
    id: SCENE_ID,
    name: 'Sage green',
    material: { properties: { color: '#8fa98a' } },
  } as SceneMaterial,
}

function wall(id: string, start: [number, number], end: [number, number]) {
  return WallNode.parse({ id, parentId: LEVEL, start, end })
}

function nodesOf(walls: WallNode[]) {
  return Object.fromEntries(walls.map((node) => [node.id, node])) as Record<string, AnyNode>
}

describe('bounds text', () => {
  test('reads each axis in the viewer unit; absent bounds run to the edge', () => {
    expect(formatRegionBounds({ v1: 0.9 }, 'metric')).toBe('0–0.90 m high')
    expect(formatRegionBounds({ u0: 1.2, u1: 2.4 }, 'metric')).toBe('1.20–2.40 m along')
    expect(formatRegionBounds({ u0: 1.2, u1: 2.4, v0: 0.9, v1: 2.1 }, 'metric')).toBe(
      '1.20–2.40 m along, 0.90–2.10 m high',
    )
    expect(formatRegionBounds({ v0: 0.9 }, 'metric')).toBe('Above 0.90 m')
    expect(formatRegionBounds({ u0: 1.5 }, 'metric')).toBe('From 1.50 m along')
    expect(formatRegionBounds({}, 'metric')).toBe('Whole face')
  })

  test('imperial converts to feet', () => {
    expect(formatRegionBounds({ v1: 0.9144 }, 'imperial')).toBe('0–3.00 ft high')
  })
})

describe('face labels', () => {
  test('a lone wall reads Face A / Face B', () => {
    const lone = wall('wall_lone', [0, 0], [4, 0])
    expect(wallRegionFaceLabels(nodesOf([lone]), lone.id)).toEqual({ a: 'Face A', b: 'Face B' })
    expect(wallRegionFaceLabels({}, 'wall_missing')).toEqual({ a: 'Face A', b: 'Face B' })
  })

  test('a room wall names its inside and outside faces', () => {
    const walls = [
      wall('wall_s', [0, 0], [4, 0]),
      wall('wall_e', [4, 0], [4, 3]),
      wall('wall_n', [4, 3], [0, 3]),
      wall('wall_w', [0, 3], [0, 0]),
    ]
    const labels = wallRegionFaceLabels(nodesOf(walls), 'wall_s')
    expect(new Set(Object.values(labels))).toEqual(new Set(['Inside', 'Outside']))
    // Drawn counter-clockwise, the room sits on the left: face a.
    expect(labels.a).toBe('Inside')
  })
})

describe('finish', () => {
  test('a scene material shows its name and colour', () => {
    expect(describeRegionFinish(`scene:${SCENE_ID}`, materials)).toEqual({
      name: 'Sage green',
      color: '#8fa98a',
    })
  })

  test('unknown refs fall back to a neutral swatch', () => {
    expect(describeRegionFinish('scene:missing', {}).name).toBe('Custom finish')
    expect(describeRegionFinish('not-a-ref', {}).name).toBe('Custom finish')
    expect(describeRegionFinish('library:no-such-material', {}).name).toBe('Library finish')
  })
})

describe('rows', () => {
  test('one row per region, face a first, with label, finish and bounds', () => {
    const faceRegions: WallFaceRegion[] = [
      { id: 'r1', face: 'b', v1: 0.9, finish: `scene:${SCENE_ID}` },
      { id: 'r2', face: 'a', u0: 1.2, u1: 2.4, finish: `scene:${SCENE_ID}` },
    ]
    const rows = wallRegionRows({ faceRegions }, { a: 'Inside', b: 'Outside' }, materials, 'metric')
    expect(rows.map(({ id, faceLabel, boundsText }) => ({ id, faceLabel, boundsText }))).toEqual([
      { id: 'r2', faceLabel: 'Inside', boundsText: '1.20–2.40 m along' },
      { id: 'r1', faceLabel: 'Outside', boundsText: '0–0.90 m high' },
    ])
    expect(rows[0]!.finish.name).toBe('Sage green')
  })

  test('the cap notice appears only when a face is full', () => {
    const full = (face: 'a' | 'b') =>
      Array.from({ length: WALL_FACE_REGION_LIMIT }, (_, index) => ({
        id: `${face}${index}`,
        face,
        finish: 'x',
      }))
    const labels = { a: 'Face A', b: 'Face B' }
    expect(wallRegionCapNotice({ faceRegions: full('a').slice(1) }, labels)).toBeNull()
    expect(wallRegionCapNotice({ faceRegions: full('b') }, labels)).toBe(
      `Face B is full: up to ${WALL_FACE_REGION_LIMIT} regions per face`,
    )
    expect(wallRegionCapNotice({ faceRegions: [...full('a'), ...full('b')] }, labels)).toBe(
      `Up to ${WALL_FACE_REGION_LIMIT} regions per face`,
    )
  })
})
