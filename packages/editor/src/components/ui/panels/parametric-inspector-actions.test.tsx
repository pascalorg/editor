import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import { useInspectorExpanded } from '../../../lib/inspector-expanded'
import { renderCurrentMarkup } from '../../../test-utils/render-current-markup'
import { ParametricInspector } from './parametric-inspector'

// An inspector action that no longer applies to the selected node is not offered at all;
// one that applies but cannot run right now stays, greyed.
const kind = 'fixture:action-visibility'
const id = 'fixture_action_node' as AnyNodeId
const savedScene = useScene.getState()
const savedViewer = useViewer.getState()
const savedInspector = useInspectorExpanded.getState()
let restoreRegistry: () => void = () => {}

beforeEach(() => {
  useInspectorExpanded.setState({ expanded: true, activeExtensionId: null })
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind), generation: z.number().default(1) }),
    category: 'site',
    defaults: () => ({ generation: 1 }),
    presentation: { label: 'Action fixture' },
    capabilities: { selectable: true, deletable: false },
    parametrics: {
      groups: [],
      actions: [
        { label: 'Shuffle fixture', onClick: () => {} },
        {
          label: 'Upgrade fixture',
          visibleIf: (node: { generation: number }) => node.generation < 2,
          onClick: () => {},
        },
        {
          label: 'Greyed fixture',
          enabledIf: () => false,
          onClick: () => {},
        },
      ],
    },
  } as unknown as AnyNodeDefinition)
})

afterEach(() => {
  restoreRegistry()
  useScene.setState(savedScene)
  useViewer.setState(savedViewer)
  useInspectorExpanded.setState(savedInspector)
})

function inspect(generation: number) {
  useScene.setState({
    nodes: { [id]: { id, type: kind, parentId: null, generation } } as unknown as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [id],
  })
  useViewer.getState().setSelection({ selectedIds: [id] })
  return renderCurrentMarkup(<ParametricInspector />)
}

test('an action is absent while its visibility rule says it does not apply, and back when it does', () => {
  const legacy = inspect(1)
  expect(legacy).toContain('Shuffle fixture')
  expect(legacy).toContain('Upgrade fixture')
  const current = inspect(2)
  expect(current).toContain('Shuffle fixture')
  expect(current).not.toContain('Upgrade fixture')
  // A disabled action is still listed: hiding is a separate rule.
  expect(current).toContain('Greyed fixture')
})
