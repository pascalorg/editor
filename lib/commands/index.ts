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
  private nodeId: string
  private nodeData: Omit<BaseNode, 'id'>
  private parentId: string | null

  constructor(nodeData: Omit<BaseNode, 'id'>, parentId: string | null, nodeId?: string) {
    this.nodeData = nodeData
    this.parentId = parentId
    this.nodeId = nodeId || createId(nodeData.type)
  }

  getNodeId(): string {
    return this.nodeId
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    const newNode = {
      ...this.nodeData,
      id: this.nodeId,
      parent: this.parentId,
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
  private nodeId: string
  private updates: Partial<AnyNode>
  private previousState: Partial<AnyNode> | null = null

  constructor(nodeId: string, updates: Partial<AnyNode>) {
    this.nodeId = nodeId
    this.updates = updates
  }

  execute(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    // Find and update the node
    const findAndUpdate = (nodes: BaseNode[]): boolean => {
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
          return true
        }
        if (node.children.length > 0 && findAndUpdate(node.children)) {
          return true
        }
      }
      return false
    }

    findAndUpdate(levels)
  }

  undo(levels: LevelNode[], nodeIndex: Map<string, BaseNode>): void {
    if (!this.previousState) return

    // Find and restore the node
    const findAndRestore = (nodes: BaseNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === this.nodeId) {
          Object.assign(node, this.previousState)
          nodeIndex.set(this.nodeId, node)
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
// DELETE NODE COMMAND
// ============================================================================

export class DeleteNodeCommand implements Command {
  private nodeId: string
  private deletedNode: BaseNode | null = null
  private parentId: string | null = null
  private indexInParent: number = -1

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
    const findAndDelete = (nodes: BaseNode[], parentId: string | null = null): boolean => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (node.id === this.nodeId) {
          // Save for undo - use current() to get plain object from draft
          this.deletedNode = current(node) as BaseNode
          this.parentId = parentId
          this.indexInParent = i

          removeFromIndex(node)
          nodes.splice(i, 1)
          return true
        }
        if (node.children.length > 0 && findAndDelete(node.children, node.id)) {
          return true
        }
      }
      return false
    }

    findAndDelete(levels)
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
          addToIndex(this.deletedNode)
          return true
        } else if (node.id === this.parentId) {
          // Found parent
          node.children.splice(this.indexInParent, 0, this.deletedNode)
          addToIndex(this.deletedNode)
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
// COMMAND MANAGER
// ============================================================================

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private maxStackSize = 50

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
