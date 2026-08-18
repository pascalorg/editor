import type { BlockTopology } from '@pascal-app/core'

export type BlockComponentMode = 'vertex' | 'edge' | 'face'

export type BlockSelection = {
  mode: BlockComponentMode
  ids: string[]
}

export type BlockSelectionState = BlockSelection & {
  activeId: string | null
}

function idsForMode(topology: BlockTopology, mode: BlockComponentMode): string[] {
  switch (mode) {
    case 'vertex':
      return topology.vertices.map((vertex) => vertex.id)
    case 'edge':
      return topology.edges.map((edge) => edge.id)
    case 'face':
      return topology.faces.map((face) => face.id)
  }
}

function selectedVertexIds(topology: BlockTopology, selection: BlockSelection): Set<string> {
  const selected = new Set(selection.ids)
  if (selection.mode === 'vertex') return selected
  const vertices = new Set<string>()
  if (selection.mode === 'edge') {
    for (const edge of topology.edges) {
      if (!selected.has(edge.id)) continue
      vertices.add(edge.vertexIds[0])
      vertices.add(edge.vertexIds[1])
    }
    return vertices
  }
  for (const face of topology.faces) {
    if (!selected.has(face.id)) continue
    for (const vertexId of face.vertexIds) vertices.add(vertexId)
  }
  return vertices
}

export function createBlockSelection(
  mode: BlockComponentMode,
  ids: string[] = [],
): BlockSelectionState {
  return { mode, ids, activeId: ids.at(-1) ?? null }
}

export function selectBlockComponent(
  selection: BlockSelectionState,
  id: string,
  additive: boolean,
): BlockSelectionState {
  if (!additive) return { ...selection, ids: [id], activeId: id }
  if (!selection.ids.includes(id)) {
    return { ...selection, ids: [...selection.ids, id], activeId: id }
  }
  const ids = selection.ids.filter((entry) => entry !== id)
  return { ...selection, ids, activeId: ids.at(-1) ?? null }
}

export function convertBlockSelection(
  topology: BlockTopology,
  selection: BlockSelectionState,
  nextMode: BlockComponentMode,
): BlockSelectionState {
  if (selection.mode === nextMode) return selection
  const vertices = selectedVertexIds(topology, selection)
  let ids: string[]
  switch (nextMode) {
    case 'vertex':
      ids = topology.vertices.filter((vertex) => vertices.has(vertex.id)).map((vertex) => vertex.id)
      break
    case 'edge':
      ids = topology.edges
        .filter((edge) => vertices.has(edge.vertexIds[0]) && vertices.has(edge.vertexIds[1]))
        .map((edge) => edge.id)
      break
    case 'face':
      ids = topology.faces
        .filter((face) => face.vertexIds.every((vertexId) => vertices.has(vertexId)))
        .map((face) => face.id)
      break
  }
  return { mode: nextMode, ids, activeId: ids.at(-1) ?? null }
}

export function selectAllBlockComponents(
  topology: BlockTopology,
  selection: BlockSelectionState,
): BlockSelectionState {
  const ids = idsForMode(topology, selection.mode)
  return { ...selection, ids, activeId: ids.at(-1) ?? null }
}

export function invertBlockSelection(
  topology: BlockTopology,
  selection: BlockSelectionState,
): BlockSelectionState {
  const selected = new Set(selection.ids)
  const ids = idsForMode(topology, selection.mode).filter((id) => !selected.has(id))
  return { ...selection, ids, activeId: ids.at(-1) ?? null }
}

export function clearBlockSelection(selection: BlockSelectionState): BlockSelectionState {
  return { ...selection, ids: [], activeId: null }
}
