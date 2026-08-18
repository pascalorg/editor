import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ItemNode } from './item'

export const BlockVertex = z.object({
  id: z.string().min(1),
  position: z.tuple([z.number(), z.number(), z.number()]),
})

export const BlockEdge = z.object({
  id: z.string().min(1),
  vertexIds: z.tuple([z.string().min(1), z.string().min(1)]),
})

export const BlockFace = z.object({
  id: z.string().min(1),
  vertexIds: z.array(z.string().min(1)).min(3),
  materialSlot: z.string().min(1).default('body'),
})

const BlockTopologyShape = z.object({
  vertices: z.array(BlockVertex),
  edges: z.array(BlockEdge),
  faces: z.array(BlockFace),
})

export type BlockVertex = z.infer<typeof BlockVertex>
export type BlockEdge = z.infer<typeof BlockEdge>
export type BlockFace = z.infer<typeof BlockFace>
export type BlockTopology = z.infer<typeof BlockTopologyShape>

export type BlockFaceFrame = {
  origin: [number, number, number]
  xAxis: [number, number, number]
  yAxis: [number, number, number]
  normal: [number, number, number]
}

function normalizeBlockVector(vector: [number, number, number]): [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length < 1e-8) return null
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

export function getBlockFaceNormal(
  topology: BlockTopology,
  face: BlockFace,
): [number, number, number] | null {
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const positions = face.vertexIds
    .map((id) => vertices.get(id))
    .filter((value): value is [number, number, number] => !!value)
  if (positions.length < 3) return null

  const normal: [number, number, number] = [0, 0, 0]
  for (let index = 0; index < positions.length; index += 1) {
    const current = positions[index]!
    const next = positions[(index + 1) % positions.length]!
    normal[0] += (current[1] - next[1]) * (current[2] + next[2])
    normal[1] += (current[2] - next[2]) * (current[0] + next[0])
    normal[2] += (current[0] - next[0]) * (current[1] + next[1])
  }
  return normalizeBlockVector(normal)
}

export function getBlockFaceCentroid(
  topology: BlockTopology,
  face: BlockFace,
): [number, number, number] | null {
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const positions = face.vertexIds
    .map((id) => vertices.get(id))
    .filter((value): value is [number, number, number] => !!value)
  if (positions.length !== face.vertexIds.length || positions.length === 0) return null
  const sum = positions.reduce<[number, number, number]>(
    (total, position) => [total[0] + position[0], total[1] + position[1], total[2] + position[2]],
    [0, 0, 0],
  )
  return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length]
}

export function getBlockFaceFrame(topology: BlockTopology, faceId: string): BlockFaceFrame | null {
  const face = topology.faces.find((candidate) => candidate.id === faceId)
  if (!face) return null
  const origin = getBlockFaceCentroid(topology, face)
  const normal = getBlockFaceNormal(topology, face)
  if (!(origin && normal)) return null

  const horizontal: [number, number, number] = [normal[2], 0, -normal[0]]
  const xAxis =
    normalizeBlockVector(horizontal) ??
    normalizeBlockVector([
      1 - normal[0] * normal[0],
      -normal[0] * normal[1],
      -normal[0] * normal[2],
    ])
  if (!xAxis) return null
  const yAxis = normalizeBlockVector([
    normal[1] * xAxis[2] - normal[2] * xAxis[1],
    normal[2] * xAxis[0] - normal[0] * xAxis[2],
    normal[0] * xAxis[1] - normal[1] * xAxis[0],
  ])
  if (!yAxis) return null
  return { origin, xAxis, yAxis, normal }
}

export type BlockTopologyIssue = {
  path: (string | number)[]
  message: string
}

export function blockUndirectedEdgeKey(a: string, b: string) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

export function inspectBlockTopology(topology: BlockTopology): BlockTopologyIssue[] {
  const issues: BlockTopologyIssue[] = []
  const vertexIds = new Set<string>()
  const edgeIds = new Set<string>()
  const faceIds = new Set<string>()
  const edgeKeys = new Set<string>()

  topology.vertices.forEach((vertex, index) => {
    if (vertexIds.has(vertex.id)) {
      issues.push({ path: ['vertices', index, 'id'], message: `Duplicate vertex id: ${vertex.id}` })
    }
    vertexIds.add(vertex.id)
  })

  topology.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      issues.push({ path: ['edges', index, 'id'], message: `Duplicate edge id: ${edge.id}` })
    }
    edgeIds.add(edge.id)
    const [a, b] = edge.vertexIds
    if (a === b) {
      issues.push({ path: ['edges', index, 'vertexIds'], message: 'An edge needs two vertices' })
    }
    edge.vertexIds.forEach((vertexId, vertexIndex) => {
      if (!vertexIds.has(vertexId)) {
        issues.push({
          path: ['edges', index, 'vertexIds', vertexIndex],
          message: `Unknown vertex id: ${vertexId}`,
        })
      }
    })
    const key = blockUndirectedEdgeKey(a, b)
    if (edgeKeys.has(key)) {
      issues.push({ path: ['edges', index], message: `Duplicate edge: ${a}–${b}` })
    }
    edgeKeys.add(key)
  })

  topology.faces.forEach((face, index) => {
    if (faceIds.has(face.id)) {
      issues.push({ path: ['faces', index, 'id'], message: `Duplicate face id: ${face.id}` })
    }
    faceIds.add(face.id)
    if (new Set(face.vertexIds).size < 3) {
      issues.push({ path: ['faces', index, 'vertexIds'], message: 'A face needs three vertices' })
    }
    face.vertexIds.forEach((vertexId, vertexIndex) => {
      if (!vertexIds.has(vertexId)) {
        issues.push({
          path: ['faces', index, 'vertexIds', vertexIndex],
          message: `Unknown vertex id: ${vertexId}`,
        })
      }
      const nextVertexId = face.vertexIds[(vertexIndex + 1) % face.vertexIds.length]
      if (nextVertexId && !edgeKeys.has(blockUndirectedEdgeKey(vertexId, nextVertexId))) {
        issues.push({
          path: ['faces', index, 'vertexIds', vertexIndex],
          message: `Missing edge for face boundary: ${vertexId}–${nextVertexId}`,
        })
      }
    })
  })

  return issues
}

export const BlockTopology = BlockTopologyShape.superRefine((topology, context) => {
  for (const issue of inspectBlockTopology(topology)) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export function createBoxBlockTopology(width = 2, height = 2.4, depth = 2): BlockTopology {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  return {
    vertices: [
      { id: 'v0', position: [-halfWidth, 0, -halfDepth] },
      { id: 'v1', position: [halfWidth, 0, -halfDepth] },
      { id: 'v2', position: [halfWidth, 0, halfDepth] },
      { id: 'v3', position: [-halfWidth, 0, halfDepth] },
      { id: 'v4', position: [-halfWidth, height, -halfDepth] },
      { id: 'v5', position: [halfWidth, height, -halfDepth] },
      { id: 'v6', position: [halfWidth, height, halfDepth] },
      { id: 'v7', position: [-halfWidth, height, halfDepth] },
    ],
    edges: [
      { id: 'e0', vertexIds: ['v0', 'v1'] },
      { id: 'e1', vertexIds: ['v1', 'v2'] },
      { id: 'e2', vertexIds: ['v2', 'v3'] },
      { id: 'e3', vertexIds: ['v3', 'v0'] },
      { id: 'e4', vertexIds: ['v4', 'v5'] },
      { id: 'e5', vertexIds: ['v5', 'v6'] },
      { id: 'e6', vertexIds: ['v6', 'v7'] },
      { id: 'e7', vertexIds: ['v7', 'v4'] },
      { id: 'e8', vertexIds: ['v0', 'v4'] },
      { id: 'e9', vertexIds: ['v1', 'v5'] },
      { id: 'e10', vertexIds: ['v2', 'v6'] },
      { id: 'e11', vertexIds: ['v3', 'v7'] },
    ],
    faces: [
      { id: 'f-bottom', vertexIds: ['v0', 'v1', 'v2', 'v3'], materialSlot: 'body' },
      { id: 'f-top', vertexIds: ['v4', 'v7', 'v6', 'v5'], materialSlot: 'body' },
      { id: 'f-front', vertexIds: ['v0', 'v4', 'v5', 'v1'], materialSlot: 'body' },
      { id: 'f-right', vertexIds: ['v1', 'v5', 'v6', 'v2'], materialSlot: 'body' },
      { id: 'f-back', vertexIds: ['v2', 'v6', 'v7', 'v3'], materialSlot: 'body' },
      { id: 'f-left', vertexIds: ['v3', 'v7', 'v4', 'v0'], materialSlot: 'body' },
    ],
  }
}

export const BlockNode = BaseNode.extend({
  id: objectId('block'),
  type: nodeType('block'),
  children: z.array(ItemNode.shape.id).default([]),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  supportSlabId: z.string().optional(),
  topology: BlockTopology.default(createBoxBlockTopology),
  slots: z.record(z.string(), z.string()).default({}),
  slotNames: z.record(z.string(), z.string().min(1)).default({ body: 'Body' }),
}).describe(dedent`
  block node - a topology-backed editable solid.
  - children: items hosted on persistent topology faces
  - topology: persistent vertices, edges, and ordered face loops with stable IDs
  - position/rotation: level-local placement transform
  - supportSlabId: persisted placement surface that prevents later slabs from lifting the mesh
  - slots: material references keyed by face materialSlot; an unbound body uses the wall-role default
  - slotNames: user-facing names for stable material slots; body is the permanent default slot
`)

export type BlockNode = z.infer<typeof BlockNode>
