import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { AssemblyNode, BoxNode, CylinderNode, SphereNode } from '@pascal-app/core/schema'
import type {
  ArticraftJoint,
  ArticraftModelData,
  ArticraftVisual,
  SceneNodeResult,
  Vec3,
  Vec4,
} from './types'

type BridgeNodeRole = 'link' | 'visual'

type BridgeNodeInfo = {
  role?: BridgeNodeRole
  linkName?: string
  parentLink?: string | null
}

type BridgeNodeMetadata = Record<string, unknown> & {
  articraftBridge?: BridgeNodeInfo
}

function urdfPosToEditor(pos: Vec3): Vec3 {
  return [pos[0], pos[2], -pos[1]]
}

function urdfRpyToEditorRotation(rpy: Vec3): Vec3 {
  return [rpy[0], rpy[2], -rpy[1]]
}

function urdfAxisToEditor(axis: Vec3): Vec3 {
  return urdfPosToEditor(axis)
}

function toByte(value: number) {
  const normalized = value <= 1 ? value * 255 : value
  return Math.max(0, Math.min(255, Math.round(normalized)))
}

function rgbaToHex(rgba: Vec4): string {
  return `#${[rgba[0], rgba[1], rgba[2]]
    .map((value) => toByte(value).toString(16).padStart(2, '0'))
    .join('')}`
}

function materialFromVisual(visual: ArticraftVisual) {
  if (!visual.material) return undefined
  const opacity = Number.isFinite(visual.material.rgba[3]) ? visual.material.rgba[3] : 1
  return {
    preset: 'custom' as const,
    properties: {
      color: rgbaToHex(visual.material.rgba),
      roughness: 0.45,
      metalness: /metal|steel|iron|aluminum|aluminium|chrome/i.test(visual.material.name)
        ? 0.75
        : 0,
      opacity,
      transparent: opacity < 1,
      side: 'front' as const,
    },
  }
}

function bridgeMetadata(
  role: BridgeNodeRole,
  linkName: string,
  parentLink?: string | null,
): BridgeNodeMetadata {
  return {
    articraftBridge: {
      role,
      linkName,
      parentLink: parentLink ?? null,
    },
  }
}

function readBridgeInfo(node: AnyNode): BridgeNodeInfo | null {
  const metadata = (node.metadata ?? {}) as BridgeNodeMetadata
  const bridge = metadata.articraftBridge
  if (!bridge || typeof bridge.linkName !== 'string') return null
  return bridge
}

function visualToBoxNode(
  visual: ArticraftVisual,
  nodeName: string,
  metadata: BridgeNodeMetadata,
  materialPreset?: string,
): ReturnType<typeof BoxNode.parse> {
  const size = visual.geometry.params
  return BoxNode.parse({
    name: nodeName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    length: size.length ?? size.sx ?? 1.0,
    width: size.width ?? size.sy ?? 1.0,
    height: size.height ?? size.sz ?? 1.0,
    material: materialFromVisual(visual),
    materialPreset,
    metadata,
  })
}

function visualToCylinderNode(
  visual: ArticraftVisual,
  nodeName: string,
  metadata: BridgeNodeMetadata,
  materialPreset?: string,
): ReturnType<typeof CylinderNode.parse> {
  const size = visual.geometry.params
  return CylinderNode.parse({
    name: nodeName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    radius: size.radius ?? 0.5,
    height: size.length ?? size.height ?? 1.0,
    material: materialFromVisual(visual),
    materialPreset,
    metadata,
  })
}

function visualToSphereNode(
  visual: ArticraftVisual,
  nodeName: string,
  metadata: BridgeNodeMetadata,
  materialPreset?: string,
): ReturnType<typeof SphereNode.parse> {
  const size = visual.geometry.params
  return SphereNode.parse({
    name: nodeName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    radius: size.radius ?? 0.5,
    material: materialFromVisual(visual),
    materialPreset,
    metadata,
  })
}

function visualToPrimitiveNode(
  visual: ArticraftVisual,
  nodeName: string,
  metadata: BridgeNodeMetadata,
  materialPreset?: string,
): AnyNode | null {
  const geomType = visual.geometry.type
  try {
    switch (geomType) {
      case 'box':
        return visualToBoxNode(visual, nodeName, metadata, materialPreset)
      case 'cylinder':
        return visualToCylinderNode(visual, nodeName, metadata, materialPreset)
      case 'sphere':
        return visualToSphereNode(visual, nodeName, metadata, materialPreset)
      default:
        return null
    }
  } catch {
    return null
  }
}

function buildJointMetadata(joint: ArticraftJoint): SceneNodeResult['jointMetadata'][string] {
  return {
    jointName: joint.name,
    jointType: joint.type,
    parentLink: joint.parent,
    childLink: joint.child,
    axis: urdfAxisToEditor(joint.axis),
    origin: {
      xyz: urdfPosToEditor(joint.origin.xyz),
      rpy: urdfRpyToEditorRotation(joint.origin.rpy),
    },
    limits: joint.limits,
    mimic: joint.mimic,
    currentValue: 0,
  }
}

interface ConvertOptions {
  /** Create joint metadata on nodes (for property panel controls) */
  articulationMode: boolean
  /** Optional material preset to apply to all primitives */
  materialPreset?: string
  /** Optional level/site parent ID for the root nodes */
  parentId?: string
  /** Optional position offset applied to root link nodes when converting a placed asset */
  rootPosition?: Vec3
}

export function convertToSceneNodes(
  data: ArticraftModelData,
  options: ConvertOptions,
): {
  nodes: AnyNode[]
  nodeIdByLink: Map<string, string>
  jointMetadata: SceneNodeResult['jointMetadata']
  rootLinks: string[]
} {
  const nodes: AnyNode[] = []
  const nodeIdByLink = new Map<string, string>()
  const jointMetadata: SceneNodeResult['jointMetadata'] = {}
  const rootLinks: string[] = []

  const jointByChild = new Map<string, ArticraftJoint>()
  for (const joint of data.joints) {
    jointByChild.set(joint.child, joint)
  }

  for (const link of data.links) {
    const parentJoint = jointByChild.get(link.name)
    const parentLink = parentJoint?.parent ?? null
    if (!parentLink) rootLinks.push(link.name)

    const linkFrame = AssemblyNode.parse({
      name: link.name,
      position: parentJoint ? urdfPosToEditor(parentJoint.origin.xyz) : [0, 0, 0],
      rotation: parentJoint ? urdfRpyToEditorRotation(parentJoint.origin.rpy) : [0, 0, 0],
      metadata: bridgeMetadata('link', link.name, parentLink),
    })
    nodes.push(linkFrame)
    nodeIdByLink.set(link.name, linkFrame.id)

    for (let vi = 0; vi < link.visuals.length; vi++) {
      const visual = link.visuals[vi]!
      const nodeName = link.visuals.length > 1 ? `${link.name}_v${vi}` : `${link.name}_visual`
      const materialPreset = visual.material?.name ?? options.materialPreset
      const metadata = bridgeMetadata('visual', link.name, parentLink)

      let node: AnyNode | null = null
      if (visual.geometry.type === 'mesh') {
        const p = visual.geometry.params
        if (p.radius !== undefined && (p.length !== undefined || p.height !== undefined)) {
          node = visualToPrimitiveNode(
            { ...visual, geometry: { ...visual.geometry, type: 'cylinder' } },
            nodeName,
            metadata,
            materialPreset,
          )
        } else if (p.size !== undefined || p.length !== undefined || p.sx !== undefined) {
          node = visualToPrimitiveNode(
            { ...visual, geometry: { ...visual.geometry, type: 'box' } },
            nodeName,
            metadata,
            materialPreset,
          )
        } else if (!visual.geometry.meshPath) {
          node = visualToPrimitiveNode(
            {
              ...visual,
              geometry: { ...visual.geometry, type: 'sphere', params: { radius: 0.05 } },
            },
            nodeName,
            metadata,
            materialPreset,
          )
        }
      } else {
        node = visualToPrimitiveNode(visual, nodeName, metadata, materialPreset)
      }

      if (node) {
        if (visual.geometry.meshPath) {
          node.metadata = {
            ...((node.metadata as Record<string, unknown>) ?? {}),
            articraftMeshPath: visual.geometry.meshPath,
          }
        }
        nodes.push(node)
      }
    }
  }

  if (options.articulationMode) {
    for (const joint of data.joints) {
      const childNodeId = nodeIdByLink.get(joint.child)
      if (childNodeId && nodeIdByLink.has(joint.parent)) {
        jointMetadata[childNodeId] = buildJointMetadata(joint)
      }
    }
  }

  return { nodes, nodeIdByLink, jointMetadata, rootLinks }
}

export function createModelNodes(
  data: ArticraftModelData,
  createNode: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId,
  options: ConvertOptions,
): SceneNodeResult {
  const { nodes, nodeIdByLink, jointMetadata } = convertToSceneNodes(data, options)

  const createdIds: string[] = []
  const rootNodeIds: string[] = []
  const createdNodeIdByLink = new Map<string, string>()

  const rememberCreatedLinkNode = (linkName: string, node: AnyNode, id: AnyNodeId) => {
    if (nodeIdByLink.get(linkName) === node.id) {
      createdNodeIdByLink.set(linkName, id as string)
    }
  }

  const withRootOffset = (node: AnyNode): AnyNode => {
    if (!options.rootPosition) return node
    const position = (node as { position?: unknown }).position
    if (!Array.isArray(position) || position.length < 3) return node
    return {
      ...node,
      position: [
        Number(position[0] ?? 0) + options.rootPosition[0],
        Number(position[1] ?? 0) + options.rootPosition[1],
        Number(position[2] ?? 0) + options.rootPosition[2],
      ],
    } as AnyNode
  }

  const linkNodes = nodes.filter((node) => readBridgeInfo(node)?.role === 'link')
  const visualNodes = nodes.filter((node) => readBridgeInfo(node)?.role === 'visual')
  const otherNodes = nodes.filter((node) => !readBridgeInfo(node))

  let remaining = linkNodes
  let iterations = 0
  const maxIterations = data.links.length + 1

  while (remaining.length > 0 && iterations < maxIterations) {
    iterations++
    const stillPending: AnyNode[] = []

    for (const node of remaining) {
      const bridge = readBridgeInfo(node)
      if (!bridge?.linkName) continue

      const parentLink = typeof bridge.parentLink === 'string' ? bridge.parentLink : null
      const parentNodeId = parentLink ? createdNodeIdByLink.get(parentLink) : null
      if (!parentLink || parentNodeId) {
        const nodeToCreate = parentLink ? node : withRootOffset(node)
        const id = createNode(
          nodeToCreate,
          (parentNodeId ?? options.parentId) as AnyNodeId | undefined,
        )
        createdIds.push(id as string)
        rememberCreatedLinkNode(bridge.linkName, nodeToCreate, id)
        if (!parentLink) rootNodeIds.push(id as string)
      } else {
        stillPending.push(node)
      }
    }

    if (stillPending.length === remaining.length) {
      for (const node of stillPending) {
        const bridge = readBridgeInfo(node)
        if (!bridge?.linkName) continue
        const id = createNode(node, options.parentId as AnyNodeId | undefined)
        createdIds.push(id as string)
        rememberCreatedLinkNode(bridge.linkName, node, id)
        rootNodeIds.push(id as string)
      }
      break
    }
    remaining = stillPending
  }

  for (const node of visualNodes) {
    const bridge = readBridgeInfo(node)
    const parentNodeId = bridge?.linkName ? createdNodeIdByLink.get(bridge.linkName) : null
    const id = createNode(node, parentNodeId as AnyNodeId | undefined)
    createdIds.push(id as string)
  }

  for (const node of otherNodes) {
    const id = createNode(node, options.parentId as AnyNodeId | undefined)
    createdIds.push(id as string)
  }

  return { nodeIds: createdIds, rootNodeIds, jointMetadata }
}
