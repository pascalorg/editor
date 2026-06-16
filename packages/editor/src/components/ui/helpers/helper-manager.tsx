'use client'

import { type AnyNodeId, nodeRegistry, type ToolHint } from '@pascal-app/core'
import useScene from '@pascal-app/core/store'
import { useViewer } from '@pascal-app/viewer'
import { useIsMobile } from '../../../hooks/use-mobile'
import { getManualAssemblySelectionState } from '../../../lib/manual-assembly'
import useEditor from '../../../store/use-editor'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'

const ROTATE_HINTS: ToolHint[] = [
  { key: 'R', label: '\u987a\u65f6\u9488\u65cb\u8f6c' },
  { key: 'T', label: '\u9006\u65f6\u9488\u65cb\u8f6c' },
]

const CANCEL_HINT: ToolHint = { key: 'Esc', label: '\u53d6\u6d88' }
const GROUP_HINTS: ToolHint[] = [
  { key: 'G', label: '\u7ec4\u5408\u6240\u9009\u7269\u4f53' },
  CANCEL_HINT,
]
const UNGROUP_HINTS: ToolHint[] = [
  { key: 'U', label: '\u89e3\u5f00\u7ec4\u5408' },
  CANCEL_HINT,
]
const NESTED_ASSEMBLY_HINTS: ToolHint[] = [
  { key: 'U', label: '\u5148\u89e3\u7ec4\uff0c\u518d\u91cd\u65b0\u7ec4\u5408' },
  CANCEL_HINT,
]

function placementHints(placeLabel: string, includeRotate: boolean): ToolHint[] {
  return [
    { key: 'Left click', label: placeLabel },
    ...(includeRotate ? ROTATE_HINTS : []),
    CANCEL_HINT,
  ]
}

function metadataRecord(node: { metadata?: unknown }) {
  return typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function movingNodeHints(movingNode: { type: string; metadata?: unknown }): ToolHint[] {
  const def = nodeRegistry.get(movingNode.type)
  if (def?.toolHints?.length) return def.toolHints

  const metadata = metadataRecord(movingNode)
  const isGeneratedGeometry =
    metadata.generatedBy === 'ai-chat' ||
    typeof metadata.artifactId === 'string' ||
    typeof metadata.sourceTool === 'string'
  const canRotate = Boolean(def?.capabilities?.rotatable)

  if (isGeneratedGeometry) return placementHints('\u653e\u7f6e\u51e0\u4f55', canRotate)
  if (movingNode.type === 'building') return placementHints('\u653e\u7f6e\u5efa\u7b51', true)
  return placementHints('\u653e\u7f6e', canRotate)
}

export function HelperManager() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const isMobile = useIsMobile()

  // Helpers are keyboard-driven hints (Esc, R, etc.) and are irrelevant on touch.
  if (isMobile) return null

  if (movingNode) {
    return <RegisteredToolHelper hints={movingNodeHints(movingNode)} />
  }

  if (mode === 'material-paint') {
    return null
  }

  if (mode === 'select') {
    const assemblyState = getManualAssemblySelectionState(nodes, selectedIds as AnyNodeId[])
    if (assemblyState.kind === 'groupable') {
      return <RegisteredToolHelper hints={GROUP_HINTS} />
    }
    if (assemblyState.kind === 'ungroupable') {
      return <RegisteredToolHelper hints={UNGROUP_HINTS} />
    }
    if (assemblyState.kind === 'blocked' && assemblyState.reason === 'nested-assembly') {
      return <RegisteredToolHelper hints={NESTED_ASSEMBLY_HINTS} />
    }
  }

  // Registry-first: kinds with `def.toolHints` render through the generic
  // `RegisteredToolHelper`. Today that covers ceiling / door / fence /
  // item / shelf / slab / spawn / wall / window.
  if (tool) {
    const def = nodeRegistry.get(tool)
    if (def?.toolHints && def.toolHints.length > 0) {
      return <RegisteredToolHelper hints={def.toolHints} />
    }
  }

  // Legacy fallback: only `roof` remains because it hasn't migrated to
  // `def.tool` / `def.toolHints` yet (no Stage D port). When roof
  // migrates, this switch deletes outright.
  if (tool === 'roof') return <RoofHelper />
  return null
}
