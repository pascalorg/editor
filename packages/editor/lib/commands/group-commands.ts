import type { SceneGraph } from '@/lib/scenegraph'
import type { AnyNode, AnyNodeId, GroupNode } from '@/lib/scenegraph/schema'
import { createId } from '@/lib/utils'
import type { Command } from './scenegraph-commands'

// Helper to get position from any node type
function getNodePosition(node: AnyNode): { x: number; y: number } {
  if ('position' in node && Array.isArray(node.position)) {
    // Most nodes (Item, Group, etc.)
    return { x: node.position[0], y: node.position[1] }
  }
  // Fallback for nodes that might not have position in the future or handle differently
  // WallNode currently has position (legacy) and start/end.
  // We use position as the "origin" for the group transform.
  return { x: 0, y: 0 }
}

export class GroupNodesCommand implements Command {
  private readonly groupNodeId: string
  private readonly selectedNodeIds: string[]
  // Store original state for undo
  private readonly originalNodes: { node: AnyNode; parentId: string }[] = []

  constructor(selectedNodeIds: string[]) {
    this.selectedNodeIds = selectedNodeIds
    this.groupNodeId = createId('group')
  }

  getGroupNodeId(): string {
    return this.groupNodeId
  }

  execute(graph: SceneGraph): void {
    if (this.selectedNodeIds.length === 0) return

    const nodesToGroup: AnyNode[] = []
    let commonParentId: string | null = null

    // 1. Validate and Collect Nodes
    for (const id of this.selectedNodeIds) {
      const handle = graph.getNodeById(id as AnyNodeId)
      if (!handle) continue

      const node = handle.data()
      const parent = handle.parent()

      if (!parent) continue // Should not happen for groupable nodes (root/site/building/level not groupable)

      if (commonParentId === null) {
        commonParentId = parent.id
      } else if (commonParentId !== parent.id) {
        console.warn('Cannot group nodes from different parents')
        return
      }

      // Check for disallowed types
      if (['level', 'building', 'site'].includes(node.type)) {
        console.warn(`Cannot group node of type ${node.type}`)
        return
      }

      nodesToGroup.push(node)
      this.originalNodes.push({ node: JSON.parse(JSON.stringify(node)), parentId: parent.id })
    }

    if (!commonParentId || nodesToGroup.length === 0) return

    // 2. Calculate Group Center
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY

    for (const node of nodesToGroup) {
      const pos = getNodePosition(node)
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x)
      maxY = Math.max(maxY, pos.y)
    }

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // 3. Create Group Node
    const groupNode: GroupNode = {
      id: this.groupNodeId as GroupNode['id'],
      type: 'group',
      children: [], // Will add children manually
      position: [centerX, centerY],
      rotation: 0,
      object: 'node',
      parentId: commonParentId,
      visible: true,
      opacity: 100,
      metadata: {},
    }

    // Add group to common parent
    graph.nodes.create(groupNode, commonParentId as AnyNodeId)

    // 4. Move Nodes to Group and adjust positions
    for (const node of nodesToGroup) {
      // Remove from old location
      graph.deleteNode(node.id)

      // Calculate new relative position
      const oldPos = getNodePosition(node)
      const newX = oldPos.x - centerX
      const newY = oldPos.y - centerY

      const updatedNode = { ...node }

      if ('position' in updatedNode && Array.isArray(updatedNode.position)) {
        ;(updatedNode as any).position = [newX, newY, updatedNode.position[2] || 0].slice(
          0,
          updatedNode.position.length,
        )
      }

      // Update parentId to point to the group
      updatedNode.parentId = this.groupNodeId

      // Add to group
      graph.nodes.create(updatedNode, this.groupNodeId as AnyNodeId)
    }
  }

  undo(graph: SceneGraph): void {
    // 1. Delete the group node (and its children currently in the graph)
    // Note: deleteNode deletes the subtree.
    graph.deleteNode(this.groupNodeId as AnyNodeId)

    // 2. Restore original nodes to their original parents
    for (const { node, parentId } of this.originalNodes) {
      // Create restores the node with its original ID and data (including absolute position)
      graph.nodes.create(node, parentId as AnyNodeId)
    }
  }
}

export class UngroupNodesCommand implements Command {
  private readonly groupNodeId: string
  private originalGroupNode: GroupNode | null = null
  private originalChildren: AnyNode[] = []
  private parentId: string | null = null

  constructor(groupNodeId: string) {
    this.groupNodeId = groupNodeId
  }

  execute(graph: SceneGraph): void {
    const groupHandle = graph.getNodeById(this.groupNodeId as AnyNodeId)
    if (!groupHandle) return

    const groupNode = groupHandle.data() as GroupNode
    if (groupNode.type !== 'group') return

    const parent = groupHandle.parent()
    if (!parent) return
    this.parentId = parent.id

    this.originalGroupNode = JSON.parse(JSON.stringify(groupNode))

    // Get all children
    const childrenHandles = groupHandle.children()
    this.originalChildren = childrenHandles.map((h) => JSON.parse(JSON.stringify(h.data())))

    const groupX = groupNode.position[0]
    const groupY = groupNode.position[1]
    const groupRotation = groupNode.rotation || 0

    // 1. Move children to parent
    for (const childHandle of childrenHandles) {
      const childNode = childHandle.data()
      graph.deleteNode(childNode.id)

      const updatedChild = { ...childNode }
      const childPos = getNodePosition(childNode)

      // Transform local to parent
      // x' = x*cos(theta) - y*sin(theta) + tx
      // y' = x*sin(theta) + y*cos(theta) + ty
      const cos = Math.cos(groupRotation)
      const sin = Math.sin(groupRotation)

      const newX = childPos.x * cos - childPos.y * sin + groupX
      const newY = childPos.x * sin + childPos.y * cos + groupY

      if ('position' in updatedChild && Array.isArray(updatedChild.position)) {
        ;(updatedChild as any).position = [newX, newY, updatedChild.position[2] || 0].slice(
          0,
          updatedChild.position.length,
        )
      }

      if ('rotation' in updatedChild && typeof updatedChild.rotation === 'number') {
        updatedChild.rotation = (updatedChild.rotation || 0) + groupRotation
      }

      // Update parentId to point to the new parent
      updatedChild.parentId = this.parentId

      graph.nodes.create(updatedChild, this.parentId as AnyNodeId)
    }

    // 2. Delete Group Node
    graph.deleteNode(this.groupNodeId as AnyNodeId)
  }

  undo(graph: SceneGraph): void {
    if (!(this.originalGroupNode && this.parentId)) return

    // 1. Restore Group Node
    // We create it without children first
    const groupToRestore = { ...this.originalGroupNode, children: [] }
    graph.nodes.create(groupToRestore, this.parentId as AnyNodeId)

    // 2. Remove children from parent and add back to group with original local positions
    for (const child of this.originalChildren) {
      // Delete from parent (where they were moved during execute)
      graph.deleteNode(child.id)

      // Add back to group (child data already has relative coordinates from original state)
      graph.nodes.create(child, this.groupNodeId as AnyNodeId)
    }
  }
}
