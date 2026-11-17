// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import {
  assignColours,
  buildLegend,
  decodeIdReadback,
  type IdBuffer,
  type IdEntry,
  labelAnchors,
  segmentationPixels,
  visibleShares,
  worldAt,
  zoneShares,
} from '@pascal-app/viewer'

// Analytical readbacks exercise decoding/accounting, not GPU visibility. A listed entry with
// no pixels must never become visible; independently counted samples fix all expected shares.
// Real rasterization, opening silhouettes and backend evidence live in the browser fixture.
const entries: IdEntry[] = [
  { index: 0, kind: 'background' },
  { index: 1, kind: 'ground' },
  { index: 2, kind: 'node', nodeId: 'wall_front', nodeType: 'wall' },
  { index: 3, kind: 'node', nodeId: 'wall_back', nodeType: 'wall' },
  { index: 7, kind: 'glass', nodeId: 'window_north', nodeType: 'window' },
]

function buffer(width: number, ids: number[]): IdBuffer {
  return {
    width,
    height: ids.length / width,
    ids: Uint32Array.from(ids),
    world: new Float32Array(ids.length * 3).fill(Number.NaN),
    entries,
  }
}

describe('id readback coordinates', () => {
  // Two unequal rows and a width not aligned to 256 bytes catch inversion and padding mistakes.
  const top = [2, 11, 12, 13, 7, 21, 22, 23, 0, 0, 0, 0]
  const bottom = [1, 31, 32, 33, 3, 41, 42, 43, 2, 51, 52, 53]

  test('tight WebGPU, padded WebGPU and bottom-up WebGL2 decode the same pixels', () => {
    const padded = new Float32Array(128).fill(-999)
    padded.set(top, 0)
    padded.set(bottom, 64)
    const cases = [
      { raw: Float32Array.from([...top, ...bottom]), topDown: true },
      { raw: padded, topDown: true },
      { raw: Float32Array.from([...bottom, ...top]), topDown: false },
    ]
    for (const { raw, topDown } of cases) {
      const result = decodeIdReadback(raw, 3, 2, topDown, entries)
      expect(Array.from(result.ids)).toEqual([2, 7, 0, 1, 3, 2])
      expect(worldAt(result, 0, 0)).toEqual([11, 12, 13])
      expect(worldAt(result, 2, 1)).toEqual([51, 52, 53])
      expect(worldAt(result, 2, 0)).toBeNull()
      expect(worldAt(result, -1, 0)).toBeNull()
      expect(worldAt(result, 3, 1)).toBeNull()
    }
  })
})

describe('visible pixel accounting', () => {
  test('open ground and sky have no associated nodes and exhaust the region', () => {
    const shares = visibleShares(buffer(4, [0, 0, 0, 0, 1, 1, 1, 1]))
    expect(shares.map(({ kind, share }) => ({ kind, share }))).toEqual([
      { kind: 'background', share: 0.5 },
      { kind: 'ground', share: 0.5 },
    ])
    expect(shares.every((share) => !share.nodeId)).toBe(true)
    expect(shares.reduce((sum, share) => sum + share.share, 0)).toBe(1)
  })

  test('only pixels inside the unpadded region contribute; absent entries stay absent', () => {
    const result = visibleShares(buffer(4, [3, 2, 2, 3, 3, 2, 0, 3]), {
      x0: 1,
      y0: 0,
      x1: 3,
      y1: 2,
    })
    expect(
      result.map(({ nodeId, kind, pixels, share }) => ({ nodeId, kind, pixels, share })),
    ).toEqual([
      { nodeId: 'wall_front', kind: 'node', pixels: 3, share: 0.75 },
      { nodeId: undefined, kind: 'background', pixels: 1, share: 0.25 },
    ])
    expect(result.some((share) => share.nodeId === 'wall_back')).toBe(false)
  })

  test('glass retains the opening identity rather than becoming an anonymous surface', () => {
    const shares = visibleShares(buffer(2, [7, 7, 2, 0]))
    expect(shares[0]).toMatchObject({ kind: 'glass', nodeId: 'window_north', share: 0.5 })
    expect(shares.reduce((sum, share) => sum + share.share, 0)).toBe(1)
  })

  test('an unmapped drawn pixel is reported as unknown, never silently dropped', () => {
    const shares = visibleShares(buffer(2, [2, 999]))
    expect(shares.find((share) => share.kind === 'unknown')).toMatchObject({
      index: 999,
      pixels: 1,
      share: 0.5,
    })
    expect(shares.reduce((sum, share) => sum + share.share, 0)).toBe(1)
  })
})

describe('segmentation legend', () => {
  test('numbers follow visible share order, not encoded ids, and anchors identify those pixels', () => {
    const image = buffer(4, [7, 7, 7, 7, 7, 7, 2, 2, 2, 2, 1, 1])
    const shares = visibleShares(image)
    const colours = assignColours(shares)
    const anchors = labelAnchors(image)
    const legend = buildLegend(image, shares, colours, (share) => share.nodeId ?? '', anchors)

    expect(legend.map(({ n, kind, nodeId, percent }) => ({ n, kind, nodeId, percent }))).toEqual([
      { n: 1, kind: 'glass', nodeId: 'window_north', percent: 50 },
      { n: 2, kind: 'node', nodeId: 'wall_front', percent: 33.3 },
      { n: 3, kind: 'ground', nodeId: undefined, percent: 16.7 },
    ])
    expect(legend[0]?.label).toContain('window_north')
    for (const [i, share] of shares.entries()) {
      const anchor = anchors.get(share.index)!
      expect(image.ids[anchor.y * image.width + anchor.x]).toBe(share.index)
      expect(legend[i]?.colour).toBe(colours.get(share.index)?.hex)
    }
  })

  test('tint blends the crop with the labelled colour, without changing alpha or row order', () => {
    const image = buffer(2, [2, 7])
    const colours = new Map([
      [2, { name: 'red', hex: '#c80000', rgb: [200, 0, 0] as [number, number, number] }],
      [7, { name: 'blue', hex: '#0000c8', rgb: [0, 0, 200] as [number, number, number] }],
    ])
    const crop = Uint8ClampedArray.from([100, 100, 100, 255, 80, 80, 80, 255])
    expect(
      Array.from(segmentationPixels(image, colours, { crop, tint: 0.5, outline: false })),
    ).toEqual([150, 50, 50, 255, 40, 40, 140, 255])
    expect(Array.from(crop)).toEqual([100, 100, 100, 255, 80, 80, 80, 255])
  })
})

test('room shares use world position and height, not a room screen box', () => {
  const image = buffer(2, [2, 2, 2, 0])
  image.world.set([11, 1, 21, 11, 4, 21, 20, 1, 21, Number.NaN, Number.NaN, Number.NaN])
  const rooms = zoneShares(
    image,
    [
      {
        id: 'zone_room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        worldToLevel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -10, 0, -20, 1],
        yMin: 0,
        yMax: 3,
      },
    ],
    undefined,
    1,
  )

  // One of four pixels is inside: the others are above the ceiling, outside, and sky.
  expect(rooms).toEqual([{ id: 'zone_room', share: 0.25 }])
})
