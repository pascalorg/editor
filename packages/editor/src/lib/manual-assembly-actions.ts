import type { AnyNodeId } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import useViewer from '@pascal-app/viewer/store'
import { buildGroupSelectedNodesChanges, buildUngroupAssemblyChanges } from './manual-assembly'

export function groupSelectedNodes(selectedIds?: AnyNodeId[]) {
  const scene = useScene.getState()
  const ids = selectedIds ?? (useViewer.getState().selection.selectedIds as AnyNodeId[])
  const result = buildGroupSelectedNodesChanges(scene.nodes, ids)
  if (!result) return false

  scene.applyNodeChanges(result.changes)
  useViewer.getState().setSelection({ selectedIds: [result.assemblyId] })
  return true
}

export function ungroupAssembly(assemblyId?: AnyNodeId) {
  const scene = useScene.getState()
  const selectedIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
  const id = assemblyId ?? (selectedIds.length === 1 ? selectedIds[0] : undefined)
  if (!id) return false

  const result = buildUngroupAssemblyChanges(scene.nodes, id)
  if (!result) return false

  scene.applyNodeChanges(result.changes)
  useViewer.getState().setSelection({ selectedIds: result.childIds })
  return true
}
