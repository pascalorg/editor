import { getLevels } from '@/lib/scenegraph/editor-utils'
import type { SceneGraph, SceneNodeHandle } from '@/lib/scenegraph/index'
import type {
  AnyNode,
  AnyNodeId,
  LevelNode,
  RootNode,
  SceneNode,
} from '@/lib/scenegraph/schema/index'
import { createId } from '@/lib/utils'

// Helper type for nodes that can have children
type NodeWithChildren = Extract<AnyNode, { children: unknown }>

// Helper to check if a node has children property
function hasChildren(node: AnyNode): node is NodeWithChildren {
  return 'children' in node && Array.isArray((node as NodeWithChildren).children)
}

// ============================================================================
// COMMAND INTERFACE
// ============================================================================

export interface Command {
  /** Execute the command */
  execute(graph: SceneGraph): void

  /** Undo the command */
  undo(graph: SceneGraph): void
}

// ============================================================================
// ADD NODE COMMAND
// ============================================================================

export class AddNodeCommand implements Command {
  private readonly nodeId: string
  private readonly nodeData: AnyNode
  private readonly parentId: string | null

  constructor(nodeData: Omit<AnyNode, 'id'>, parentId: string | null, nodeId?: string) {
    this.parentId = parentId
    this.nodeId = nodeId || createId(nodeData.type)

    // Ensure ID is set on the node data
    this.nodeData = {
      ...nodeData,
      id: this.nodeId,
    } as AnyNode

    // Ensure children have IDs recursively
    if (hasChildren(this.nodeData)) {
      // Type assertion needed because children types vary by node type
      this.nodeData.children = this.ensureChildrenIds(
        this.nodeData.children,
      ) as typeof this.nodeData.children
    }
  }

  private ensureChildrenIds(children: readonly AnyNode[]): AnyNode[] {
    return children.map((child) => {
      // Type assertion needed because AnyNode is a discriminated union
      const childAsRecord = child as Record<string, unknown> & { type: string; id?: string }
      const childId = childAsRecord.id || createId(childAsRecord.type)
      const updatedChild: AnyNode = {
        ...child,
        id: childId,
      } as AnyNode

      // Recursively ensure IDs for nested children
      if (hasChildren(child)) {
        ;(updatedChild as NodeWithChildren).children = this.ensureChildrenIds(
          child.children,
        ) as typeof child.children
      }

      return updatedChild
    })
  }

  getNodeId(): string {
    return this.nodeId
  }

  execute(graph: SceneGraph): void {
    if (this.parentId) {
      // Type assertion: runtime parentId is always a valid node ID string
      graph.nodes.create(this.nodeData, this.parentId as AnyNode['id'])
    } else if (this.nodeData.type === 'level') {
      // Special handling for adding levels to root (via Main Building or Site)
      // Current structure: Root -> Site -> Building -> Level
      // But SceneGraph.nodes.create with no parentId assumes adding to root/site logic?
      // Let's look at SceneGraph.nodes.create logic:
      // "If no parentId, assume adding to site (if node is building) or root (if node is site)"

      // We need to find the main building to add level to.
      const building = graph.nodes.find({ type: 'building' })[0]
      if (building) {
        graph.nodes.create(this.nodeData, building.id)
      } else {
        // Fallback or error?
        // Maybe create works if we pass null? SceneGraph.nodes.create throws if parentId missing for non-site.
        console.error('Cannot add level: No building found')
      }
    } else if (this.nodeData.type === 'site') {
      graph.nodes.create(this.nodeData)
    }
  }

  undo(graph: SceneGraph): void {
    // Type assertion: runtime nodeId is always a valid node ID string
    graph.deleteNode(this.nodeId as AnyNode['id'])
  }
}

// ============================================================================
// UPDATE NODE COMMAND
// ============================================================================

export class UpdateNodeCommand implements Command {
  private readonly nodeId: string
  private readonly updates: Partial<AnyNode>
  // Use Record for dynamic property storage, runtime values are type-safe
  private previousState: Record<string, unknown> | null = null

  constructor(nodeId: string, updates: Partial<AnyNode>) {
    this.nodeId = nodeId
    this.updates = updates
  }

  execute(graph: SceneGraph): void {
    // Type assertion: runtime nodeId is always a valid node ID string
    const handle = graph.getNodeById(this.nodeId as AnyNode['id'])
    if (!handle) return

    // Save previous state for undo
    if (!this.previousState) {
      this.previousState = {}
      const currentNode = handle.data() as Record<string, unknown>
      for (const key of Object.keys(this.updates)) {
        this.previousState[key] = currentNode[key]
      }
    }

    // Type assertion: runtime nodeId is always a valid node ID string
    graph.updateNode(this.nodeId as AnyNode['id'], this.updates)
  }

  undo(graph: SceneGraph): void {
    if (this.previousState) {
      // Type assertion: runtime nodeId is always a valid node ID string
      // Runtime values in previousState are correct for their keys
      graph.updateNode(this.nodeId as AnyNode['id'], this.previousState as Partial<AnyNode>)
    }
  }
}

// ============================================================================
// DELETE NODE COMMAND
// ============================================================================

export class DeleteNodeCommand implements Command {
  private readonly nodeId: string
  private deletedNode: AnyNode | null = null
  private parentId: string | null = null

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  execute(graph: SceneGraph): void {
    // Type assertion: runtime nodeId is always a valid node ID string
    const handle = graph.getNodeById(this.nodeId as AnyNode['id'])
    if (!handle) return

    this.deletedNode = handle.data()
    const parent = handle.parent()
    this.parentId = parent ? parent.id : null

    // Type assertion: runtime nodeId is always a valid node ID string
    graph.deleteNode(this.nodeId as AnyNode['id'])
  }

  undo(graph: SceneGraph): void {
    if (!(this.deletedNode && this.parentId)) return

    // We need to re-insert at specific index?
    // SceneGraph.create adds to end or beginning?
    // addNodeAtPath unshifts (adds to beginning).
    // We might need specific insertion logic in SceneGraph if we want exact index restoration.
    // For now, just adding back is enough for MVP, but order matters for rendering (sometimes).

    // Type assertion: runtime parentId is always a valid node ID string
    graph.nodes.create(this.deletedNode, this.parentId as AnyNode['id'])

    // TODO: Handle index restoration if SceneGraph supports it
  }
}

// ============================================================================
// BATCH DELETE COMMAND
// ============================================================================

export class BatchDeleteCommand implements Command {
  private readonly deleteCommands: DeleteNodeCommand[] = []

  constructor(nodeIds: string[]) {
    this.deleteCommands = nodeIds.map((id) => new DeleteNodeCommand(id))
  }

  execute(graph: SceneGraph): void {
    for (const command of this.deleteCommands) {
      command.execute(graph)
    }
  }

  undo(graph: SceneGraph): void {
    for (let i = this.deleteCommands.length - 1; i >= 0; i--) {
      this.deleteCommands[i].undo(graph)
    }
  }
}

// ============================================================================
// LEVEL COMMANDS
// ============================================================================

export class AddLevelCommand implements Command {
  private readonly level: LevelNode

  constructor(level: Omit<LevelNode, 'children'>) {
    this.level = {
      ...level,
      children: [],
    } as LevelNode
  }

  execute(graph: SceneGraph): void {
    const building = graph.nodes.find({ type: 'building' })[0]
    if (!building) return

    // Just add the node
    graph.nodes.create(this.level, building.id)
  }

  undo(graph: SceneGraph): void {
    // Type assertion: level.id is always a valid level ID string
    graph.deleteNode(this.level.id as AnyNode['id'])
  }
}

export class DeleteLevelCommand implements Command {
  private readonly levelId: string
  private deletedLevel: LevelNode | null = null
  private parentId: string | null = null

  constructor(levelId: string) {
    this.levelId = levelId
  }

  execute(graph: SceneGraph): void {
    // Type assertion: runtime levelId is always a valid node ID string
    const handle = graph.getNodeById(this.levelId as AnyNode['id'])
    if (!handle) return

    this.deletedLevel = handle.data() as LevelNode
    const parent = handle.parent()
    this.parentId = parent ? parent.id : null

    // Type assertion: runtime levelId is always a valid node ID string
    graph.deleteNode(this.levelId as AnyNode['id'])
  }

  undo(graph: SceneGraph): void {
    if (this.deletedLevel && this.parentId) {
      // Type assertion: runtime parentId is always a valid node ID string
      graph.nodes.create(this.deletedLevel, this.parentId as AnyNode['id'])
    }
  }
}

export class ReorderLevelsCommand implements Command {
  private readonly newOrder: LevelNode[]
  private previousOrder: LevelNode[] = []

  constructor(newOrder: LevelNode[]) {
    this.newOrder = newOrder
  }

  execute(graph: SceneGraph): void {
    // Reordering involves updating the children array of the building
    const building = graph.nodes.find({ type: 'building' })[0]
    if (!building) return

    const currentLevels = building.children()
    this.previousOrder = currentLevels.map((h) => h.data() as LevelNode)

    // Update building's children array with new order
    // TypeScript doesn't know building has children, so we use Partial with children property
    graph.updateNode(building.id, { children: this.newOrder } as Partial<NodeWithChildren>)
  }

  undo(graph: SceneGraph): void {
    const building = graph.nodes.find({ type: 'building' })[0]
    if (!building) return

    // Restore previous order
    graph.updateNode(building.id, { children: this.previousOrder } as Partial<NodeWithChildren>)
  }
}

// ============================================================================
// MOVE NODE COMMAND
// ============================================================================

export class MoveNodeCommand implements Command {
  private readonly nodeId: string
  private readonly newParentId: string
  private originalNode: AnyNode | null = null
  private originalParentId: string | null = null

  constructor(nodeId: string, newParentId: string, index = -1) {
    this.nodeId = nodeId
    this.newParentId = newParentId
  }

  private getNodePosition(node: AnyNode): { x: number; y: number } {
    if ('position' in node && Array.isArray(node.position)) {
      return { x: node.position[0], y: node.position[1] }
    }
    return { x: 0, y: 0 }
  }

  private getRotation(node: AnyNode): number {
    return 'rotation' in node && typeof node.rotation === 'number' ? node.rotation : 0
  }

  execute(graph: SceneGraph): void {
    const handle = graph.getNodeById(this.nodeId as AnyNodeId)
    if (!handle) return

    const node = handle.data()
    const parent = handle.parent()
    if (!parent) return

    // Store state for undo if not already stored
    if (!this.originalNode) {
      this.originalNode = JSON.parse(JSON.stringify(node))
      this.originalParentId = parent.id
    }

    // 1. Calculate World Position
    let worldX = 0
    let worldY = 0
    let worldRot = 0

    const nodePos = this.getNodePosition(node)
    const nodeRot = this.getRotation(node)

    if (parent.type === 'group') {
      const groupNode = parent.data()
      const groupPos = this.getNodePosition(groupNode)
      const groupRot = this.getRotation(groupNode)

      const cos = Math.cos(groupRot)
      const sin = Math.sin(groupRot)

      worldX = nodePos.x * cos - nodePos.y * sin + groupPos.x
      worldY = nodePos.x * sin + nodePos.y * cos + groupPos.y
      worldRot = nodeRot + groupRot
    } else {
      worldX = nodePos.x
      worldY = nodePos.y
      worldRot = nodeRot
    }

    // 2. Calculate New Local Position
    const newParentHandle = graph.getNodeById(this.newParentId as AnyNodeId)
    if (!newParentHandle) return

    const newParent = newParentHandle.data()
    let newLocalX = worldX
    let newLocalY = worldY
    let newLocalRot = worldRot

    if (newParent.type === 'group') {
      const groupPos = this.getNodePosition(newParent)
      const groupRot = this.getRotation(newParent)

      const dx = worldX - groupPos.x
      const dy = worldY - groupPos.y
      const cos = Math.cos(-groupRot)
      const sin = Math.sin(-groupRot)

      newLocalX = dx * cos - dy * sin
      newLocalY = dx * sin + dy * cos
      newLocalRot = worldRot - groupRot
    }

    // 3. Move Node
    graph.deleteNode(this.nodeId as AnyNodeId)

    const updatedNode = { ...node }
    if ('position' in updatedNode && Array.isArray(updatedNode.position)) {
      ;(updatedNode as any).position = [newLocalX, newLocalY, updatedNode.position[2] || 0].slice(
        0,
        updatedNode.position.length,
      )
    }
    if ('rotation' in updatedNode && typeof updatedNode.rotation === 'number') {
      updatedNode.rotation = newLocalRot
    }

    graph.nodes.create(updatedNode, this.newParentId as AnyNodeId)
  }

  undo(graph: SceneGraph): void {
    if (!(this.originalNode && this.originalParentId)) return

    graph.deleteNode(this.nodeId as AnyNodeId)
    graph.nodes.create(this.originalNode, this.originalParentId as AnyNodeId)
  }
}

// ============================================================================
// TRANSACTION COMMAND (groups multiple operations into one undo step)
// ============================================================================

export class TransactionCommand implements Command {
  /** Snapshot of node states before the transaction */
  private readonly snapshotState: Map<string, { node: AnyNode; parentId: string }> = new Map()
  /** IDs of nodes created during the transaction (need to delete on undo) */
  private readonly createdNodeIds: Set<string> = new Set()
  /** Reference to the graph for capturing snapshots */
  private readonly graph: SceneGraph
  /** Final state after transaction for redo */
  private finalState: Map<string, { node: AnyNode; parentId: string }> | null = null
  /** IDs of nodes that were deleted during the transaction (for redo) */
  private deletedNodeIds: Set<string> | null = null

  constructor(graph: SceneGraph) {
    this.graph = graph
  }

  /**
   * Capture initial state of a node before modification.
   * Call this before any modifications to ensure proper undo.
   * Cleans preview flags from the captured state so undo restores a clean state.
   */
  captureSnapshot(nodeId: string): void {
    if (this.snapshotState.has(nodeId)) return

    const handle = this.graph.getNodeById(nodeId as AnyNodeId)
    if (handle) {
      const parent = handle.parent()
      const nodeData = JSON.parse(JSON.stringify(handle.data()))

      // Clean preview flags from the snapshot - we want to restore to a clean state
      if (nodeData.editor) {
        delete nodeData.editor.deletePreview
        delete nodeData.editor.deleteRange
        delete nodeData.editor.paintPreview
        delete nodeData.editor.paintRange
        delete nodeData.editor.paintFace
      }

      this.snapshotState.set(nodeId, {
        node: nodeData,
        parentId: parent?.id ?? '',
      })
    }
  }

  /**
   * Track a node that was created during the transaction.
   * These will be deleted on undo.
   */
  trackCreatedNode(nodeId: string): void {
    this.createdNodeIds.add(nodeId)
  }

  /**
   * Capture final state before committing transaction (for redo support).
   * Call this right before committing to capture the end state.
   */
  captureFinalState(): void {
    this.finalState = new Map()
    this.deletedNodeIds = new Set()

    // For each node we have a snapshot of, capture its final state (or mark as deleted)
    for (const [nodeId, { parentId }] of this.snapshotState) {
      const handle = this.graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        // Node still exists, capture its current state
        const nodeData = JSON.parse(JSON.stringify(handle.data()))
        // Clean preview flags
        if (nodeData.editor) {
          delete nodeData.editor.deletePreview
          delete nodeData.editor.deleteRange
          delete nodeData.editor.paintPreview
          delete nodeData.editor.paintRange
          delete nodeData.editor.paintFace
        }
        this.finalState.set(nodeId, { node: nodeData, parentId })
      } else {
        // Node was deleted
        this.deletedNodeIds.add(nodeId)
      }
    }

    // Also capture created nodes' final state
    for (const nodeId of this.createdNodeIds) {
      const handle = this.graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        const parent = handle.parent()
        const capturedParentId = parent?.id ?? ''
        const nodeData = JSON.parse(JSON.stringify(handle.data()))
        // Clean preview flags
        if (nodeData.editor) {
          delete nodeData.editor.deletePreview
          delete nodeData.editor.deleteRange
          delete nodeData.editor.paintPreview
          delete nodeData.editor.paintRange
          delete nodeData.editor.paintFace
        }
        this.finalState.set(nodeId, { node: nodeData, parentId: capturedParentId })
      }
    }
  }

  execute(graph: SceneGraph): void {
    // Called on redo - replay the final state
    if (!this.finalState) return

    // First, delete nodes that should be deleted
    if (this.deletedNodeIds) {
      for (const nodeId of this.deletedNodeIds) {
        const handle = graph.getNodeById(nodeId as AnyNodeId)
        if (handle) {
          graph.deleteNode(nodeId as AnyNodeId)
        }
      }
    }

    // Then, restore/create nodes to their final state
    for (const [nodeId, { node, parentId }] of this.finalState) {
      // Skip nodes that were deleted
      if (this.deletedNodeIds?.has(nodeId)) continue

      const handle = graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        // Node exists, update to final state
        graph.updateNode(nodeId as AnyNodeId, node)
      } else if (parentId) {
        // Node doesn't exist, create it
        graph.nodes.create(node, parentId as AnyNodeId)
      }
    }
  }

  undo(graph: SceneGraph): void {
    // First, delete any nodes that were created during the transaction
    for (const nodeId of this.createdNodeIds) {
      const handle = graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        graph.deleteNode(nodeId as AnyNodeId)
      }
    }

    // Then, restore nodes to their snapshot state
    for (const [nodeId, { node, parentId }] of this.snapshotState) {
      const handle = graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        // Node still exists, restore its state
        graph.updateNode(nodeId as AnyNodeId, node)
      } else if (parentId) {
        // Node was deleted, recreate it
        graph.nodes.create(node, parentId as AnyNodeId)
      }
    }
  }

  isEmpty(): boolean {
    return this.snapshotState.size === 0 && this.createdNodeIds.size === 0
  }
}

// ============================================================================
// COMMAND MANAGER
// ============================================================================

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private readonly maxStackSize = 50
  private activeTransaction: TransactionCommand | null = null

  execute(command: Command, graph: SceneGraph): void {
    command.execute(graph)

    // Always add to undo stack
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift()
    }
    this.redoStack = [] // Clear redo stack on new action
  }

  // ============================================================================
  // TRANSACTION METHODS
  // ============================================================================

  /**
   * Start a new transaction. All changes during the transaction
   * will be grouped into a single undo step.
   */
  startTransaction(graph: SceneGraph): void {
    if (this.activeTransaction) {
      console.warn('Transaction already in progress, committing previous transaction')
      this.commitTransaction()
    }
    this.activeTransaction = new TransactionCommand(graph)
  }

  /**
   * Check if a transaction is currently active
   */
  isTransactionActive(): boolean {
    return this.activeTransaction !== null
  }

  /**
   * Get the active transaction (for capturing snapshots)
   */
  getActiveTransaction(): TransactionCommand | null {
    return this.activeTransaction
  }

  /**
   * Commit the current transaction to the undo stack
   */
  commitTransaction(): void {
    if (!this.activeTransaction) {
      console.warn('No active transaction to commit')
      return
    }

    if (!this.activeTransaction.isEmpty()) {
      // Capture final state for redo support
      this.activeTransaction.captureFinalState()
      this.undoStack.push(this.activeTransaction)
      if (this.undoStack.length > this.maxStackSize) {
        this.undoStack.shift()
      }
      this.redoStack = [] // Clear redo stack on new action
    }

    this.activeTransaction = null
  }

  /**
   * Cancel the current transaction and restore to pre-transaction state
   */
  cancelTransaction(graph: SceneGraph): void {
    if (!this.activeTransaction) {
      return
    }

    // Undo all changes made during the transaction
    this.activeTransaction.undo(graph)
    this.activeTransaction = null
  }

  undo(graph: SceneGraph): boolean {
    // If there's an active transaction, cancel it first
    if (this.activeTransaction) {
      this.cancelTransaction(graph)
      return true
    }

    const command = this.undoStack.pop()
    if (!command) return false

    command.undo(graph)
    this.redoStack.push(command)
    return true
  }

  redo(graph: SceneGraph): boolean {
    const command = this.redoStack.pop()
    if (!command) return false

    command.execute(graph)
    this.undoStack.push(command)
    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 || this.activeTransaction !== null
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.activeTransaction = null
  }

  getUndoStack(): Command[] {
    return [...this.undoStack]
  }

  getRedoStack(): Command[] {
    return [...this.redoStack]
  }
}
