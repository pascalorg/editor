import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import React, { type MouseEvent } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { z } from 'zod'
import { useInspectorExpanded } from '../../../../../lib/inspector-expanded'
import useEditor from '../../../../../store/use-editor'
import { renderCurrentMarkup } from '../../../../../test-utils/render-current-markup'
import { ParametricInspector } from '../../../panels/parametric-inspector'
import { SitePanel } from './index'
import { handleTreeSelection } from './tree-node'

const siteId = 'site_garden_tree'
const buildingId = 'building_garden_tree'
const levelId = 'level_garden_tree'
const gardenKinds = ['hedge', 'planting', 'rock'].map((name) => ({
  kind: `fixture:site-tree-${name}`,
  id: `garden_tree_${name}` as AnyNodeId,
  label: `Garden ${name}`,
}))
const hiddenId = 'garden_tree_hidden' as AnyNodeId
const omittedId = 'garden_tree_omitted' as AnyNodeId
const savedScene = useScene.getState()
const savedViewer = useViewer.getState()
const savedEditor = useEditor.getState()
const savedInspector = useInspectorExpanded.getState()
let restoreRegistry: () => void

function definition(kind: string, label: string): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind), height: z.number().default(1.5) }),
    category: 'site',
    defaults: () => ({ height: 1.5 }),
    presentation: { label },
    capabilities: { selectable: true, deletable: false },
    parametrics: {
      groups: [{
        label: `${label} properties`,
        fields: [{ key: 'height', kind: 'number', default: 1.5, step: 0.1, unit: 'm' }],
      }],
    },
  } as unknown as AnyNodeDefinition
}

function SiteInspectorFixture() {
  return <aside data-site-inspector="true">Contextual Site inspector</aside>
}

beforeEach(() => {
  useInspectorExpanded.setState({ expanded: true, activeExtensionId: null })
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode({
    ...definition('site', 'Site'),
    parametrics: {
      groups: [],
      customPanel: async () => ({ default: SiteInspectorFixture }),
    },
    tree: {
      childIds: (node) =>
        (node as unknown as { children: AnyNodeId[] }).children.filter((id) => id !== omittedId),
    },
  })
  for (const { kind, label } of gardenKinds) registerNode(definition(kind, label))
  registerNode({
    ...definition('fixture:site-tree-hidden', 'Hidden garden element'),
    tree: { hidden: () => true },
  })
})

afterEach(() => {
  restoreRegistry()
  useScene.setState(savedScene)
  useViewer.setState(savedViewer)
  useEditor.setState(savedEditor)
  useInspectorExpanded.setState(savedInspector)
})

function openSite(phase: 'site' | 'building', withBuilding: boolean) {
  const children = [...gardenKinds.map(({ id }) => id), hiddenId, omittedId]
  if (withBuilding) children.unshift(buildingId)
  const nodes = {
    [siteId]: {
      id: siteId,
      type: 'site',
      parentId: null,
      children,
      polygon: { points: [] },
    },
    ...Object.fromEntries(
      gardenKinds.map(({ id, kind, label }) => [
        id,
        { id, type: kind, parentId: siteId, name: label, height: 1.5 },
      ]),
    ),
    [hiddenId]: { id: hiddenId, type: 'fixture:site-tree-hidden', parentId: siteId },
    [omittedId]: {
      id: omittedId,
      type: 'fixture:site-tree-hedge',
      parentId: siteId,
      name: 'Omitted garden element',
    },
    ...(withBuilding
      ? {
          [buildingId]: {
            id: buildingId,
            type: 'building',
            name: 'Garden house',
            parentId: siteId,
            children: [levelId],
          },
          [levelId]: {
            id: levelId,
            type: 'level',
            level: 0,
            parentId: buildingId,
            children: [],
          },
        }
      : {}),
  } as unknown as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [siteId] })
  useViewer.setState({
    selection: {
      buildingId: withBuilding ? buildingId : null,
      levelId: withBuilding ? levelId : null,
      zoneId: null,
      selectedIds: [],
    },
    focusedUnitId: null,
  })
  useEditor.setState({
    phase,
    mode: 'select',
    toolMode: { mode: 'select' },
    room: null,
    selectedReferenceId: null,
  })
}

async function renderSiteInspectors(): Promise<string> {
  const useSyncExternalStore = React.useSyncExternalStore
  const serverSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
    (subscribe, getSnapshot) => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
  )
  try {
    const stream = await renderToReadableStream(
      <>
        <SitePanel />
        <ParametricInspector />
      </>,
    )
    await stream.allReady
    return await new Response(stream).text()
  } finally {
    serverSnapshot.mockRestore()
  }
}

describe('Site-owned elements in the Scene panel', () => {
  test('the contextual Site inspector yields to selected elements and the selected Site', async () => {
    openSite('site', false)
    expect(await renderSiteInspectors()).toContain('data-site-inspector="true"')

    for (const { id, label } of gardenKinds) {
      useViewer.getState().setSelection({ selectedIds: [id] })
      const markup = await renderSiteInspectors()
      expect(markup).not.toContain('data-site-inspector="true"')
      expect(markup).toContain(`${label} properties`)
    }

    useViewer.getState().setSelection({ selectedIds: [siteId] })
    const siteMarkup = await renderSiteInspectors()
    expect(siteMarkup.match(/data-site-inspector="true"/g)).toHaveLength(1)

    useViewer.getState().setSelection({ selectedIds: [] })
    expect(await renderSiteInspectors()).toContain('data-site-inspector="true"')
  })

  for (const phase of ['site', 'building'] as const) {
    test(`garden rows are selectable and inspectable in ${phase} phase`, () => {
      openSite(phase, phase === 'building')
      const markup = renderCurrentMarkup(<SitePanel />)
      for (const { id, label } of gardenKinds) {
        expect(markup).toContain(`data-treenode-id="${id}"`)
        expect(markup).toContain(label)
        handleTreeSelection(
          { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
          id,
          useViewer.getState().selection.selectedIds,
          useViewer.getState().setSelection,
        )
        expect(useViewer.getState().selection.selectedIds).toEqual([id])
        expect(renderCurrentMarkup(<ParametricInspector />)).toContain(`${label} properties`)
        expect(useEditor.getState().phase).toBe(phase)
      }
      expect(markup).not.toContain(`data-treenode-id="${hiddenId}"`)
      expect(markup).not.toContain(`data-treenode-id="${omittedId}"`)
      if (phase === 'building') expect(markup).toContain('Garden house')
      else expect(markup).toContain('No buildings yet')
    })
  }
})
