import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const CustomMeshVertex = z.object({
  id: z.string().min(1),
  position: z.tuple([z.number(), z.number(), z.number()]),
})

export const CustomMeshEdge = z.object({
  id: z.string().min(1),
  vertexIds: z.tuple([z.string().min(1), z.string().min(1)]),
})

export const CustomMeshFace = z.object({
  id: z.string().min(1),
  vertexIds: z.array(z.string().min(1)).min(3),
  materialSlot: z.string().min(1).default('body'),
})

const CustomMeshTopologyShape = z.object({
  vertices: z.array(CustomMeshVertex),
  edges: z.array(CustomMeshEdge),
  faces: z.array(CustomMeshFace),
})

export type CustomMeshVertex = z.infer<typeof CustomMeshVertex>
export type CustomMeshEdge = z.infer<typeof CustomMeshEdge>
export type CustomMeshFace = z.infer<typeof CustomMeshFace>
export type CustomMeshTopology = z.infer<typeof CustomMeshTopologyShape>

export type CustomMeshTopologyIssue = {
  path: (string | number)[]
  message: string
}

export const CUSTOM_MESH_BODY_MATERIAL_REF = 'library:concrete-drywall'

export function customMeshUndirectedEdgeKey(a: string, b: string) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

export function inspectCustomMeshTopology(topology: CustomMeshTopology): CustomMeshTopologyIssue[] {
  const issues: CustomMeshTopologyIssue[] = []
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
    const key = customMeshUndirectedEdgeKey(a, b)
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
      if (nextVertexId && !edgeKeys.has(customMeshUndirectedEdgeKey(vertexId, nextVertexId))) {
        issues.push({
          path: ['faces', index, 'vertexIds', vertexIndex],
          message: `Missing edge for face boundary: ${vertexId}–${nextVertexId}`,
        })
      }
    })
  })

  return issues
}

export const CustomMeshTopology = CustomMeshTopologyShape.superRefine((topology, context) => {
  for (const issue of inspectCustomMeshTopology(topology)) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export function createBoxCustomMeshTopology(
  width = 2,
  height = 2.4,
  depth = 2,
): CustomMeshTopology {
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

export const CustomMeshNode = BaseNode.extend({
  id: objectId('custom-mesh'),
  type: nodeType('custom-mesh'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  supportSlabId: z.string().optional(),
  topology: CustomMeshTopology.default(createBoxCustomMeshTopology),
  slots: z
    .record(z.string(), z.string())
    .default({})
    .transform(
      (slots): Record<string, string> => ({ body: CUSTOM_MESH_BODY_MATERIAL_REF, ...slots }),
    ),
}).describe(dedent`
  Custom mesh node - a topology-backed editable solid.
  - topology: persistent vertices, edges, and ordered face loops with stable IDs
  - position/rotation: level-local placement transform
  - supportSlabId: persisted placement surface that prevents later slabs from lifting the mesh
  - slots: material references keyed by face materialSlot; body always starts reusable
`)

export type CustomMeshNode = z.infer<typeof CustomMeshNode>
