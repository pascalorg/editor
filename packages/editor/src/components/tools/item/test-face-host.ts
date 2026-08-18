import {
  BlockNode,
  type BlockNode as BlockNodeType,
  type FaceHostCapability,
  type ItemNode,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'

const faceForHit = (object: unknown, faceIndex = 0) => {
  const geometry = (object as { geometry?: { userData?: Record<string, unknown> } }).geometry
  const faces = geometry?.userData?.blockFaces
  if (!Array.isArray(faces)) return null
  return (
    faces.find((face) => {
      if (!face || typeof face !== 'object') return false
      const entry = face as { start?: number; count?: number }
      return (
        typeof entry.start === 'number' &&
        typeof entry.count === 'number' &&
        faceIndex * 3 >= entry.start &&
        faceIndex * 3 < entry.start + entry.count
      )
    }) as { faceId?: string } | undefined
  )?.faceId
}

const testFaceHost: FaceHostCapability<BlockNodeType> = {
  currentFaceId: (item) => item?.blockFaceId ?? null,
  clearItemFields: ['position', 'rotation', 'blockFaceId'],
  resolvePlacement: ({ asset, currentFaceId, faceIndex, host, localPosition, object }) => {
    const hitFaceId = faceForHit(object, faceIndex) ?? null
    const faceId = currentFaceId ?? hitFaceId
    if (!faceId) return null

    if (faceId === 'f-front') {
      if (asset.attachTo !== 'wall-side' || localPosition[2] > -0.75) return null
      return {
        cursorPosition: [localPosition[0], localPosition[1], -1],
        position: [localPosition[0], localPosition[1], -1],
        rotation: [0, 0, 0],
        cursorRotation: [0, 0, 0],
        faceId,
        nodeUpdate: {
          parentId: host.id,
          blockFaceId: faceId,
          position: [localPosition[0], localPosition[1], 0],
          rotation: [0, 0, 0],
        },
      }
    }

    if (faceId === 'f-bottom') {
      if (asset.attachTo !== 'ceiling') return null
      return {
        cursorPosition: [0, -0.25, 0],
        position: [0, 0, 0.25],
        rotation: [-Math.PI / 2, 0, 0],
        cursorRotation: [-Math.PI / 2, 0, 0],
        faceId,
        nodeUpdate: {
          parentId: host.id,
          blockFaceId: faceId,
          position: [0, 0, 0.25],
          rotation: [-Math.PI / 2, 0, 0],
        },
      }
    }

    if (faceId === 'f-top') {
      if (asset.attachTo) return null
      return {
        cursorPosition: [0, 2.4, 0],
        position: [0, 2.4, 0],
        rotation: [Math.PI / 2, 0, 0],
        cursorRotation: [Math.PI / 2, 0, 0],
        faceId,
        nodeUpdate: {
          parentId: host.id,
          blockFaceId: faceId,
          position: [0, 0, 0],
          rotation: [Math.PI / 2, 0, 0],
        },
      }
    }

    return null
  },
  storedPlacementPatch: ({ host, item, position }) => {
    if (!item.blockFaceId) return null
    return {
      parentId: host.id,
      blockFaceId: item.blockFaceId,
      position: [position[0], position[1], position[2]],
      rotation: item.rotation,
      roofSegmentId: undefined,
      roofFace: undefined,
      wallId: undefined,
      side: 'front',
    } satisfies Partial<ItemNode>
  },
  isStoredPlacementValid: ({ item }) => Boolean(item.blockFaceId),
}

export function registerTestBlockFaceHost() {
  // The registry is a module singleton shared across test files, and other
  // suites register their own minimal `block` (the wall drafting stub is
  // floor-placed only). Skipping on name alone would leave that capability-less
  // definition in place, so replace it unless it already hosts faces.
  if (nodeRegistry.get('block')?.capabilities?.faceHost) return
  if (nodeRegistry.has('block')) nodeRegistry._reset()
  registerNode({
    kind: 'block',
    schemaVersion: 1,
    schema: BlockNode,
    category: 'structure',
    defaults: () => BlockNode.parse({ id: 'block_test', parentId: null }) as never,
    capabilities: { faceHost: testFaceHost },
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as never)
}
