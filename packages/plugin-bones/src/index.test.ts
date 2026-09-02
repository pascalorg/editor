import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { BONES_ICON } from './art'
import { bonesHostPanel, bonesInspectorExtensions, bonesPlugin } from './index'
import { lumberBoxDims } from './lumber'
import { LumberNode } from './schema'

describe('Bones plugin manifest', () => {
  test('exports the stable plugin identity and node kinds', () => {
    expect(bonesPlugin.id).toBe('pascal:bones')
    expect(bonesPlugin.apiVersion).toBe(1)
    expect(bonesPlugin.nodes?.map((definition) => definition.kind)).toEqual([
      'bones:framing',
      'bones:lumber',
      'bones:service',
      'bones:device',
    ])
  })

  test('associates the Bones panel with the plugin', () => {
    expect(bonesHostPanel.pluginId).toBe(bonesPlugin.id)
    expect(bonesHostPanel.defaultInstalled).toBe(true)
    expect(bonesHostPanel.pluginUrl).toBe('https://github.com/pascalorg/plugin-bones')
  })
})

describe('inspector extensions', () => {
  // GATE (host contract): the manifest must ride the plugin object itself —
  // the host's loadPlugin reads `plugin.inspectorExtensions` duck-typed —
  // and the wall extension's shape must match the host's InspectorExtension
  // (editor#667): id / pluginId / kinds / url icon / title / lazy component.
  test('the plugin manifest carries the wall Engineering extension', () => {
    expect(bonesPlugin.inspectorExtensions).toBe(bonesInspectorExtensions)
    expect(bonesInspectorExtensions).toHaveLength(1)
    const extension = bonesInspectorExtensions[0]
    expect(extension?.id).toBe('pascal:bones:wall-engineering')
    expect(extension?.pluginId).toBe(bonesPlugin.id)
    expect(extension?.kinds).toEqual(['wall'])
    // Same artwork as the sidebar panel button. (Under bun the static
    // webp import has no `.src`, so compare against the shared constant
    // rather than asserting the string type.)
    expect(extension?.icon.kind).toBe('url')
    expect(extension?.icon.src).toBe(BONES_ICON)
    expect(extension?.title).toBe('Engineering')
    expect(typeof extension?.component).toBe('function')
  })

  test('the lazy component resolves to a renderable default export', async () => {
    const loaded = await bonesInspectorExtensions[0]?.component()
    expect(typeof loaded?.default).toBe('function')
  })

  // Headless smoke render — the empty-scene path (no framing node on the
  // wall's level) prints the X-Ray call to action instead of crashing. The
  // full engineering readout is already gated through selectedWallInfo
  // (panel-selection.test.ts) — no duplicate logic gates here.
  test('renders headless: no framing node → X-Ray call to action', async () => {
    const { default: WallEngineering } = await bonesInspectorExtensions[0]!.component()
    const html = renderToString(
      createElement(WallEngineering, { node: { id: 'wall-1', parentId: 'level-1' } }),
    )
    expect(html).toContain('X-Ray this level')
  })
})

describe('LumberNode schema', () => {
  test('parses defaults — an 8ft vertical 2x4', () => {
    const node = LumberNode.parse({})
    expect(node.size).toBe('2x4')
    expect(node.orientation).toBe('stud')
    expect(node.length).toBeCloseTo(2.4384, 4)
    expect(node.type).toBe('bones:lumber')
    expect(node.id.startsWith('lumber')).toBe(true)
  })

  test('rejects a non-positive length', () => {
    expect(() => LumberNode.parse({ length: 0 })).toThrow()
  })
})

describe('lumberBoxDims', () => {
  test('a stud stands its length up along Y at actual dressed size', () => {
    const [x, y, z] = lumberBoxDims('2x4', 2.4384, 'stud')
    expect(y).toBeCloseTo(2.4384, 4)
    expect(x).toBeCloseTo(3.5 * 0.0254, 4) // 3.5" face
    expect(z).toBeCloseTo(1.5 * 0.0254, 4) // 1.5" thickness
  })

  test('a flat member lies on its wide face like a plate', () => {
    const [x, y, z] = lumberBoxDims('2x6', 3, 'flat')
    expect(x).toBe(3)
    expect(y).toBeCloseTo(1.5 * 0.0254, 4)
    expect(z).toBeCloseTo(5.5 * 0.0254, 4)
  })

  test('an edge member stands on its narrow edge like a joist', () => {
    const [x, y, z] = lumberBoxDims('2x10', 4, 'edge')
    expect(x).toBe(4)
    expect(y).toBeCloseTo(9.25 * 0.0254, 4)
    expect(z).toBeCloseTo(1.5 * 0.0254, 4)
  })
})
