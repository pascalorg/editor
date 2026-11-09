import { describe, expect, test } from 'bun:test'
import type { AnyNode, PointContext } from '@pascal-app/core'
import { house, LEVEL_ID } from './__fixtures__/house'
import { type BuildPointContextInput, buildPointContext } from './build-context'

// What the agent receives when the person points (spec section 5): ids first, in metres, the camera
// the person saw. Written first: an id the agent cannot read back; a size in the viewer's unit
// instead of metres; a target dropped past a preview limit; an orthographic camera with no width, a
// perspective one with a stray one; fields present as `undefined` where there is nothing to say.

const CAMERA = {
  position: [6.2, 4.1, 7.5] as [number, number, number],
  target: [2, 1, 1.5] as [number, number, number],
  fov: 50,
  aspect: 1.6,
  projection: 'perspective' as const,
}

const nodes = house()
const when = new Date('2026-10-08T01:02:03.000Z')

const build = (over: Partial<BuildPointContextInput> = {}): PointContext =>
  buildPointContext({
    askId: 'ask_1',
    capturedAt: when,
    gesture: 'click',
    nodes,
    levelId: LEVEL_ID,
    camera: CAMERA,
    targets: [{ id: 'zone_kitchen' }],
    ...over,
  })

describe('the context of a click on a room', () => {
  const context = build()

  test('names itself, its ask, its moment and its surface', () => {
    expect(context).toMatchObject({
      kind: 'scene-point',
      version: 1,
      askId: 'ask_1',
      capturedAt: '2026-10-08T01:02:03.000Z',
      source: 'editor',
      gesture: 'click',
      level: { id: 'level_0', name: 'Level 0' },
    })
  })

  test('carries the room by id, with its name, level, size in metres and box', () => {
    const [kitchen] = context.targets

    expect(kitchen).toMatchObject({
      id: 'zone_kitchen',
      type: 'zone',
      name: 'Kitchen',
      levelId: 'level_0',
      size: { area: 12, width: 4, depth: 3 },
    })
    expect(kitchen!.box.min[0]).toBeCloseTo(0, 6)
    expect(kitchen!.box.max[0]).toBeCloseTo(4, 6)
    expect(kitchen!.box.min[2]).toBeCloseTo(0, 6)
    expect(kitchen!.box.max[2]).toBeCloseTo(3, 6)
    expect(kitchen!.box.max[1]).toBeGreaterThan(kitchen!.box.min[1])
  })

  test('the camera is the one the person saw, as view_scene takes it', () => {
    expect(context.camera).toEqual(CAMERA)
    expect('viewWidth' in context.camera).toBe(false)
  })

  test('says nothing it has nothing to say about', () => {
    for (const key of ['inRegion', 'region', 'image', 'suggestion'])
      expect(key in context, key).toBe(false)
    expect('hit' in context.targets[0]!).toBe(false)
  })
})

describe('targets', () => {
  test('a window: its wall as parent, its room, the finger’s hit, its sill', () => {
    const hit = {
      point: [2, 1.4, 0] as [number, number, number],
      normal: [0, 0, -1] as [number, number, number],
      face: 'exterior' as const,
    }
    const [window] = build({ targets: [{ id: 'window_north', hit }] }).targets

    expect(window).toMatchObject({
      id: 'window_north',
      type: 'window',
      name: 'Window',
      parentId: 'wall_north',
      zoneId: 'zone_kitchen',
      hit,
    })
    expect(window!.size.sill).toBeCloseTo(0.7, 6)
  })

  test('a wall and an item', () => {
    const [wall, sofa] = build({ targets: [{ id: 'wall_north' }, { id: 'item_sofa' }] }).targets

    expect(wall).toMatchObject({ type: 'wall', zoneId: 'zone_kitchen' })
    expect(wall!.size.length).toBeCloseTo(4, 6)
    expect(sofa).toMatchObject({ type: 'item', name: 'Sofa' })
    expect(sofa!.size).toEqual({ width: 2.1, depth: 0.95, height: 0.85 })
  })

  test('the viewer’s unit never reaches the context: sizes are metres', () => {
    const [window] = build({ targets: [{ id: 'window_north' }] }).targets

    expect(window!.size.width).toBeCloseTo(1.2, 6)
  })

  test('a dozen and more all arrive, each by its own id (no preview limit)', () => {
    const extra: AnyNode[] = Array.from(
      { length: 14 },
      (_, i) =>
        ({
          ...(nodes.item_sofa as object),
          id: `item_chair_${i}`,
          name: 'Chair',
        }) as unknown as AnyNode,
    )
    const scene = house(extra)
    const context = build({
      nodes: scene,
      gesture: 'multi',
      targets: extra.map((node) => ({ id: node.id })),
    })

    expect(context.targets).toHaveLength(14)
    expect(new Set(context.targets.map((t) => t.id)).size).toBe(14)
    expect(context.targets.every((t) => t.name === 'Chair')).toBe(true)
  })

  test('an element that is gone is left out, never guessed', () => {
    const context = build({ targets: [{ id: 'zone_kitchen' }, { id: 'wall_gone' }] })

    expect(context.targets.map((t) => t.id)).toEqual(['zone_kitchen'])
  })
})

describe('the camera and the picture', () => {
  test('an orthographic camera carries its view width, a perspective one does not', () => {
    const ortho = build({ camera: { ...CAMERA, projection: 'orthographic', viewWidth: 14 } })

    expect(ortho.camera).toMatchObject({ projection: 'orthographic', viewWidth: 14 })
    expect('viewWidth' in build({ camera: { ...CAMERA, viewWidth: 14 } }).camera).toBe(false)
  })

  test('a region is a view, not a selection: its ids ride beside empty targets', () => {
    const context = build({
      gesture: 'region',
      targets: [],
      region: [0.2, 0.3, 0.6, 0.8],
      inRegion: { ids: ['wall_north', 'window_north'], more: 3 },
    })

    expect(context).toMatchObject({
      gesture: 'region',
      targets: [],
      region: [0.2, 0.3, 0.6, 0.8],
      inRegion: { ids: ['wall_north', 'window_north'], more: 3 },
    })
  })

  test('the crop and the suggestion pass through as given', () => {
    const image = { dataUrl: 'data:image/png;base64,AAAA', width: 640, height: 480, marked: true }
    const context = build({ image, suggestion: 'make-it-wider' })

    expect(context.image).toEqual(image)
    expect(context.suggestion).toBe('make-it-wider')
  })
})
