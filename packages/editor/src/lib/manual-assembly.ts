import { type AnyNode, type AnyNodeId, AssemblyNode } from '@pascal-app/core/schema'

type Vec2 = [number, number]
type Vec3 = [number, number, number]

export type ManualAssemblySelectionState =
  | {
      kind: 'groupable'
      selectedIds: AnyNodeId[]
    }
  | {
      kind: 'ungroupable'
      assemblyId: AnyNodeId
    }
  | {
      kind: 'blocked'
      reason:
        | 'nested-assembly'
        | 'unsupported-selection'
        | 'different-parents'
        | 'unsupported-parent'
      selectedIds: AnyNodeId[]
    }
  | {
      kind: 'none'
      selectedIds: AnyNodeId[]
    }

type NodeChangeSet = {
  create?: { node: AnyNode; parentId?: AnyNodeId }[]
  update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
  delete?: AnyNodeId[]
}

const ROUTE_NODE_TYPES = new Set(['wall', 'fence', 'pipe', 'road', 'cable-tray', 'steel-beam'])
const SURFACE_NODE_TYPES = new Set(['slab', 'ceiling', 'zone'])
const SUPPORTED_PARENT_TYPES = new Set(['level', 'building'])

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  )
}

function isPointList(value: unknown): value is Vec2[] {
  return Array.isArray(value) && value.every(isVec2)
}

function isPointListList(value: unknown): value is Vec2[][] {
  return Array.isArray(value) && value.every(isPointList)
}

function hasOwnChildren(node: AnyNode) {
  return 'children' in node && Array.isArray(node.children) && node.children.length > 0
}

function collectPlanPoints(node: AnyNode): Vec3[] {
  const record = node as unknown as Record<string, unknown>
  const points: Vec3[] = []

  if (ROUTE_NODE_TYPES.has(node.type) && isVec2(record.start) && isVec2(record.end)) {
    const elevation = typeof record.elevation === 'number' ? record.elevation : 0
    points.push([record.start[0], elevation, record.start[1]])
    points.push([record.end[0], elevation, record.end[1]])
  }

  if (SURFACE_NODE_TYPES.has(node.type) && isPointList(record.polygon)) {
    const elevation = typeof record.elevation === 'number' ? record.elevation : 0
    for (const point of record.polygon) points.push([point[0], elevation, point[1]])
  }

  if (isVec3(record.position)) points.push(record.position)
  return points
}

function getNodeSupport(node: AnyNode) {
  const record = node as unknown as Record<string, unknown>
  return (
    isVec3(record.position) ||
    (ROUTE_NODE_TYPES.has(node.type) && isVec2(record.start) && isVec2(record.end)) ||
    (SURFACE_NODE_TYPES.has(node.type) && isPointList(record.polygon))
  )
}

function offsetVec3(position: Vec3, offset: Vec3, direction: 1 | -1): Vec3 {
  return [
    position[0] + direction * offset[0],
    position[1] + direction * offset[1],
    position[2] + direction * offset[2],
  ]
}

function offsetVec2(point: Vec2, offset: Vec3, direction: 1 | -1): Vec2 {
  return [point[0] + direction * offset[0], point[1] + direction * offset[2]]
}

function offsetNodeData(node: AnyNode, offset: Vec3, direction: 1 | -1): Partial<AnyNode> | null {
  const record = node as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}

  if (isVec3(record.position)) data.position = offsetVec3(record.position, offset, direction)
  if (ROUTE_NODE_TYPES.has(node.type)) {
    if (isVec2(record.start)) data.start = offsetVec2(record.start, offset, direction)
    if (isVec2(record.end)) data.end = offsetVec2(record.end, offset, direction)
  }
  if (SURFACE_NODE_TYPES.has(node.type)) {
    if (isPointList(record.polygon)) {
      data.polygon = record.polygon.map((point) => offsetVec2(point, offset, direction))
    }
    if (isPointListList(record.holes)) {
      data.holes = record.holes.map((hole) =>
        hole.map((point) => offsetVec2(point, offset, direction)),
      )
    }
  }

  return Object.keys(data).length > 0 ? (data as Partial<AnyNode>) : null
}

function computeAssemblyCenter(nodes: AnyNode[]): Vec3 {
  const points = nodes.flatMap(collectPlanPoints)
  if (points.length === 0) return [0, 0, 0]

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const [x, y, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
}

function resolveSelectedNodes(nodes: Record<AnyNodeId, AnyNode>, selectedIds: AnyNodeId[]) {
  return selectedIds.map((id) => nodes[id]).filter((node): node is AnyNode => Boolean(node))
}

export function getManualAssemblySelectionState(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedIds: AnyNodeId[],
): ManualAssemblySelectionState {
  const selectedNodes = resolveSelectedNodes(nodes, selectedIds)
  if (selectedNodes.length === 0) return { kind: 'none', selectedIds }

  if (selectedNodes.length === 1) {
    const [node] = selectedNodes
    if (node?.type === 'assembly') return { kind: 'ungroupable', assemblyId: node.id as AnyNodeId }
    return { kind: 'none', selectedIds }
  }

  if (selectedNodes.some((node) => node.type === 'assembly')) {
    return { kind: 'blocked', reason: 'nested-assembly', selectedIds }
  }

  const parentId = selectedNodes[0]?.parentId as AnyNodeId | null
  if (!selectedNodes.every((node) => (node.parentId as AnyNodeId | null) === parentId)) {
    return { kind: 'blocked', reason: 'different-parents', selectedIds }
  }

  const parent = parentId ? nodes[parentId] : null
  if (!parent || !SUPPORTED_PARENT_TYPES.has(parent.type)) {
    return { kind: 'blocked', reason: 'unsupported-parent', selectedIds }
  }

  if (selectedNodes.some((node) => hasOwnChildren(node) || !getNodeSupport(node))) {
    return { kind: 'blocked', reason: 'unsupported-selection', selectedIds }
  }

  return { kind: 'groupable', selectedIds: selectedNodes.map((node) => node.id as AnyNodeId) }
}

export function buildGroupSelectedNodesChanges(
  nodes: Record<AnyNodeId, AnyNode>,
  selectedIds: AnyNodeId[],
): { changes: NodeChangeSet; assemblyId: AnyNodeId } | null {
  const state = getManualAssemblySelectionState(nodes, selectedIds)
  if (state.kind !== 'groupable') return null

  const selectedNodes = resolveSelectedNodes(nodes, state.selectedIds)
  const parentId = selectedNodes[0]?.parentId as AnyNodeId | null
  if (!parentId) return null

  const center = computeAssemblyCenter(selectedNodes)
  const assembly = AssemblyNode.parse({
    name: '\u7ec4\u5408',
    parentId,
    position: center,
    children: state.selectedIds,
    metadata: { createdBy: 'manual-assembly' },
  })

  const update = selectedNodes.flatMap((node) => {
    const data = offsetNodeData(node, center, -1)
    if (!data) return []
    return [
      {
        id: node.id as AnyNodeId,
        data: {
          ...data,
          parentId: assembly.id,
        } as Partial<AnyNode>,
      },
    ]
  })

  if (update.length !== selectedNodes.length) return null
  return {
    assemblyId: assembly.id as AnyNodeId,
    changes: {
      create: [{ node: assembly, parentId }],
      update,
    },
  }
}

export function buildUngroupAssemblyChanges(
  nodes: Record<AnyNodeId, AnyNode>,
  assemblyId: AnyNodeId,
): { changes: NodeChangeSet; childIds: AnyNodeId[] } | null {
  const assembly = nodes[assemblyId]
  if (!(assembly && assembly.type === 'assembly')) return null

  const parentId = assembly.parentId as AnyNodeId | null
  if (!parentId) return null

  const position = isVec3((assembly as unknown as Record<string, unknown>).position)
    ? ((assembly as unknown as Record<string, unknown>).position as Vec3)
    : ([0, 0, 0] as Vec3)
  const childIds = (
    'children' in assembly && Array.isArray(assembly.children) ? assembly.children : []
  ) as AnyNodeId[]
  const children = resolveSelectedNodes(nodes, childIds).filter(
    (node) => node.parentId === assemblyId,
  )

  const update = children.flatMap((node) => {
    const data = offsetNodeData(node, position, 1)
    if (!data) return []
    return [
      {
        id: node.id as AnyNodeId,
        data: {
          ...data,
          parentId,
        } as Partial<AnyNode>,
      },
    ]
  })

  if (children.length === 0 || update.length !== children.length) return null
  return {
    childIds: children.map((node) => node.id as AnyNodeId),
    changes: {
      update,
      delete: [assemblyId],
    },
  }
}
