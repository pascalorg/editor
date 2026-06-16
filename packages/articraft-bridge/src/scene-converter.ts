import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { BoxNode, CylinderNode, SphereNode } from '@pascal-app/core/schema'
import type {
  ArticraftJoint,
  ArticraftModelData,
  ArticraftVisual,
  SceneNodeResult,
  Vec3,
} from './types'

// ─── URDF → Editor coordinate helpers ──────────────────────────────────

/**
 * URDF uses x-forward, y-left, z-up (right-handed).
 * The editor uses x-right, y-up, z-forward (right-handed).
 *
 * Conversion: URDF (x, y, z) → Editor (x, y, z)
 *   editor.x =  urdf.x
 *   editor.y =  urdf.z
 *   editor.z = -urdf.y
 */
function urdfPosToEditor(pos: Vec3): Vec3 {
  return [pos[0], pos[2], -pos[1]]
}

/**
 * URDF RPY to editor Euler rotation.
 * URDF RPY: roll = x-axis, pitch = y-axis, yaw = z-axis
 * Editor: rotation[0] = pitch (x), rotation[1] = yaw (y), rotation[2] = roll (z)
 *
 * With coordinate conversion: editor pitch = urdf roll, editor yaw = urdf pitch, editor roll = urdf yaw
 * Actually, after swapping axes, the rotation conversion is complex.
 * For initial implementation, we approximate: the URDF RPY is "close" to editor Euler.
 */
function urdfRpyToEditorRotation(rpy: Vec3): Vec3 {
  // For first pass, apply the same axis remapping
  // Editor pitch = URDF roll (about editor X = URDF X)
  // Editor yaw = -URDF yaw (about editor Y = URDF Z, but negated)
  // Editor roll = URDF pitch (about editor Z = -URDF Y)
  return [rpy[0], rpy[2], -rpy[1]]
}

function urdfAxisToEditor(axis: Vec3): Vec3 {
  return urdfPosToEditor(axis)
}

// ─── Visual → Editor node converters ───────────────────────────────────

function visualToBoxNode(
  visual: ArticraftVisual,
  linkName: string,
  materialPreset?: string,
): ReturnType<typeof BoxNode.parse> {
  const size = visual.geometry.params
  return BoxNode.parse({
    name: visual.name ?? linkName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    length: size.length ?? size.sx ?? 1.0,
    width: size.width ?? size.sz ?? 1.0,
    height: size.height ?? size.sy ?? 1.0,
    materialPreset,
  })
}

function visualToCylinderNode(
  visual: ArticraftVisual,
  linkName: string,
  materialPreset?: string,
): ReturnType<typeof CylinderNode.parse> {
  const size = visual.geometry.params
  return CylinderNode.parse({
    name: visual.name ?? linkName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    radius: size.radius ?? 0.5,
    height: size.length ?? size.height ?? 1.0,
    materialPreset,
  })
}

function visualToSphereNode(
  visual: ArticraftVisual,
  linkName: string,
  materialPreset?: string,
): ReturnType<typeof SphereNode.parse> {
  const size = visual.geometry.params
  return SphereNode.parse({
    name: visual.name ?? linkName,
    position: urdfPosToEditor(visual.origin.xyz),
    rotation: urdfRpyToEditorRotation(visual.origin.rpy),
    radius: size.radius ?? 0.5,
    materialPreset,
  })
}

function visualToPrimitiveNode(
  visual: ArticraftVisual,
  linkName: string,
  materialPreset?: string,
): AnyNode | null {
  const geomType = visual.geometry.type
  try {
    switch (geomType) {
      case 'box':
        return visualToBoxNode(visual, linkName, materialPreset)
      case 'cylinder':
        return visualToCylinderNode(visual, linkName, materialPreset)
      case 'sphere':
        return visualToSphereNode(visual, linkName, materialPreset)
      default:
        return null
    }
  } catch {
    return null
  }
}

// ─── Joint metadata ────────────────────────────────────────────────────

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

// ─── Main converter ────────────────────────────────────────────────────

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

/**
 * Convert Articraft model data into editor scene node specs.
 *
 * Strategy:
 * - Each link becomes a "link group" represented by one or more nodes.
 * - Primitives (box/cylinder/sphere) are converted to editor primitive nodes.
 * - Mesh visuals are converted as best-effort primitive approximations; unsupported
 *   mesh visuals still use tiny placeholders until per-link mesh import exists.
 * - Joint metadata is attached to the child link's nodes when articulationMode is true.
 * - Links without a parent joint become "root" nodes.
 * - Parent-child relationships are stored via parentId.
 *
 * Returns node specs ready to be created via the SceneBridge.
 * The caller is responsible for creating the nodes and can then update
 * their metadata with the jointMetadata map.
 */
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

  // Build child → parent map from joints
  const parentLinkByChild = new Map<string, string>()
  for (const joint of data.joints) {
    parentLinkByChild.set(joint.child, joint.parent)
  }

  // Create nodes for each link
  for (const link of data.links) {
    const parentLink = parentLinkByChild.get(link.name)
    if (!parentLink) {
      rootLinks.push(link.name)
    }

    // Convert each visual to a node
    for (let vi = 0; vi < link.visuals.length; vi++) {
      const visual = link.visuals[vi]!
      const nodeName = link.visuals.length > 1 ? `${link.name}_v${vi}` : link.name

      const materialPreset = visual.material?.name ?? options.materialPreset

      let node: AnyNode | null = null

      if (visual.geometry.type === 'mesh') {
        const p = visual.geometry.params
        if (p.radius !== undefined && (p.length !== undefined || p.height !== undefined)) {
          node = visualToPrimitiveNode(
            { ...visual, geometry: { ...visual.geometry, type: 'cylinder' } },
            nodeName,
            materialPreset,
          )
        } else if (p.size !== undefined || p.length !== undefined || p.sx !== undefined) {
          node = visualToPrimitiveNode(
            { ...visual, geometry: { ...visual.geometry, type: 'box' } },
            nodeName,
            materialPreset,
          )
        } else {
          node = visualToPrimitiveNode(
            { ...visual, geometry: { ...visual.geometry, type: 'sphere', params: { radius: 0.05 } } },
            nodeName,
            materialPreset,
          )
        }
      } else {
        node = visualToPrimitiveNode(visual, nodeName, materialPreset)
      }

      if (node) {
        // Store mesh reference in metadata for future GLB import
        if (visual.geometry.meshPath) {
          node.metadata = {
            ...(node.metadata as Record<string, unknown>),
            articraftMeshPath: visual.geometry.meshPath,
          }
        }
        nodes.push(node)
        // Map first visual node as the canonical link representative
        if (!nodeIdByLink.has(link.name)) {
          nodeIdByLink.set(link.name, node.id)
        }
      }
    }

    // If no visuals produced a valid node, create a small placeholder so joint metadata can still attach.
    if (!nodeIdByLink.has(link.name)) {
      const placeholder = SphereNode.parse({
        name: link.name,
        position: [0, 0, 0],
        radius: 0.05,
        materialPreset: options.materialPreset,
      })
      nodes.push(placeholder)
      nodeIdByLink.set(link.name, placeholder.id)
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

/**
 * Create all nodes from the converted articraft data via the scene bridge.
 *
 * This is the main entry point for placing an articraft-generated model
 * onto the editor canvas. It handles:
 * 1. Converting articraft data to editor nodes
 * 2. Resolving parent-child relationships
 * 3. Creating all nodes through the scene bridge
 * 4. Returning the result with node IDs and joint metadata
 */
export function createModelNodes(
  data: ArticraftModelData,
  createNode: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId,
  options: ConvertOptions,
): SceneNodeResult {
  const { nodes, nodeIdByLink, jointMetadata } = convertToSceneNodes(data, options)

  const createdIds: string[] = []
  const rootNodeIds: string[] = []
  const createdNodeIdByLink = new Map<string, string>()
  const rootLinkIds = new Set<string>()
  const pending: Array<{ linkName: string; node: AnyNode }> = []

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

  // First pass: create nodes for links that have no parent or whose parent is a root
  for (const node of nodes) {
    const linkName = inferLinkName(node, data)
    if (!linkName) {
      // Can't determine link → create as standalone
      const id = createNode(node, options.parentId as AnyNodeId | undefined)
      createdIds.push(id as string)
      continue
    }

    const parentJoint = data.joints.find((j) => j.child === linkName)
    if (!parentJoint) {
      // Root link → create directly
      const nodeWithOffset = withRootOffset(node)
      const id = createNode(nodeWithOffset, options.parentId as AnyNodeId | undefined)
      createdIds.push(id as string)
      rememberCreatedLinkNode(linkName, nodeWithOffset, id)
      if (!rootLinkIds.has(linkName)) {
        rootNodeIds.push(id as string)
        rootLinkIds.add(linkName)
      }
    } else {
      // Child link → defer creation until parent is created
      pending.push({ linkName, node })
    }
  }

  // Second pass: create deferred nodes with their parent IDs
  // Repeat until all created (handles chains of arbitrary depth)
  let remaining = pending
  let iterations = 0
  const maxIterations = data.links.length + 1

  while (remaining.length > 0 && iterations < maxIterations) {
    iterations++
    const stillPending: typeof pending = []

    for (const { linkName, node } of remaining) {
      const parentJoint = data.joints.find((j) => j.child === linkName)
      if (!parentJoint) {
        // Shouldn't happen, but handle gracefully
        const id = createNode(node, options.parentId as AnyNodeId | undefined)
        createdIds.push(id as string)
        continue
      }

      const parentNodeId = createdNodeIdByLink.get(parentJoint.parent)
      if (parentNodeId) {
        const id = createNode(node, parentNodeId as AnyNodeId)
        createdIds.push(id as string)
        rememberCreatedLinkNode(linkName, node, id)
      } else {
        stillPending.push({ linkName, node })
      }
    }

    if (stillPending.length === remaining.length) {
      // No progress — create remaining as roots to avoid infinite loop
      for (const { linkName, node } of stillPending) {
        const id = createNode(node, options.parentId as AnyNodeId | undefined)
        createdIds.push(id as string)
        rememberCreatedLinkNode(linkName, node, id)
        if (!rootLinkIds.has(linkName)) {
          rootNodeIds.push(id as string)
          rootLinkIds.add(linkName)
        }
      }
      break
    }
    remaining = stillPending
  }

  return { nodeIds: createdIds, rootNodeIds, jointMetadata }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function inferLinkName(node: AnyNode, data: ArticraftModelData): string | null {
  const nodeName = node.name
  if (!nodeName) return null

  for (const link of data.links) {
    if (link.name === nodeName) return link.name
    // Check if node name starts with link name (for multi-visual links)
    for (let vi = 0; vi < link.visuals.length; vi++) {
      if (nodeName === `${link.name}_v${vi}`) return link.name
    }
  }
  return null
}
