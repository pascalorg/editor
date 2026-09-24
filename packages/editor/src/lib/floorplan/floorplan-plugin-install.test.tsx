import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  LevelNode,
  loadPlugin,
  nodeRegistry,
} from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import { FloorplanPreview } from '../../components/viewer/floorplan-preview'
import { DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } from './annotation-visibility'
import { collectFloorplanGeometry } from './floorplan-export'

// Plugin API v1, no-install case: a plugin kind's floor-plan output appears in
// the read-only preview and the PDF export only while the project has the
// plugin installed.

const PLUGIN_ID = 'fixture:floorplan'
const KIND = 'fixture:bed'
const MARKER_FILL = '#a09a09'

const level = LevelNode.parse({ id: 'level_plugin_plan', children: ['fxbed_plan'] })
const bed = {
  object: 'node',
  id: 'fxbed_plan',
  type: KIND,
  parentId: level.id,
  visible: true,
  metadata: {},
} as unknown as AnyNode
const nodes = { [level.id]: level, [bed.id]: bed } as Record<string, AnyNode>

let restoreRegistry: () => void

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  await loadPlugin({
    id: PLUGIN_ID,
    apiVersion: 1,
    nodes: [
      {
        kind: KIND,
        schemaVersion: 1,
        schema: z.looseObject({ id: z.string(), type: z.literal(KIND) }),
        category: 'structure',
        defaults: () => ({}),
        capabilities: {},
        floorplan: () => ({ kind: 'rect', x: 0, y: 0, width: 2, height: 1, fill: MARKER_FILL }),
      } as unknown as AnyNodeDefinition,
    ],
  })
})

afterEach(() => {
  restoreRegistry()
})

function exportedIds(installedPlugins: readonly string[]) {
  return collectFloorplanGeometry(
    nodes,
    level.id,
    'full',
    'metric',
    'meters',
    DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
    'floor-plan',
    'finished-faces',
    installedPlugins,
  ).map(({ id }) => id)
}

function previewMarkup(installedPlugins: readonly string[]) {
  return renderToStaticMarkup(
    <FloorplanPreview
      levelId={level.id}
      scene={{ nodes, installedPlugins }}
      showCompass={false}
      showLevelSelector={false}
    />,
  )
}

describe('floor-plan output of a plugin kind', () => {
  test('the read-only preview draws it only while the plugin is installed', () => {
    expect(previewMarkup([PLUGIN_ID])).toContain(MARKER_FILL)
    expect(previewMarkup([])).not.toContain(MARKER_FILL)
  })

  test('the PDF export draws it while the plugin is installed', () => {
    expect(exportedIds([PLUGIN_ID])).toEqual([bed.id])
  })

  test('the PDF export omits it while the plugin is not installed', () => {
    expect(exportedIds([])).toEqual([])
  })
})
