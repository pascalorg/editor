import type { AnyNode, AnyNodeId, FloorplanPalette, GeometryContext } from '@pascal-app/core'
import {
  createFloorplanContextExtensions,
  type FloorplanWallDimensionReference,
} from './floorplan-extension'

export type FloorplanViewState = {
  automaticDimensions?: boolean
  selected: boolean
  unit: 'metric' | 'imperial'
  metricNotation?: 'meters' | 'millimeters'
  purpose?: 'edit' | 'document'
  wallDimensionReference?: FloorplanWallDimensionReference
  highlighted: boolean
  hovered: boolean
  moving: boolean
  palette: FloorplanPalette | undefined
}

export function buildFloorplanContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  viewState: FloorplanViewState,
  levelData?: unknown,
): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined
  const childIds = (node as { children?: AnyNodeId[] }).children
  const children = Array.isArray(childIds)
    ? childIds.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)
    : []
  const parentId = node.parentId as AnyNodeId | null
  const parent = parentId ? (nodes[parentId] ?? null) : null
  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as { children?: AnyNodeId[] }).children
    siblings = Array.isArray(parentChildIds)
      ? parentChildIds
          .filter((id) => id !== node.id)
          .map((id) => nodes[id])
          .filter((sibling): sibling is AnyNode => sibling?.type === node.type)
      : Object.values(nodes).filter(
          (candidate) =>
            candidate.id !== node.id &&
            candidate.type === node.type &&
            candidate.parentId === node.parentId,
        )
  }

  return {
    resolve,
    children,
    siblings,
    parent,
    levelData,
    extensions: createFloorplanContextExtensions({
      automaticDimensions: viewState.automaticDimensions,
      metricNotation: viewState.metricNotation ?? 'meters',
      purpose: viewState.purpose ?? 'edit',
      wallDimensionReference: viewState.wallDimensionReference,
    }),
    viewState: viewState.palette
      ? {
          selected: viewState.selected,
          unit: viewState.unit,
          highlighted: viewState.highlighted,
          hovered: viewState.hovered,
          moving: viewState.moving,
          palette: viewState.palette,
        }
      : undefined,
  }
}

export function floorplanLayerRank(type: string): number {
  switch (type) {
    case 'zone':
      return 0
    case 'slab':
    case 'ceiling':
      return 1
    default:
      return 2
  }
}
