/**
 * Command Pattern for Undo/Redo
 *
 * Each command represents a reversible operation on the node tree.
 * Commands know how to execute and undo themselves.
 */

import { current } from 'immer'
import type { AnyNode, BaseNode, LevelNode } from '@/lib/nodes/types'
import { createId } from '@/lib/utils'

// ============================================================================
// COMMAND INTERFACE
// ============================================================================

export interface Command {
  /** Execute the command */
  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void

  /** Undo the command */
  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void
}

// ============================================================================
// ADD NODE COMMAND
// ============================================================================

export class AddNodeCommand implements Command {
  private readonly nodeId: string
  private readonly nodeData: Omit<BaseNode, 'id'>
  private readonly parentId: string | null

  constructor(nodeData: Omit<BaseNode, 'id'>, parentId: string | null, nodeId?: string) {
    this.nodeData = nodeData
    this.parentId = parentId
    this.nodeId = nodeId || createId(nodeData.type)
  }

  getNodeId(): string {
    return this.nodeId
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Recursively process children to generate IDs and set parent references
    const processChildren = (children: any[], parentId: string): BaseNode[] => {
      if (!children || children.length === 0) return []

      return children.map((child) => {
        const childId = child.id || createId(child.type)
        const processedChild = {
          ...child,
          id: childId,
          parent: parentId,
          children: processChildren(child.children || [], childId),
        } as BaseNode

        // Add child to index
        nodeIndex.set(childId, processedChild)

        return processedChild
      })
    }

    const newNode = {
      ...this.nodeData,
      id: this.nodeId,
      parent: this.parentId,
      children: processChildren(this.nodeData.children || [], this.nodeId),
    } as BaseNode

    if (this.parentId === null) {
      // Add to root (only for level nodes)
      if (this.nodeData.type !== 'level') {
        console.error('Only level nodes can be added to root')
        return
      }
      levels.push(newNode as LevelNode)
    } else {
      // Find parent node and add to its children
      const findAndAddToParent = (nodes: BaseNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === this.parentId) {
            node.children.push(newNode)
            // Update parent in index after modifying its children (important for Immer)
            // Use current() to store plain object, not draft proxy
            nodeIndex.set(this.parentId, current(node) as BaseNode)
            return true
          }
          if (node.children.length > 0 && findAndAddToParent(node.children)) {
            return true
          }
        }
        return false
      }

      findAndAddToParent(levels)
    }

    // Update index
    nodeIndex.set(this.nodeId, newNode)
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Recursively remove node and all children from index
    const removeFromIndex = (node: BaseNode) => {
      nodeIndex.delete(node.id)
      node.children.forEach(removeFromIndex)
    }

    // Find and remove the node
    const findAndDelete = (nodes: BaseNode[]): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.id === this.nodeId) {
          removeFromIndex(node)
          nodes.splice(i, 1)
          return true
        }
        if (node.children.length > 0 && findAndDelete(node.children)) {
          return true
        }
      }
      return false
    }

    findAndDelete(levels)
  }
}

// ============================================================================
// UPDATE NODE COMMAND
// ============================================================================

export class UpdateNodeCommand implements Command {
  private readonly nodeId: string
  private readonly updates: Partial<AnyNode>
  private previousState: Partial<AnyNode> | null = null

  constructor(nodeId: string, updates: Partial<AnyNode>) {
    this.nodeId = nodeId
    this.updates = updates
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Find and update the node, tracking parent to update it in nodeIndex too
    const findAndUpdate = (nodes: BaseNode[], parent: BaseNode | null = null): boolean => {
      for (const node of nodes) {
        if (node.id === this.nodeId) {
          // Save previous state for undo (only keys we're updating)
          if (!this.previousState) {
            this.previousState = {}
            for (const key of Object.keys(this.updates)) {
              // Use current() to get plain value from draft proxy
              const value = (node as any)[key]
              this.previousState[key as keyof BaseNode] =
                value && typeof value === 'object' ? current(value) : value
            }
          }

          Object.assign(node, this.updates)
          nodeIndex.set(this.nodeId, node)

          // Update parent in index after modifying its child (important for Immer)
          // Use current() to store plain object, not draft proxy
          if (parent) {
            nodeIndex.set(parent.id, current(parent) as BaseNode)
          }

          return true
        }
        if (node.children.length > 0 && findAndUpdate(node.children, node)) {
          return true
        }
      }
      return false
    }

    findAndUpdate(levels, null)
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    if (!this.previousState) return

    // Find and restore the node, tracking parent to update it in nodeIndex too
    const findAndRestore = (nodes: BaseNode[], parent: BaseNode | null = null): boolean => {
      for (const node of nodes) {
        if (node.id === this.nodeId) {
          Object.assign(node, this.previousState)
          nodeIndex.set(this.nodeId, node)

          // Update parent in index after modifying its child (important for Immer)
          // Use current() to store plain object, not draft proxy
          if (parent) {
            nodeIndex.set(parent.id, current(parent) as BaseNode)
          }

          return true
        }
        if (node.children.length > 0 && findAndRestore(node.children, node)) {
          return true
        }
      }
      return false
    }

    findAndRestore(levels, null)
  }
}

// ============================================================================
// DELETE NODE COMMAND
// ============================================================================

export class DeleteNodeCommand implements Command {
  private readonly nodeId: string
  private deletedNode: BaseNode | null = null
  private parentId: string | null = null
  private indexInParent = -1

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Recursively remove node and all children from index
    const removeFromIndex = (node: BaseNode) => {
      nodeIndex.delete(node.id)
      node.children.forEach(removeFromIndex)
    }

    // Find and remove the node
    const findAndDelete = (
      nodes: BaseNode[],
      parentId: string | null = null,
      parent: BaseNode | null = null,
    ): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.id === this.nodeId) {
          // Save for undo - use current() to get plain object from draft
          this.deletedNode = current(node) as BaseNode
          this.parentId = parentId
          this.indexInParent = i

          removeFromIndex(node)
          nodes.splice(i, 1)

          // Update parent in index after removing child (important for Immer)
          // Use current() to store plain object, not draft proxy
          if (parent) {
            nodeIndex.set(parent.id, current(parent) as BaseNode)
          }

          return true
        }
        if (node.children.length > 0 && findAndDelete(node.children, node.id, node)) {
          return true
        }
      }
      return false
    }

    findAndDelete(levels, null, null)
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    if (!this.deletedNode) return

    // Re-add the node and all its children to index
    const addToIndex = (node: BaseNode) => {
      nodeIndex.set(node.id, node)
      node.children.forEach(addToIndex)
    }

    // Find parent and restore the node
    const findAndRestore = (nodes: BaseNode[]): boolean => {
      for (const node of nodes) {
        if (this.parentId === null) {
          // Root level
          levels.splice(this.indexInParent, 0, this.deletedNode as LevelNode)
          addToIndex(this.deletedNode!)
          return true
        }
        if (node.id === this.parentId) {
          // Found parent
          node.children.splice(this.indexInParent, 0, this.deletedNode!)
          addToIndex(this.deletedNode!)

          // Update parent in index after adding child (important for Immer)
          // Use current() to store plain object, not draft proxy
          nodeIndex.set(node.id, current(node) as BaseNode)

          return true
        }
        if (node.children.length > 0 && findAndRestore(node.children)) {
          return true
        }
      }
      return false
    }

    findAndRestore(levels)
  }
}

// ============================================================================
// LEVEL COMMANDS
// ============================================================================

export class AddLevelCommand implements Command {
  private readonly level: LevelNode
  private addedIndex = -1

  constructor(level: Omit<LevelNode, 'children'>) {
    this.level = {
      ...level,
      children: [],
    } as LevelNode
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    levels.push(this.level)
    this.addedIndex = levels.length - 1
    nodeIndex.set(this.level.id, this.level)
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    if (this.addedIndex >= 0 && this.addedIndex < levels.length) {
      // Recursively remove level and all children from index
      const removeFromIndex = (node: BaseNode) => {
        nodeIndex.delete(node.id)
        node.children.forEach(removeFromIndex)
      }
      removeFromIndex(levels[this.addedIndex])
      levels.splice(this.addedIndex, 1)
    }
  }
}

export class DeleteLevelCommand implements Command {
  private readonly levelId: string
  private deletedLevel: LevelNode | null = null
  private deletedIndex = -1

  constructor(levelId: string) {
    this.levelId = levelId
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    const index = levels.findIndex((l) => l.id === this.levelId)
    if (index >= 0) {
      // Save for undo - use current() to get plain object from draft
      this.deletedLevel = current(levels[index]) as LevelNode
      this.deletedIndex = index

      // Recursively remove level and all children from index
      const removeFromIndex = (node: BaseNode) => {
        nodeIndex.delete(node.id)
        node.children.forEach(removeFromIndex)
      }
      removeFromIndex(levels[index])

      levels.splice(index, 1)
    }
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    if (this.deletedLevel && this.deletedIndex >= 0) {
      // Re-add the level and all its children to index
      const addToIndex = (node: BaseNode) => {
        nodeIndex.set(node.id, node)
        node.children.forEach(addToIndex)
      }

      levels.splice(this.deletedIndex, 0, this.deletedLevel)
      addToIndex(this.deletedLevel)
    }
  }
}

export class ReorderLevelsCommand implements Command {
  private readonly newOrder: LevelNode[]
  private previousOrder: LevelNode[] = []

  constructor(newOrder: LevelNode[]) {
    this.newOrder = newOrder
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Save previous order for undo
    if (this.previousOrder.length === 0) {
      this.previousOrder = [...levels]
    }

    // Clear and set new order
    levels.splice(0, levels.length, ...this.newOrder)

    // Rebuild index with new order (though IDs shouldn't change)
    nodeIndex.clear()
    for (const level of levels) {
      const addToIndex = (node: BaseNode) => {
        nodeIndex.set(node.id, node)
        node.children.forEach(addToIndex)
      }
      addToIndex(level)
    }
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Restore previous order
    levels.splice(0, levels.length, ...this.previousOrder)

    // Rebuild index
    nodeIndex.clear()
    for (const level of levels) {
      const addToIndex = (node: BaseNode) => {
        nodeIndex.set(node.id, node)
        node.children.forEach(addToIndex)
      }
      addToIndex(level)
    }
  }
}

// ============================================================================
// COMMAND MANAGER
// ============================================================================

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private readonly maxStackSize = 50

  execute(command: Command, levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    command.execute(levels, nodeIndex)

    // Always add to undo stack when using CommandManager
    // (Preview operations bypass CommandManager entirely)
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift()
    }
    this.redoStack = [] // Clear redo stack on new action
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): boolean {
    const command = this.undoStack.pop()
    if (!command) return false

    command.undo(levels, nodeIndex)
    this.redoStack.push(command)
    return true
  }

  redo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): boolean {
    const command = this.redoStack.pop()
    if (!command) return false

    command.execute(levels, nodeIndex)
    this.undoStack.push(command)
    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  getUndoStack(): Command[] {
    return [...this.undoStack]
  }

  getRedoStack(): Command[] {
    return [...this.redoStack]
  }
}
