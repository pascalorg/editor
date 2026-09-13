import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  NO_SECTION_MARKER_NOTE,
  registerSheetDrawingProvider,
  resolveViewport,
  splitProvidedGeometry,
  wrapWords,
} from './drawings'
import type { NodeMap } from './model'
import { DEFAULT_VIEWPORT_LAYERS, type ViewportLayers, ViewportNode } from './schema'

/**
 * A synthetic site drawing shaped exactly like WS1's
 * `buildSitePlanDrawing` output: a lot polygon plus one `dimension`
 * primitive standing in for a yard dimension string.
 */
function siteDrawing(): { primitives: FloorplanGeometry[]; bounds: Bounds } {
  return {
    primitives: [
      {
        kind: 'polygon',
        points: [
          [0, 0],
          [20, 0],
          [20, 30],
          [0, 30],
        ],
        fill: 'none',
        stroke: '#111827',
      },
      {
        kind: 'dimension',
        start: [10, 4],
        end: [10, 0],
        offsetNormal: [1, 0],
        offsetDistance: 0,
        extensionOvershoot: 0.35,
        stroke: '#334155',
        terminator: 'architectural-tick',
        text: '13\'-1"',
        metadata: { sitePlan: 'yard-dimension', side: 'front' },
      } as FloorplanGeometry,
    ],
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

function sitePlanViewport(layers: ViewportLayers = DEFAULT_VIEWPORT_LAYERS) {
  return ViewportNode.parse({
    sheetId: 'sheet_1',
    kind: 'site-plan',
    scale: 240,
    x: 1,
    y: 1,
    w: 14,
    h: 10,
    layers,
  })
}

const EMPTY: NodeMap = {}

describe('the yard dimensions survive the viewport filter', () => {
  test('a `dimension` primitive reaches the sheet, on the annotation channel', () => {
    registerSheetDrawingProvider('site-plan', () => siteDrawing())
    const drawn = resolveViewport(sitePlanViewport(), { nodes: EMPTY })

    expect(drawn.live).not.toBeNull()
    const annotations = drawn.live?.annotations
    expect(annotations?.kind).toBe('group')
    const kinds = (annotations as { children: FloorplanGeometry[] }).children.map((g) => g.kind)
    expect(kinds).toEqual(['dimension'])

    // …and the lot polygon stays in the model channel, unmolested.
    const model = drawn.live?.model as { children: FloorplanGeometry[] }
    expect(model.children.map((g) => g.kind)).toEqual(['polygon'])
  })

  test('the automatic-dimension layer switch actually switches them off', () => {
    registerSheetDrawingProvider('site-plan', () => siteDrawing())
    const off = resolveViewport(
      sitePlanViewport({ ...DEFAULT_VIEWPORT_LAYERS, automaticDimensions: false }),
      { nodes: EMPTY },
    )
    expect(off.live?.annotations).toBeNull()
    expect((off.live?.model as { children: FloorplanGeometry[] }).children).toHaveLength(1)
  })

  test('site-plan viewports have their dimension layers on by default', () => {
    expect(DEFAULT_VIEWPORT_LAYERS.automaticDimensions).toBe(true)
    expect(sitePlanViewport().layers.automaticDimensions).toBe(true)
  })
})

describe('splitProvidedGeometry', () => {
  test('descends untransformed groups', () => {
    const split = splitProvidedGeometry(
      [{ kind: 'group', children: siteDrawing().primitives }],
      DEFAULT_VIEWPORT_LAYERS,
    )
    expect(split.model.map((g) => g.kind)).toEqual(['polygon'])
    expect(split.annotations.map((g) => g.kind)).toEqual(['dimension'])
  })

  test('leaves a transformed group whole, so its transform is not lost', () => {
    const group: FloorplanGeometry = {
      kind: 'group',
      transform: { translate: [1, 2] },
      children: siteDrawing().primitives,
    }
    const split = splitProvidedGeometry([group], DEFAULT_VIEWPORT_LAYERS)
    expect(split.model).toEqual([group])
    expect(split.annotations).toEqual([])
  })

  test('routes manual and contextual dimensions to their own switches', () => {
    // `metadata` is not declared on the `dimension` variant in the core dist
    // this package compiles against; WS1's builder casts for the same reason.
    const manual = {
      ...(siteDrawing().primitives[1] as Extract<FloorplanGeometry, { kind: 'dimension' }>),
      metadata: { annotationRole: 'manual-dimension' },
    } as unknown as FloorplanGeometry
    expect(
      splitProvidedGeometry([manual], { ...DEFAULT_VIEWPORT_LAYERS, manualDimensions: false })
        .annotations,
    ).toHaveLength(0)
    expect(
      splitProvidedGeometry([manual], {
        ...DEFAULT_VIEWPORT_LAYERS,
        automaticDimensions: false,
        manualDimensions: true,
      }).annotations,
    ).toHaveLength(1)
  })
})

describe('a section sheet with no markers', () => {
  test('prints where the section marker tool is', () => {
    const vp = ViewportNode.parse({ sheetId: 'sheet_1', kind: 'section', x: 1, y: 1, w: 14, h: 10 })
    const drawn = resolveViewport(vp, { nodes: EMPTY })
    expect(drawn.live).toBeNull()
    const text = drawn.plate
      .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
      .map((g) => g.text)
      .join('\n')
    expect(text).toContain('Sections panel → Section marker tool.')
    expect(NO_SECTION_MARKER_NOTE).toContain('Section marker tool')
  })
})

describe('wrapWords', () => {
  test('breaks on words, never mid-word', () => {
    const wrapped = wrapWords('the quick brown fox jumps over the lazy dog', 12)
    expect(wrapped.split('\n').every((line) => line.length <= 12)).toBe(true)
    expect(wrapped.replace(/\n/g, ' ')).toBe('the quick brown fox jumps over the lazy dog')
  })
})
