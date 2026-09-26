import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Vector2 } from 'three'
import { CanvasTarget, type WebGPURenderer } from 'three/webgpu'
import { useViewer } from '@pascal-app/viewer'
import { atCaptureSize, presentFinished, pumpFrames, tileGrid } from './thumbnail-generator'

type FakeCanvas = { width: number; height: number; style: Record<string, string> }

const realDocument = (globalThis as { document?: unknown }).document

beforeEach(() => {
  ;(globalThis as { document?: unknown }).document = {
    createElement: (): FakeCanvas => ({ width: 0, height: 0, style: {} }),
  }
})

afterEach(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
})

/** The part of three's renderer a capture's passes size themselves from. */
function fakeRenderer(canvas: FakeCanvas, pixelRatio: number) {
  const [cssWidth, cssHeight] = [canvas.width / pixelRatio, canvas.height / pixelRatio]
  let target = new CanvasTarget(canvas as unknown as HTMLCanvasElement)
  target.setPixelRatio(pixelRatio)
  target.setSize(cssWidth, cssHeight, false)
  const renderer = {
    getCanvasTarget: () => target,
    setCanvasTarget: (next: CanvasTarget) => {
      target = next
    },
    getDrawingBufferSize: (v: Vector2) => target.getDrawingBufferSize(v),
    get domElement() {
      return target.domElement
    },
  }
  return renderer as unknown as WebGPURenderer & typeof renderer
}

describe('supersampled capture', () => {
  test('renders at its own size while the live canvas keeps its size', () => {
    // a 1.5 dpr screen: the old capture resized the live canvas with drawing
    // buffer pixels where CSS pixels were due — 3× during the capture, 1.5×
    // after it, compounding capture after capture
    const live: FakeCanvas = { width: 1156, height: 791, style: {} }
    const renderer = fakeRenderer(live, 1.5)
    const liveTarget = renderer.getCanvasTarget()

    const seen = atCaptureSize(renderer, 2312, 1582, () => {
      expect(live.width).toBe(1156)
      expect(live.height).toBe(791)
      return {
        buffer: renderer.getDrawingBufferSize(new Vector2()).toArray(),
        canvas: [renderer.domElement.width, renderer.domElement.height],
      }
    })

    expect(seen.buffer).toEqual([2312, 1582])
    expect(seen.canvas).toEqual([2312, 1582])
    expect(renderer.getCanvasTarget()).toBe(liveTarget)
    expect([live.width, live.height]).toEqual([1156, 791])
    expect(renderer.getDrawingBufferSize(new Vector2()).toArray()).toEqual([1156, 791])
  })

  test('puts the live canvas target back when the render throws', () => {
    const live: FakeCanvas = { width: 800, height: 600, style: {} }
    const renderer = fakeRenderer(live, 1)
    const liveTarget = renderer.getCanvasTarget()
    expect(() =>
      atCaptureSize(renderer, 1600, 1200, () => {
        throw new Error('pipeline failed')
      }),
    ).toThrow('pipeline failed')
    expect(renderer.getCanvasTarget()).toBe(liveTarget)
    expect([live.width, live.height]).toEqual([800, 600])
  })

  test('a capture at the canvas size renders through the live target', () => {
    const live: FakeCanvas = { width: 800, height: 600, style: {} }
    const renderer = fakeRenderer(live, 1)
    const liveTarget = renderer.getCanvasTarget()
    const during = atCaptureSize(renderer, 800, 600, () => renderer.getCanvasTarget())
    expect(during).toBe(liveTarget)
  })
})

/** R3F's `advance` with `frameloop="never"`: the delta is the timestamp less the clock's elapsed time. */
function fakeLoop(startSeconds: number) {
  const clock = { elapsedTime: startSeconds, oldTime: startSeconds }
  const deltas: number[] = []
  const advance = (timestamp: number) => {
    deltas.push(timestamp - clock.elapsedTime)
    clock.oldTime = clock.elapsedTime
    clock.elapsedTime = timestamp
  }
  return { clock, deltas, advance }
}

describe('frames a capture runs by hand', () => {
  test('never hand the next real frame a delta it did not earn', async () => {
    // the viewer's frame limiter drives R3F's clock in seconds since it
    // mounted; performance.now() is milliseconds since the page loaded
    const loop = fakeLoop(330.62)
    await pumpFrames(loop.advance, loop.clock, 2)
    // the frame limiter's next frame, one 50 fps interval on
    loop.advance(330.64)
    expect(loop.deltas).toHaveLength(3)
    expect(loop.deltas[0]).toBeCloseTo(0.001, 9)
    expect(loop.deltas[1]).toBeCloseTo(0.001, 9)
    expect(loop.deltas[2]).toBeCloseTo(0.02, 9)
    expect(loop.clock.elapsedTime).toBe(330.64)
  })

  test('put the clock back when a frame throws', async () => {
    const loop = fakeLoop(12)
    const failing = () => {
      throw new Error('a system failed')
    }
    await expect(pumpFrames(failing, loop.clock, 1)).rejects.toThrow('a system failed')
    expect(loop.clock.elapsedTime).toBe(12)
  })
})

describe('a sheet capture session', () => {
  test('shows the finished house whatever view the user was in, then puts the view back', () => {
    const viewer = useViewer.getState()
    viewer.setWallMode('down')
    viewer.setLevelMode('exploded')
    viewer.setShading('solid')
    viewer.setTextures(false)
    viewer.setColorPreset('white')
    const view = () => {
      const { wallMode, levelMode, shading, textures, colorPreset } = useViewer.getState()
      return { wallMode, levelMode, shading, textures, colorPreset }
    }
    // the shading stays the user's: the capture brings its own AO

    const restore = presentFinished()
    expect(view()).toEqual({
      wallMode: 'up',
      levelMode: 'stacked',
      shading: 'solid',
      textures: true,
      colorPreset: 'clay',
    })

    restore()
    expect(view()).toEqual({
      wallMode: 'down',
      levelMode: 'exploded',
      shading: 'solid',
      textures: false,
      colorPreset: 'white',
    })
  })

  test('leaves a view already finished untouched', () => {
    const viewer = useViewer.getState()
    viewer.setWallMode('up')
    viewer.setLevelMode('stacked')
    viewer.setTextures(true)
    viewer.setColorPreset('clay')
    let writes = 0
    const unsubscribe = useViewer.subscribe(() => {
      writes++
    })
    presentFinished()()
    unsubscribe()
    expect(writes).toBe(0)
  })
})

describe('a print-size picture past one render pass', () => {
  test('fits one pass: one tile, the whole picture', () => {
    expect(tileGrid(3209, 2588, 4096)).toEqual([
      { x: 0, y: 0, w: 3209, h: 2588, inner: { x: 0, y: 0, w: 3209, h: 2588 } },
    ])
  })

  test('splits into equal tiles that cover every pixel once, each rendering past its seams', () => {
    // a 200 ppi elevation on Arch D: 22.1 in across
    const width = 4423
    const height = 3567
    const tiles = tileGrid(width, height, 4096)
    expect(tiles).toHaveLength(2)
    let covered = 0
    for (const tile of tiles) {
      expect(tile.w).toBeLessThanOrEqual(4096)
      expect(tile.h).toBeLessThanOrEqual(4096)
      // the rendered rect holds the contributed one, on the picture
      expect(tile.x).toBeLessThanOrEqual(tile.inner.x)
      expect(tile.x + tile.w).toBeGreaterThanOrEqual(tile.inner.x + tile.inner.w)
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.w).toBeLessThanOrEqual(width)
      covered += tile.inner.w * tile.inner.h
    }
    expect(covered).toBe(width * height)
    const [left, right] = tiles as [(typeof tiles)[number], (typeof tiles)[number]]
    expect(left.inner.x + left.inner.w).toBe(right.inner.x)
    // the seam: each side renders the other's first pixels too
    expect(left.x + left.w - (left.inner.x + left.inner.w)).toBeGreaterThan(0)
    expect(right.inner.x - right.x).toBeGreaterThan(0)
  })
})
