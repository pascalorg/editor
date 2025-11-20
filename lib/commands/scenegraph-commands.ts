import { getLevels } from '@/lib/scenegraph/editor-utils'
import type { SceneGraph, SceneNodeHandle } from '@/lib/scenegraph/index'
import type { AnyNode, LevelNode, RootNode, SceneNode } from '@/lib/scenegraph/schema/index'
import { createId } from '@/lib/utils'

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
    if ((this.nodeData as any).children) {
      this.nodeData.children = this.ensureChildrenIds(this.nodeData.children as AnyNode[])
    }
  }

  private ensureChildrenIds(children: AnyNode[]): AnyNode[] {
    return children.map((child) => {
      const childId = child.id || createId(child.type)
      return {
        ...child,
        id: childId,
        children: (child as any).children ? this.ensureChildrenIds((child as any).children) : [],
      } as AnyNode
    })
  }

  getNodeId(): string {
    return this.nodeId
  }

  execute(graph: SceneGraph): void {
    if (this.parentId) {
      graph.nodes.create(this.nodeData, this.parentId)
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
    graph.deleteNode(this.nodeId)
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

  execute(graph: SceneGraph): void {
    const handle = graph.getNodeById(this.nodeId)
    if (!handle) return

    // Save previous state for undo
    if (!this.previousState) {
      this.previousState = {}
      const currentNode = handle.data()
      for (const key of Object.keys(this.updates)) {
        this.previousState[key as keyof AnyNode] = (currentNode as any)[key]
      }
    }

    graph.updateNode(this.nodeId, this.updates)
  }

  undo(graph: SceneGraph): void {
    if (this.previousState) {
      graph.updateNode(this.nodeId, this.previousState)
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
  private indexInParent = -1

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  execute(graph: SceneGraph): void {
    const handle = graph.getNodeById(this.nodeId)
    if (!handle) return

    this.deletedNode = handle.data()
    const parent = handle.parent()
    this.parentId = parent ? parent.id : null

    if (parent) {
      const siblings = parent.children()
      this.indexInParent = siblings.findIndex((s) => s.id === this.nodeId)
    }

    graph.deleteNode(this.nodeId)
  }

  undo(graph: SceneGraph): void {
    if (!(this.deletedNode && this.parentId)) return

    // We need to re-insert at specific index?
    // SceneGraph.create adds to end or beginning?
    // addNodeAtPath unshifts (adds to beginning).
    // We might need specific insertion logic in SceneGraph if we want exact index restoration.
    // For now, just adding back is enough for MVP, but order matters for rendering (sometimes).

    // SceneGraph.create(node, parentId)
    graph.nodes.create(this.deletedNode, this.parentId)

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
  private addedIndex = -1

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

    // Store index? SceneGraph adds to beginning (unshift).
    this.addedIndex = 0
  }

  undo(graph: SceneGraph): void {
    graph.deleteNode(this.level.id)
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
    const handle = graph.getNodeById(this.levelId)
    if (!handle) return

    this.deletedLevel = handle.data() as LevelNode
    const parent = handle.parent()
    this.parentId = parent ? parent.id : null

    graph.deleteNode(this.levelId)
  }

  undo(graph: SceneGraph): void {
    if (this.deletedLevel && this.parentId) {
      graph.nodes.create(this.deletedLevel, this.parentId)
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

    // We need to update the building node's children
    // graph.updateNode merges properties.
    // If we pass children array, does it replace?
    // updateNodeAtPath uses Object.assign.
    // So yes, it replaces.

    // However, we need to map LevelNode[] to SceneNode[].
    // And we need to ensure we are not losing data if we just pass objects?
    // Wait, the newOrder contains LevelNodes.

    graph.updateNode(building.id, { children: this.newOrder } as any)
  }

  undo(graph: SceneGraph): void {
    const building = graph.nodes.find({ type: 'building' })[0]
    if (!building) return

    graph.updateNode(building.id, { children: this.previousOrder } as any)
  }
}

// ============================================================================
// COMMAND MANAGER
// ============================================================================

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private readonly maxStackSize = 50

  execute(command: Command, graph: SceneGraph): void {
    command.execute(graph)

    // Always add to undo stack
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift()
    }
    this.redoStack = [] // Clear redo stack on new action
  }

  undo(graph: SceneGraph): boolean {
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
