import { deflateSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import {
  buildVisualSmokeReport,
  parseFactoryFullRunQaArgs,
  pngMetrics,
  type PngMetrics,
} from './factory-full-run-qa'

function chunk(type: string, data: Buffer) {
  const buffer = Buffer.alloc(12 + data.length)
  buffer.writeUInt32BE(data.length, 0)
  buffer.write(type, 4, 4, 'ascii')
  data.copy(buffer, 8)
  return buffer
}

function rgbaPng(width: number, height: number, pixels: number[]) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const rows: number[] = []
  for (let y = 0; y < height; y += 1) {
    rows.push(0)
    rows.push(...pixels.slice(y * width * 4, (y + 1) * width * 4))
  }
  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function metrics(overrides: Partial<PngMetrics> = {}): PngMetrics {
  return {
    width: 320,
    height: 180,
    sampledPixelCount: 100,
    uniqueColorBuckets: 24,
    nonTransparentRatio: 1,
    lumaStdDev: 18,
    ...overrides,
  }
}

describe('factory full run QA script helpers', () => {
  test('parses default and repeatable CLI options', () => {
    const options = parseFactoryFullRunQaArgs([
      '--prompt',
      '生成一个水泥熟料产线',
      '--mode',
      'smoke',
      '--view',
      'top',
      '--key-station',
      'preheater_tower',
      '--key-station',
      'rotary_kiln',
      '--delete-scene',
      '--timeout-ms',
      '12345',
    ])

    expect(options.prompt).toBe('生成一个水泥熟料产线')
    expect(options.mode).toBe('smoke')
    expect(options.views).toEqual(['top'])
    expect(options.keyStationIds).toEqual(['preheater_tower', 'rotary_kiln'])
    expect(options.keepScene).toBe(false)
    expect(options.timeoutMs).toBe(12345)
  })

  test('extracts basic PNG metrics without external image libraries', () => {
    const png = rgbaPng(2, 2, [
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ])

    const result = pngMetrics(png)

    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(result.sampledPixelCount).toBe(4)
    expect(result.nonTransparentRatio).toBe(1)
    expect(result.uniqueColorBuckets).toBeGreaterThanOrEqual(4)
    expect(result.lumaStdDev).toBeGreaterThan(0)
  })

  test('passes when generated graph and screenshots satisfy smoke checks', () => {
    const options = parseFactoryFullRunQaArgs([])
    const report = buildVisualSmokeReport({
      options,
      run: {
        id: 'run_1',
        status: 'succeeded',
        result: {
          patches: Array.from({ length: 30 }, (_, index) => ({ op: 'create', id: `node_${index}` })),
          qualityReport: { passed: true, score: 100 },
        },
      },
      sceneId: 'scene_1',
      outputDir: '/tmp/factory',
      reportPath: '/tmp/factory/visual-smoke-report.json',
      runPath: '/tmp/factory/run.json',
      sceneGraphPath: '/tmp/factory/scene-graph.json',
      nodes: [
        ...options.keyStationIds.map((stationId, index) => ({
          id: `assembly_${index}`,
          type: 'assembly',
          metadata: { stationId },
        })),
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `box_${index}`,
          type: 'box',
        })),
      ],
      rootNodeCount: 6,
      canvasCount: 1,
      canvasScreenshots: [
        { view: 'isometric', path: '/tmp/factory/isometric.png', sha256: 'a', metrics: metrics() },
        { view: 'top', path: '/tmp/factory/top.png', sha256: 'b', metrics: metrics() },
      ],
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    })

    expect(report.passed).toBe(true)
    expect(report.issueCount.error).toBe(0)
    expect(report.checks.presentKeyStationIds).toEqual(options.keyStationIds)
    expect(report.checks.viewsDistinct).toBe(true)
  })

  test('fails when canvas screenshots are blank or missing', () => {
    const options = parseFactoryFullRunQaArgs([])
    const report = buildVisualSmokeReport({
      options,
      run: {
        id: 'run_1',
        status: 'succeeded',
        result: {
          patches: Array.from({ length: 30 }, (_, index) => ({ op: 'create', id: `node_${index}` })),
          qualityReport: { passed: true, score: 100 },
        },
      },
      sceneId: 'scene_1',
      outputDir: '/tmp/factory',
      reportPath: '/tmp/factory/visual-smoke-report.json',
      runPath: '/tmp/factory/run.json',
      sceneGraphPath: '/tmp/factory/scene-graph.json',
      nodes: [],
      rootNodeCount: 0,
      canvasCount: 0,
      canvasScreenshots: [
        {
          view: 'isometric',
          path: '/tmp/factory/isometric.png',
          sha256: 'blank',
          metrics: metrics({ uniqueColorBuckets: 1, lumaStdDev: 0 }),
        },
      ],
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    })

    expect(report.passed).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['canvas_missing', 'canvas_blank_or_low_variance']),
    )
  })
})
