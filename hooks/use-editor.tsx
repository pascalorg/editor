'use client'

import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { current, enableMapSet, produce } from 'immer'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

// Enable Map/Set support in Immer
enableMapSet()

import type { SelectedElement } from '@/lib/building-elements'
import { handleSimpleClick } from '@/lib/building-elements'
import {
  AddLevelCommand,
  AddNodeCommand,
  BatchDeleteCommand,
  CommandManager,
  DeleteLevelCommand,
  DeleteNodeCommand,
  ReorderLevelsCommand,
  UpdateNodeCommand,
} from '@/lib/commands'
import { buildNodeIndex } from '@/lib/nodes/indexes'
import {
  addReferenceImageToLevel,
  addScanToLevel,
  setNodeOpacity,
  setNodeVisibility,
} from '@/lib/nodes/operations'
// Node-based architecture imports
import type { AnyNode, BaseNode, BuildingNode, LevelNode, RootNode } from '@/lib/nodes/types'
import { LevelElevationProcessor } from '@/lib/processors/level-elevation-processor'
import { LevelHeightProcessor } from '@/lib/processors/level-height-processor'
import { VerticalStackingProcessor } from '@/lib/processors/vertical-stacking-processor'
import { calculateNodeBounds, SpatialGrid } from '@/lib/spatial-grid'
import { createId } from '@/lib/utils'

// Split structure and heavy assets across two IDB keys to avoid rewriting large payloads
type AssetMap = Record<string, string>
type PersistEnvelope = { state: any; version: number }

/**
 * Extracts heavy asset URLs (from reference-image and scan nodes) into a separate map,
 * replacing them with placeholder strings in the levels structure.
 */
function extractAssetsFromLevels(levels: LevelNode[]): {
  levels: LevelNode[]
  assets: AssetMap
} {
  const assets: AssetMap = {}

  const walk = (nodes: BaseNode[]): BaseNode[] =>
    nodes.map((node) => {
      const n: any = { ...node }
      // Extract URL from reference-image and scan nodes
      if (
        (n.type === 'reference-image' || n.type === 'scan') &&
        typeof n.url === 'string' &&
        n.url.length > 0
      ) {
        assets[n.id] = n.url
        n.url = `asset:${n.id}` // Placeholder; rehydration will swap back
      }
      // Recursively process children
      if (Array.isArray(n.children) && n.children.length > 0) {
        n.children = walk(n.children as BaseNode[])
      }
      return n
    })

  return { levels: walk(levels) as LevelNode[], assets }
}

/**
 * Injects asset URLs back into levels structure from the assets map.
 */
function injectAssetsIntoLevels(levels: LevelNode[], assets: AssetMap): LevelNode[] {
  const walk = (nodes: BaseNode[]): BaseNode[] =>
    nodes.map((node) => {
      const n: any = { ...node }
      // Restore URL from assets map if placeholder is present
      if (typeof n.url === 'string' && n.url.startsWith('asset:')) {
        const id = n.url.slice('asset:'.length)
        n.url = assets[id] ?? n.url // Fallback to placeholder if asset missing
      }
      // Recursively process children
      if (Array.isArray(n.children) && n.children.length > 0) {
        n.children = walk(n.children as BaseNode[])
      }
      return n
    })

  return walk(levels) as LevelNode[]
}

/**
 * Extracts heavy asset URLs from root node structure into a separate map.
 */
function extractAssetsFromRoot(root: RootNode): {
  root: RootNode
  assets: AssetMap
} {
  const assets: AssetMap = {}

  const walk = (nodes: BaseNode[]): BaseNode[] =>
    nodes.map((node) => {
      const n: any = { ...node }
      if (
        (n.type === 'reference-image' || n.type === 'scan') &&
        typeof n.url === 'string' &&
        n.url.length > 0
      ) {
        assets[n.id] = n.url
        n.url = `asset:${n.id}`
      }
      if (Array.isArray(n.children) && n.children.length > 0) {
        n.children = walk(n.children as BaseNode[])
      }
      return n
    })

  const processedRoot = { ...root, children: walk(root.children) }
  return { root: processedRoot as RootNode, assets }
}

/**
 * Injects asset URLs back into root structure from the assets map.
 */
function injectAssetsIntoRoot(root: RootNode, assets: AssetMap): RootNode {
  const walk = (nodes: BaseNode[]): BaseNode[] =>
    nodes.map((node) => {
      const n: any = { ...node }
      if (typeof n.url === 'string' && n.url.startsWith('asset:')) {
        const id = n.url.slice('asset:'.length)
        n.url = assets[id] ?? n.url
      }
      if (Array.isArray(n.children) && n.children.length > 0) {
        n.children = walk(n.children as BaseNode[])
      }
      return n
    })

  return { ...root, children: walk(root.children) } as RootNode
}

// IndexedDB storage adapter for Zustand persist middleware (split keys)
const indexedDBStorage: StateStorage = {
  getItem: async (name: string) => {
    // Back-compat: migrate single key to split keys (one-time migration)
    const legacy = await idbGet<string>(name)
    if (legacy) {
      try {
        const env = JSON.parse(legacy) as PersistEnvelope

        // Migrate old levels format to new root format
        if (env.state?.levels && Array.isArray(env.state.levels)) {
          const { levels, assets } = extractAssetsFromLevels(env.state.levels as LevelNode[])

          // Convert to root structure
          const root: RootNode = {
            id: 'root',
            type: 'root',
            name: 'root',
            children: [
              {
                id: 'building-1',
                type: 'building',
                name: 'building-1',
                children: levels,
              },
            ],
          }

          const structure = JSON.stringify({
            state: { ...env.state, root, levels: undefined }, // Remove old levels property
            version: env.version,
          })
          const assetsJson = JSON.stringify({ assets })
          await idbSet(`${name}:structure`, structure)
          await idbSet(`${name}:assets`, assetsJson)
          await idbDel(name) // Remove old single-key entry

          // Return merged state with root
          const merged = {
            ...env,
            state: {
              ...env.state,
              root: injectAssetsIntoRoot(root, assets),
              levels: undefined, // Remove old property
            },
          }
          return JSON.stringify(merged)
        }

        // New format with root
        if (env.state?.root) {
          const { root, assets } = extractAssetsFromRoot(env.state.root as RootNode)
          const structure = JSON.stringify({
            state: { ...env.state, root },
            version: env.version,
          })
          const assetsJson = JSON.stringify({ assets })
          await idbSet(`${name}:structure`, structure)
          await idbSet(`${name}:assets`, assetsJson)
          await idbDel(name)

          const merged = {
            ...env,
            state: {
              ...env.state,
              root: injectAssetsIntoRoot(root, assets),
            },
          }
          return JSON.stringify(merged)
        }
      } catch (error) {
        console.warn('[Storage] Migration failed, using legacy format:', error)
        return legacy
      }
    }

    // Read split keys
    const structureRaw = await idbGet<string>(`${name}:structure`)
    if (!structureRaw) return null

    const assetsRaw = (await idbGet<string>(`${name}:assets`)) ?? '{"assets":{}}'
    try {
      const env = JSON.parse(structureRaw) as PersistEnvelope
      const { assets } = JSON.parse(assetsRaw) as { assets: AssetMap }

      // Handle new root format
      if (env.state?.root) {
        env.state = {
          ...env.state,
          root: injectAssetsIntoRoot(env.state.root as RootNode, assets),
        }
        return JSON.stringify(env)
      }

      // Legacy: handle old levels format (migrate to root)
      if (env.state?.levels) {
        const levels = injectAssetsIntoLevels(env.state.levels as LevelNode[], assets)
        const root: RootNode = {
          id: 'root',
          type: 'root',
          name: 'root',
          children: [
            {
              id: 'building-1',
              type: 'building',
              name: 'building-1',
              children: levels,
            },
          ],
        }
        env.state = {
          ...env.state,
          root,
          levels: undefined,
        }
        return JSON.stringify(env)
      }

      return JSON.stringify(env)
    } catch (error) {
      console.error('[Storage] Failed to parse split keys:', error)
      return null
    }
  },

  setItem: async (name: string, value: string) => {
    try {
      const env = JSON.parse(value) as PersistEnvelope

      // Check for new root format
      const hasValidRoot = env.state?.root && typeof env.state.root === 'object'
      if (!hasValidRoot) {
        // Fallback: store unmodified if structure is invalid
        console.warn('[Storage] No valid root structure found, storing as-is')
        await idbSet(name, value)
        return
      }

      // Extract assets from root
      const { root, assets } = extractAssetsFromRoot(env.state.root as RootNode)

      // Save structure (lightweight, updates frequently)
      const structureToSave = JSON.stringify({
        state: { ...env.state, root },
        version: env.version,
      })
      await idbSet(`${name}:structure`, structureToSave)

      // Save assets (heavy, only updates when assets change)
      const nextAssets = JSON.stringify({ assets })
      const prevAssets = await idbGet<string>(`${name}:assets`)
      if (prevAssets !== nextAssets) {
        await idbSet(`${name}:assets`, nextAssets)
      }
    } catch (error) {
      console.error('[Storage] Failed to save split keys, falling back:', error)
      // Fallback: store unmodified
      await idbSet(name, value)
    }
  },

  removeItem: async (name: string) => {
    // Clean up both keys
    await idbDel(name)
    await idbDel(`${name}:structure`)
    await idbDel(`${name}:assets`)
  },
}

export interface WallSegment {
  start: [number, number] // [x, y] intersection coordinates
  end: [number, number] // [x, y] intersection coordinates
  id: string
  isHorizontal: boolean
  visible?: boolean // Optional for backward compatibility
  opacity?: number // 0-100, defaults to 100 if undefined
}

export interface RoofSegment {
  start: [number, number] // [x, y] ridge start coordinates
  end: [number, number] // [x, y] ridge end coordinates
  id: string
  height: number // Peak height above base
  leftWidth?: number // Distance from ridge to left edge (defaults to ROOF_WIDTH / 2)
  rightWidth?: number // Distance from ridge to right edge (defaults to ROOF_WIDTH / 2)
  visible?: boolean // Optional for backward compatibility
  opacity?: number // 0-100, defaults to 100 if undefined
}

export interface ReferenceImage {
  id: string
  url: string
  name: string
  createdAt: string
  position: [number, number]
  rotation: number
  scale: number
  level: number // Floor level this image belongs to
  visible?: boolean // Optional for backward compatibility
  opacity?: number // 0-100, defaults to 100 if undefined
}

export interface Scan {
  id: string
  url: string
  name: string
  createdAt: string
  position: [number, number]
  rotation: number
  scale: number
  level: number // Floor level this scan belongs to
  yOffset?: number // Additional Y offset from floor level
  visible?: boolean // Optional for backward compatibility
  opacity?: number // 0-100, defaults to 100 if undefined
}

export type Tool =
  | 'slab'
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'door'
  | 'window'
  | 'roof'
  | 'column'
  | 'slab'
  | 'item'
  | 'dummy2'

export type ControlMode = 'select' | 'delete' | 'building' | 'guide'

export type CameraMode = 'perspective' | 'orthographic'

export type LevelMode = 'stacked' | 'exploded'

// Note: Node type definitions moved to @/lib/nodes/types.ts to avoid duplication
// Re-export them here for backward compatibility
export type {
  BaseNode,
  ColumnNode,
  DoorNode,
  GridItem,
  GroupNode,
  LevelNode,
  ReferenceImageNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  WallNode,
  WindowNode,
} from '@/lib/nodes/types'

export type WallComponentData = {
  segments: WallSegment[] // Line segments between intersections
}

export type RoofComponentData = {
  segments: RoofSegment[]
}

export type DoorComponentData = {
  position: [number, number]
  rotation: number
  width: number
}

export type WindowComponentData = {
  position: [number, number]
  rotation: number
  width: number
}

export type ColumnComponentData = {
  columns: Array<{
    id: string
    position: [number, number]
    visible?: boolean
    opacity?: number // 0-100, defaults to 100 if undefined
  }>
}

export type Component =
  | {
      id: string
      type: 'wall'
      label: string
      group: string | null
      data: WallComponentData
      createdAt: string
    }
  | {
      id: string
      type: 'roof'
      label: string
      group: string | null
      data: RoofComponentData
      createdAt: string
    }
  | {
      id: string
      type: 'door'
      label: string
      group: string | null
      data: DoorComponentData
      createdAt: string
    }
  | {
      id: string
      type: 'window'
      label: string
      group: string | null
      data: WindowComponentData
      createdAt: string
    }
  | {
      id: string
      type: 'column'
      label: string
      group: string | null
      data: ColumnComponentData
      createdAt: string
    }
  | {
      id: string
      type: 'group'
      group: string | null
      data: {
        name: string
        groupType: 'room' | 'floor' | 'outdoor'
        visible: boolean
        opacity: number
        walls: any[]
      }
    }

export type ComponentGroup = {
  id: string
  name: string
  type: 'room' | 'floor' | 'outdoor'
  color: string
  level?: number
  visible?: boolean // Optional for backward compatibility
  opacity?: number // 0-100, defaults to 100 if undefined
}

export type LayoutJSON = {
  version: string
  grid: {
    size: number
  }
  levels?: LevelNode[] // Legacy format (version < 3.0)
  root?: RootNode // New format (version >= 3.0)
  // components: Component[]
  // groups: ComponentGroup[]
  // images?: ReferenceImage[] // Optional for backward compatibility
  // scans?: Scan[] // Optional for backward compatibility
}

export type ViewMode = 'full' | 'level'

export type ViewerDisplayMode = 'scans' | 'objects'

type StoreState = {
  // ============================================================================
  // NODE-BASED STATE (single source of truth)
  // ============================================================================
  root: RootNode // Scene graph root: root → building → levels
  nodeIndex: Map<string, BaseNode> // Fast lookup by ID
  spatialGrid: SpatialGrid // Spatial indexing for efficient neighbor queries

  // ============================================================================
  // UNDO/REDO STATE (managed by commandManager)
  // ============================================================================
  commandManager: CommandManager

  // ============================================================================
  // UI STATE
  // ============================================================================
  currentLevel: number
  selectedFloorId: string | null
  viewMode: ViewMode // 'full' for viewing all levels, 'level' for editing a specific level
  viewerDisplayMode: ViewerDisplayMode // 'scans' to show scans only, 'objects' to show 3D objects
  selectedElements: SelectedElement[] // Unified selection for building elements (walls, roofs)
  selectedImageIds: string[]
  selectedScanIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  activeTool: Tool | null
  controlMode: ControlMode
  cameraMode: CameraMode
  levelMode: LevelMode
  movingCamera: boolean
  isManipulatingImage: boolean // Flag to prevent undo stack during drag
  isManipulatingScan: boolean // Flag to prevent undo stack during scan manipulation
  handleClear: () => void
  pointerPosition: [number, number] | null
  debug: boolean // Debug mode flag
  // Item builder state
  selectedItem: {
    modelUrl: string
    scale: [number, number, number]
    size: [number, number]
  }
  // Processors
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
} & {
  // Node-based operations
  updateLevels: (levels: LevelNode[]) => void
  addLevel: (level: Omit<LevelNode, 'children'>) => void
  deleteLevel: (levelId: string) => void
  reorderLevels: (levels: LevelNode[]) => void
  selectFloor: (floorId: string | null) => void

  handleElementSelect: (
    elementId: string,
    event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => void
  setSelectedImageIds: (ids: string[]) => void
  setSelectedScanIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setActiveTool: (tool: Tool | null) => void
  setControlMode: (mode: ControlMode) => void
  setCameraMode: (mode: CameraMode) => void
  toggleLevelMode: () => void
  setViewerDisplayMode: (mode: ViewerDisplayMode) => void
  setMovingCamera: (moving: boolean) => void
  setIsManipulatingImage: (manipulating: boolean) => void
  setIsManipulatingScan: (manipulating: boolean) => void
  setDebug: (debug: boolean) => void
  getWallsSet: () => Set<string>
  getRoofsSet: () => Set<string>
  getSelectedElementsSet: () => Set<SelectedElement>
  getSelectedImageIdsSet: () => Set<string>
  getSelectedScanIdsSet: () => Set<string>
  handleExport: () => void
  handleUpload: (file: File, levelId: string) => Promise<void>
  handleScanUpload: (file: File, levelId: string) => Promise<void>
  handleDeleteSelectedElements: () => void
  handleDeleteSelectedImages: () => void
  handleDeleteSelectedScans: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (file: File) => void
  handleResetToDefault: () => void
  undo: () => void
  redo: () => void
  toggleFloorVisibility: (floorId: string) => void
  toggleBuildingElementVisibility: (
    elementId: string,
    type: 'wall' | 'roof' | 'column' | 'slab',
  ) => void
  toggleImageVisibility: (imageId: string) => void
  toggleScanVisibility: (scanId: string) => void
  setFloorOpacity: (floorId: string, opacity: number) => void
  setBuildingElementOpacity: (
    elementId: string,
    type: 'wall' | 'roof' | 'column' | 'slab',
    opacity: number,
  ) => void
  setImageOpacity: (imageId: string, opacity: number) => void
  setScanOpacity: (scanId: string, opacity: number) => void
  setPointerPosition: (position: [number, number] | null) => void
  getLevelId: (node: BaseNode) => string | null

  // Generic node operations
  addNode: (nodeData: Omit<BaseNode, 'id'>, parentId: string | null) => string
  updateNode: (nodeId: string, updates: Partial<AnyNode>) => string
  deleteNode: (nodeId: string) => void
  deletePreviewNodes: () => void
}

/**
 * Get the building node from root (assumes single building at root.children[0])
 */
function getBuilding(root: RootNode): BuildingNode | null {
  return root.children[0] || null
}

/**
 * Get levels array from root (shorthand for root.children[0].children)
 */
function getLevels(root: RootNode): LevelNode[] {
  const building = getBuilding(root)
  return building ? building.children : []
}

/**
 * Helper function to get level ID from a node using provided draft state
 * This is used inside Immer produce() where we can't use get() safely
 */
function getLevelIdFromDraft(
  node: BaseNode,
  root: RootNode,
  nodeIndex: Map<string, BaseNode>,
): string | null {
  const levels = getLevels(root)
  // Create a Set of level IDs for fast lookup
  const levelIds = new Set(levels.map((l) => l.id))

  // If node is already a level, return its id
  if (levelIds.has(node.id)) {
    return node.id
  }

  // Look up the node in the index to get the current version with updated parent references
  let currentNode = nodeIndex.get(node.id)
  if (!currentNode) {
    // Node not found in index
    console.warn('[getLevelIdFromDraft] Node not found in index:', node.id)
    return null
  }

  // Traverse up the parent chain recursively
  while (currentNode.parent) {
    const parentNode = nodeIndex.get(currentNode.parent)
    if (!parentNode) {
      // Parent not found in index, stop traversal
      console.warn(
        '[getLevelIdFromDraft] Parent not found in index:',
        currentNode.parent,
        'for node:',
        currentNode.id,
      )
      break
    }

    // Check if this parent is a level
    if (levelIds.has(parentNode.id)) {
      return parentNode.id
    }

    // Continue up the chain
    currentNode = parentNode
  }

  // No level found in parent chain
  console.warn('[getLevelIdFromDraft] No level found in parent chain for node:', node.id)
  return null
}

/**
 * Rebuild the spatial grid from the node index
 * Used after hydration from localStorage
 */
function rebuildSpatialGrid(
  spatialGrid: SpatialGrid,
  nodeIndex: Map<string, BaseNode>,
  root: RootNode,
): void {
  // Clear existing data
  spatialGrid.clear()

  // Iterate through all nodes and add them to the spatial grid
  for (const [nodeId, node] of nodeIndex.entries()) {
    const levelId = getLevelIdFromDraft(node, root, nodeIndex)
    if (levelId) {
      spatialGrid.updateNode(nodeId, levelId, node, nodeIndex)
    }
  }
}

/**
 * Update a node's properties in both the tree and nodeIndex
 * Finds the node in the tree structure and updates it there
 */
function updateNodeInDraft(
  nodeId: string,
  updates: Partial<AnyNode>,
  root: RootNode,
  nodeIndex: Map<string, BaseNode>,
): void {
  // Find and update node in tree
  const findAndUpdate = (nodes: BaseNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === nodeId) {
        Object.assign(node, updates)
        // nodeIndex already points to the same node reference
        return true
      }
      if (node.children.length > 0 && findAndUpdate(node.children)) {
        return true
      }
    }
    return false
  }

  findAndUpdate([root])
}

/**
 * Process all nodes in a level with their spatial neighbors
 * Updates computed properties for all nodes in the level
 *
 * Processors are called in this order:
 * 1. VerticalStackingProcessor - sets elevation based on slabs (per node with neighbors)
 * 2. LevelHeightProcessor - calculates level height based on content (current level)
 * 3. LevelElevationProcessor - calculates cumulative level elevations (all levels in building)
 */
function processLevel(
  draft: {
    spatialGrid: SpatialGrid
    nodeIndex: Map<string, BaseNode>
    verticalStackingProcessor: VerticalStackingProcessor
    levelHeightProcessor: LevelHeightProcessor
    levelElevationProcessor: LevelElevationProcessor
    root: RootNode
  },
  levelId: string | null,
): void {
  if (!levelId) return

  const level = draft.nodeIndex.get(levelId)
  if (!level || level.type !== 'level') return

  // Get all nodes in this level
  const nodeIds = draft.spatialGrid.getNodesInLevel(levelId)

  // Step 1: Process each node with VerticalStackingProcessor using spatial neighbors
  for (const nodeId of nodeIds) {
    const node = draft.nodeIndex.get(nodeId)
    if (!node) continue

    // Use stored bounds from spatial grid
    const bounds = draft.spatialGrid.getNodeBounds(nodeId)
    if (!bounds) continue

    // Query spatial neighbors
    const neighborIds = draft.spatialGrid.query(levelId, bounds)
    const neighbors = Array.from(neighborIds)
      .map((id) => draft.nodeIndex.get(id))
      .filter((n): n is BaseNode => n !== undefined)

    // Run vertical stacking processor with neighbors
    const results = draft.verticalStackingProcessor.process(neighbors)
    const nodeResults = results.filter((r) => r.nodeId === nodeId)

    nodeResults.forEach(({ nodeId, updates }) => {
      updateNodeInDraft(nodeId, updates, draft.root, draft.nodeIndex)
    })
  }

  // Step 2: Calculate level height based on its content
  const heightResults = draft.levelHeightProcessor.process([level as LevelNode])
  heightResults.forEach(({ nodeId, updates }) => {
    updateNodeInDraft(nodeId, updates, draft.root, draft.nodeIndex)
  })

  // Step 3: Calculate elevation for all levels in the building
  const building = draft.root.children[0]
  if (building && building.type === 'building') {
    const allLevels = building.children
    const elevationResults = draft.levelElevationProcessor.process(allLevels)
    elevationResults.forEach(({ nodeId, updates }) => {
      updateNodeInDraft(nodeId, updates, draft.root, draft.nodeIndex)
    })
  }
}

/**
 * Process all levels after undo/redo to ensure computed properties are up to date
 */
function recomputeAllLevels(draft: {
  spatialGrid: SpatialGrid
  nodeIndex: Map<string, BaseNode>
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
  root: RootNode
}): void {
  // Process each level (this handles all three processors in order)
  const levels = getLevels(draft.root)
  for (const level of levels) {
    processLevel(draft, level.id)
  }
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      return {
        // Node-based state initialization with root → building → levels hierarchy
        root: {
          id: 'root',
          type: 'root',
          name: 'root',
          children: [
            {
              id: createId('building'),
              type: 'building',
              name: 'building-1',
              children: [
                {
                  id: createId('level'),
                  type: 'level',
                  name: 'base level',
                  level: 0,
                  visible: true,
                  children: [],
                },
              ],
            },
          ],
        },
        // Initialize processors
        verticalStackingProcessor: new VerticalStackingProcessor(),
        levelHeightProcessor: new LevelHeightProcessor(),
        levelElevationProcessor: new LevelElevationProcessor(),
        nodeIndex: new Map(), // Will be built from root
        spatialGrid: new SpatialGrid(1), // Cell size of 1 grid unit

        // Undo/redo state initialization
        commandManager: new CommandManager(),

        // UI state initialization
        currentLevel: 0,
        updateLevels: (levels) =>
          set((state) => {
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: levels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        addLevel: (level) => {
          set(
            produce((draft) => {
              const command = new AddLevelCommand(level)
              draft.commandManager.execute(command, draft.root, draft.nodeIndex)

              // Process the new level to calculate its height and update all level elevations
              processLevel(draft, level.id)
            }),
          )
        },
        deleteLevel: (levelId) => {
          set(
            produce((draft) => {
              const command = new DeleteLevelCommand(levelId)
              draft.commandManager.execute(command, draft.root, draft.nodeIndex)

              // Recalculate elevations for all remaining levels
              recomputeAllLevels(draft)
            }),
          )
        },
        reorderLevels: (levels) => {
          set(
            produce((draft) => {
              const command = new ReorderLevelsCommand(levels)
              draft.commandManager.execute(command, draft.root, draft.nodeIndex)

              // Recalculate elevations since level order affects cumulative elevations
              recomputeAllLevels(draft)
            }),
          )
        },

        selectedFloorId: null,
        viewMode: 'level', // Start in level mode with base level selected
        viewerDisplayMode: 'objects', // Start with 3D objects visible in viewer
        selectedElements: [],
        selectFloor: (floorId) => {
          const state = get()

          if (!floorId) {
            // Switch to full view mode - viewing all levels without editing capability
            set({
              selectedFloorId: null,
              currentLevel: -1,
              viewMode: 'full',
              controlMode: 'select',
              activeTool: null,
            })
            return
          }

          // Switch to level mode - focusing on a specific level for editing
          const level = getLevels(state.root).find((l) => l.id === floorId)

          if (level) {
            set({
              selectedFloorId: floorId,
              currentLevel: level.level,
              viewMode: 'level',
              selectedElements: [], // Clear selection when switching floors
            })
          }
        },
        selectedImageIds: [],
        selectedScanIds: [],
        isHelpOpen: false,
        isJsonInspectorOpen: false,
        wallsGroupRef: null,
        activeTool: 'wall',
        controlMode: 'building',
        cameraMode: 'perspective',
        levelMode: 'stacked',
        toggleLevelMode: () =>
          set((state) => ({
            levelMode: state.levelMode === 'stacked' ? 'exploded' : 'stacked',
          })),
        setViewerDisplayMode: (mode) => set({ viewerDisplayMode: mode }),
        movingCamera: false,
        isManipulatingImage: false,
        isManipulatingScan: false,
        debug: false,
        selectedItem: {
          modelUrl: '/models/Couch Medium.glb',
          scale: [0.4, 0.4, 0.4],
          size: [2, 1],
        },
        handleElementSelect: (elementId, event) => {
          const currentSelection = get().selectedElements
          const updatedSelection = handleSimpleClick(currentSelection, elementId, event)
          set({ selectedElements: updatedSelection })

          // Switch to building mode unless we're in select mode
          const controlMode = get().controlMode
          if (controlMode !== 'select') {
            set({ controlMode: 'building' })
          }
        },
        setSelectedImageIds: (ids) => set({ selectedImageIds: ids }),
        setSelectedScanIds: (ids) => set({ selectedScanIds: ids }),
        setIsHelpOpen: (open) => set({ isHelpOpen: open }),
        setIsJsonInspectorOpen: (open) => set({ isJsonInspectorOpen: open }),
        setActiveTool: (tool) => {
          // Delete all preview nodes before switching tools
          get().deletePreviewNodes()

          set({ activeTool: tool })
          // Automatically switch to building mode when a building tool is selected
          if (tool !== null) {
            set({ controlMode: 'building' })
          } else {
            set({ controlMode: 'select' })
          }
        },
        setControlMode: (mode) => {
          // Delete all preview nodes when switching away from building mode
          if (mode !== 'building') {
            get().deletePreviewNodes()
          }

          set({ controlMode: mode })
          // Clear activeTool when switching away from building mode to prevent mode leakage
          if (mode !== 'building') {
            set({ activeTool: null })
          }
        },
        setCameraMode: (mode) => set({ cameraMode: mode }),
        setMovingCamera: (moving) => set({ movingCamera: moving }),
        setIsManipulatingImage: (manipulating) => set({ isManipulatingImage: manipulating }),
        setIsManipulatingScan: (manipulating) => set({ isManipulatingScan: manipulating }),
        setDebug: (debug) => set({ debug }),
        getWallsSet: () => {
          const state = get()
          const selectedFloorId = state.selectedFloorId
          if (!selectedFloorId) return new Set<string>()

          const level = getLevels(state.root).find((l) => l.id === selectedFloorId)
          if (!level) return new Set<string>()

          // Convert WallNode objects back to wall keys
          const wallKeys = level.children
            .filter((child) => child.type === 'wall')
            .map((wall: any) => {
              // Wall ID is the wall key (x1,y1-x2,y2)
              return wall.id
            })

          return new Set(wallKeys)
        },
        getRoofsSet: () => {
          const state = get()
          const selectedFloorId = state.selectedFloorId
          if (!selectedFloorId) return new Set<string>()

          const level = getLevels(state.root).find((l) => l.id === selectedFloorId)
          if (!level) return new Set<string>()

          // Convert RoofNode objects back to roof keys
          const roofKeys = level.children
            .filter((child) => child.type === 'roof')
            .map((roof: any) => {
              // Roof ID is the roof key (x1,y1-x2,y2)
              return roof.id
            })

          return new Set(roofKeys)
        },
        getSelectedElementsSet: () => new Set(get().selectedElements),
        getSelectedImageIdsSet: () => new Set(get().selectedImageIds),
        getSelectedScanIdsSet: () => new Set(get().selectedScanIds),
        handleExport: () => {
          const ref = get().wallsGroupRef
          console.log('Export called, ref:', ref)

          if (!ref) {
            console.error('No walls group ref available for export')
            return
          }

          console.log('Starting export...')
          const exporter = new GLTFExporter()

          exporter.parse(
            ref,
            (result: ArrayBuffer | { [key: string]: unknown }) => {
              console.log('Export successful, creating download...')
              const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'house_model.glb'
              link.click()
              URL.revokeObjectURL(url)
            },
            (error: ErrorEvent) => {
              console.error('Export error:', error)
            },
            { binary: true },
          )
        },
        handleUpload: async (file: File, levelId: string) => {
          // Convert file to data URL (persists across reloads)
          const reader = new FileReader()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          set((state) => {
            // Create ReferenceImageNode
            const imageNode = {
              id: createId('image'),
              type: 'reference-image' as const,
              name: file.name,
              url: dataUrl, // Use data URL instead of blob URL
              createdAt: new Date().toISOString(),
              position: [0, 0] as [number, number],
              rotation: 0,
              size: [10, 10] as [number, number], // Default 10m x 10m
              scale: 1,
              visible: true,
              opacity: 50, // Default to 50% opacity for reference images
              children: [] as [],
              parent: levelId,
            }

            // Add to the appropriate level
            const updatedLevels = addReferenceImageToLevel(
              getLevels(state.root),
              levelId,
              imageNode,
            )
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }

            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          })
        },
        handleScanUpload: async (file: File, levelId: string) => {
          // Convert file to data URL (persists across reloads)
          const reader = new FileReader()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          set((state) => {
            // Find the level to add the scan to

            const scanId = `scan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

            // Create ScanNode
            const scanNode = {
              id: scanId,
              type: 'scan' as const,
              name: file.name,
              url: dataUrl, // Use data URL instead of blob URL
              createdAt: new Date().toISOString(),
              position: [0, 0] as [number, number],
              rotation: 0,
              size: [10, 10] as [number, number], // Default 10m x 10m
              scale: 1,
              yOffset: 0,
              visible: true,
              opacity: 100,
              children: [] as [],
              parent: levelId,
            }

            // Add to the appropriate level
            const updatedLevels = addScanToLevel(getLevels(state.root), levelId, scanNode)
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }

            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          })
        },
        handleDeleteSelectedImages: () => {
          const state = get()
          if (state.selectedImageIds.length === 0) return

          // Delete all selected image nodes using command manager
          const imageIds = [...state.selectedImageIds]
          for (const imageId of imageIds) {
            get().deleteNode(imageId)
          }

          // Clear selection
          set({ selectedImageIds: [] })
        },
        handleDeleteSelectedScans: () => {
          const state = get()
          if (state.selectedScanIds.length === 0) return

          // Delete all selected scan nodes using command manager
          const scanIds = [...state.selectedScanIds]
          for (const scanId of scanIds) {
            get().deleteNode(scanId)
          }

          // Clear selection
          set({ selectedScanIds: [] })
        },
        handleDeleteSelectedElements: () => {
          const state = get()
          if (state.selectedElements.length === 0) return

          // Copy selected elements before deletion
          const elementIds = [...state.selectedElements]

          set(
            produce((draft) => {
              // Collect affected levels before deletion
              const affectedLevels = new Set<string>()

              for (const nodeId of elementIds) {
                const node = draft.nodeIndex.get(nodeId)
                if (!node) continue

                const levelId = getLevelIdFromDraft(node, draft.root, draft.nodeIndex)
                if (levelId) {
                  affectedLevels.add(levelId)
                }
              }

              // Execute batch delete command (single undo operation)
              const batchCommand = new BatchDeleteCommand(elementIds)
              draft.commandManager.execute(batchCommand, draft.root, draft.nodeIndex)

              // Remove all nodes from spatial grid
              for (const nodeId of elementIds) {
                draft.spatialGrid.removeNode(nodeId)
              }

              // Process all affected levels
              for (const levelId of affectedLevels) {
                processLevel(draft, levelId)
              }

              // Clear selection
              draft.selectedElements = []
            }),
          )
        },
        handleClear: () => {
          set({ selectedElements: [] })
        },
        serializeLayout: () => {
          const state = get()

          // Serialize using root node structure
          return {
            version: '3.0', // Updated version for root → building → levels hierarchy
            grid: { size: 61 }, // 61 intersections (60 divisions + 1)
            root: state.root, // Save entire scene graph from root
          }
        },
        loadLayout: (json: LayoutJSON) => {
          set({
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
            selectedFloorId: null,
            viewMode: 'full', // Start in full view mode when loading a layout
            controlMode: 'select',
            activeTool: null,
          })

          // Load from root node structure (new format)
          if (json.root) {
            set({
              root: json.root,
              nodeIndex: buildNodeIndex([json.root]),
            })
          } else if (json.levels) {
            // Migrate from legacy format (version < 3.0)
            const migratedRoot: RootNode = {
              id: 'root',
              type: 'root',
              name: 'root',
              children: [
                {
                  id: 'building-1',
                  type: 'building',
                  name: 'building-1',
                  children: json.levels,
                },
              ],
            }
            set({
              root: migratedRoot,
              nodeIndex: buildNodeIndex([migratedRoot]),
            })
          }
        },
        handleSaveLayout: () => {
          const layout = get().serializeLayout()
          const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `layout_${new Date().toISOString().split('T')[0]}.json`
          link.click()
          URL.revokeObjectURL(url)
        },
        handleLoadLayout: (file: File) => {
          if (file && file.type === 'application/json') {
            const reader = new FileReader()
            reader.onload = (event) => {
              try {
                const json = JSON.parse(event.target?.result as string) as LayoutJSON
                get().loadLayout(json)
              } catch (error) {
                console.error('Failed to parse layout JSON:', error)
              }
            }
            reader.readAsText(file)
          }
        },
        handleResetToDefault: () => {
          const defaultLevels: LevelNode[] = [
            {
              id: createId('level'),
              type: 'level',
              name: 'base level',
              level: 0,
              visible: true,
              children: [],
            },
          ]
          const defaultRoot: RootNode = {
            id: 'root',
            type: 'root',
            name: 'root',
            children: [
              {
                id: 'building-1',
                type: 'building',
                name: 'building-1',
                children: defaultLevels,
              },
            ],
          }
          set({
            root: defaultRoot,
            nodeIndex: buildNodeIndex([defaultRoot]),
            currentLevel: 0,
            selectedFloorId: defaultLevels[0].id,
            viewMode: 'level',
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          })
          // Clear command history
          get().commandManager.clear()
        },
        undo: () =>
          set(
            produce((draft) => {
              const success = draft.commandManager.undo(draft.root, draft.nodeIndex)
              if (success) {
                // Clear selections after undo
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []

                // Rebuild spatial grid and recompute all levels
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.root)
                recomputeAllLevels(draft)
              }
            }),
          ),
        redo: () =>
          set(
            produce((draft) => {
              const success = draft.commandManager.redo(draft.root, draft.nodeIndex)
              if (success) {
                // Clear selections after redo
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []

                // Rebuild spatial grid and recompute all levels
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.root)
                recomputeAllLevels(draft)
              }
            }),
          ),
        toggleFloorVisibility: (floorId) =>
          set((state) => {
            const updatedLevels = getLevels(state.root).map((level) =>
              level.id === floorId ? { ...level, visible: !(level.visible ?? true) } : level,
            )
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        toggleBuildingElementVisibility: (elementId, type) =>
          set((state) => {
            if (!state.selectedFloorId) return state

            // Find the node and toggle its visibility
            const node = state.nodeIndex.get(elementId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(
              getLevels(state.root),
              elementId,
              !currentVisibility,
            )
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }

            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        toggleImageVisibility: (imageId) =>
          set((state) => {
            const node = state.nodeIndex.get(imageId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(
              getLevels(state.root),
              imageId,
              !currentVisibility,
            )
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }

            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        toggleScanVisibility: (scanId) =>
          set((state) => {
            const node = state.nodeIndex.get(scanId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(
              getLevels(state.root),
              scanId,
              !currentVisibility,
            )
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }

            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        setFloorOpacity: (floorId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(getLevels(state.root), floorId, opacity)
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        setBuildingElementOpacity: (elementId, type, opacity) =>
          set((state) => {
            if (!state.selectedFloorId) return state

            const updatedLevels = setNodeOpacity(getLevels(state.root), elementId, opacity)
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        setImageOpacity: (imageId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(getLevels(state.root), imageId, opacity)
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        setScanOpacity: (scanId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(getLevels(state.root), scanId, opacity)
            const building = state.root.children[0]
            if (!building) return state
            const updatedBuilding = { ...building, children: updatedLevels }
            const updatedRoot = { ...state.root, children: [updatedBuilding] }
            return {
              root: updatedRoot,
              nodeIndex: buildNodeIndex([updatedRoot]),
            }
          }),
        pointerPosition: null,
        setPointerPosition: (position) => set({ pointerPosition: position }),
        getLevelId: (node) => {
          const state = get()

          // Create a Set of level IDs for fast lookup
          const levelIds = new Set(getLevels(state.root).map((l) => l.id))

          // If node is already a level, return its id
          if (levelIds.has(node.id)) {
            return node.id
          }

          // Look up the node in the index to get the current version with updated parent references
          let currentNode = state.nodeIndex.get(node.id)
          if (!currentNode) {
            // Node not found in index
            console.warn('[getLevelId] Node not found in index:', node.id)
            return null
          }

          // Traverse up the parent chain recursively
          while (currentNode.parent) {
            const parentNode = state.nodeIndex.get(currentNode.parent)
            if (!parentNode) {
              // Parent not found in index, stop traversal
              console.warn(
                '[getLevelId] Parent not found in index:',
                currentNode.parent,
                'for node:',
                currentNode.id,
              )
              break
            }

            // Check if this parent is a level
            if (levelIds.has(parentNode.id)) {
              return parentNode.id
            }

            // Continue up the chain
            currentNode = parentNode
          }

          // No level found in parent chain
          console.warn('[getLevelId] No level found in parent chain for node:', node.id)
          return null
        },

        // Generic node operations
        addNode: (nodeData, parentId) => {
          let nodeId = ''

          set(
            produce((draft) => {
              const command = new AddNodeCommand(nodeData, parentId)
              nodeId = command.getNodeId()

              // If it's a preview node, execute directly without adding to undo stack
              if (nodeData.preview) {
                command.execute(draft.root, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.root, draft.nodeIndex)
              }

              // Update spatial grid and process level
              const node = draft.nodeIndex.get(nodeId)
              if (!node) {
                console.error('Added node not found in index:', nodeId)
                return
              }
              const levelId = getLevelIdFromDraft(node, draft.root, draft.nodeIndex)
              if (levelId) {
                draft.spatialGrid.updateNode(nodeId, levelId, node, draft.nodeIndex)
                processLevel(draft, levelId)
              }
            }),
          )

          return nodeId
        },

        updateNode: (nodeId, updates) => {
          let resultNodeId = nodeId
          let affectedNodeIds = new Set<string>()

          set(
            produce((draft) => {
              const fromNode = draft.nodeIndex.get(nodeId)

              // Check if we're committing a preview node (preview: true -> false)
              const isCommittingPreview = fromNode?.preview === true && updates.preview === false

              if (isCommittingPreview) {
                // Get full node data using current() to get plain object
                const previewNode = current(fromNode)

                // Delete preview node (no undo)
                const deleteCommand = new DeleteNodeCommand(nodeId)
                deleteCommand.execute(draft.root, draft.nodeIndex)

                // Prepare new node data
                const { preview, id, children, parent, ...nodeData } = previewNode as any

                // Clean up name if not explicitly provided in updates
                const cleanName =
                  updates.name || nodeData.name.replace(' Preview', '').replace('Preview ', '')

                // Merge with updates
                const newNodeData = {
                  ...nodeData,
                  ...updates,
                  name: cleanName,
                  preview: false, // Ensure preview is false
                }

                // Handle children - always preserve the children property if it exists
                if (children !== undefined) {
                  if (children.length > 0) {
                    // Recursively strip preview/id/parent from children
                    newNodeData.children = children.map((child: any) => ({
                      ...child,
                      preview: false,
                    }))
                  } else {
                    // Preserve empty children array
                    newNodeData.children = []
                  }
                }

                // Create new real node (with undo)
                const addCommand = new AddNodeCommand(newNodeData, parent)
                resultNodeId = addCommand.getNodeId()
                draft.commandManager.execute(addCommand, draft.root, draft.nodeIndex)
              } else {
                // Normal update
                const command = new UpdateNodeCommand(nodeId, updates)

                // Check if we're updating a preview node
                const isPreviewNode = fromNode?.preview === true

                if (isPreviewNode) {
                  // Preview node update - execute directly without undo tracking
                  command.execute(draft.root, draft.nodeIndex)
                } else {
                  draft.commandManager.execute(command, draft.root, draft.nodeIndex)
                }
              }

              // Update spatial grid and process level
              const node = draft.nodeIndex.get(resultNodeId)
              if (!node) {
                console.error('Updated node not found in index:', resultNodeId)
                return
              }
              const levelId = getLevelIdFromDraft(node, draft.root, draft.nodeIndex)
              if (levelId) {
                draft.spatialGrid.updateNode(resultNodeId, levelId, node, draft.nodeIndex)
                processLevel(draft, levelId)
              }
            }),
          )

          return resultNodeId
        },

        deleteNode: (nodeId) => {
          set(
            produce((draft) => {
              // Get the node and levelId before deletion
              const node = draft.nodeIndex.get(nodeId)
              const levelId = node ? getLevelIdFromDraft(node, draft.root, draft.nodeIndex) : null

              // Execute delete command
              const command = new DeleteNodeCommand(nodeId)
              if (node?.preview) {
                // Preview node - execute directly without undo tracking
                command.execute(draft.root, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.root, draft.nodeIndex)
              }

              // Remove from spatial grid and process level
              draft.spatialGrid.removeNode(nodeId)
              if (levelId) {
                processLevel(draft, levelId)
              }
            }),
          )
        },

        deletePreviewNodes: () => {
          set(
            produce((draft) => {
              // Find all preview nodes in the node index
              const previewNodeIds: string[] = []
              for (const [id, node] of draft.nodeIndex.entries()) {
                if (node.preview === true) {
                  previewNodeIds.push(id)
                }
              }

              // Delete each preview node without undo tracking
              for (const nodeId of previewNodeIds) {
                const command = new DeleteNodeCommand(nodeId)
                command.execute(draft.root, draft.nodeIndex)
              }
            }),
          )
        },
      }
    },
    {
      name: 'editor-storage',
      version: 1, // Increment this when storage format changes
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => {
        // Filter out preview nodes before persisting
        const filterPreviewNodes = (node: BaseNode): BaseNode => {
          return {
            ...node,
            children: node.children
              .filter((child) => !child.preview) // Remove preview nodes
              .map((child) => filterPreviewNodes(child)),
          }
        }

        const rootWithoutPreviews = filterPreviewNodes(state.root) as RootNode

        return {
          // Node-based state (single source of truth)
          root: rootWithoutPreviews,
          // Note: nodeIndex is NOT persisted - it's rebuilt from root on load

          // Selection state
          selectedElements: state.selectedElements,
          selectedImageIds: state.selectedImageIds,
          selectedScanIds: state.selectedScanIds,

          // Debug state
          debug: state.debug,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate blob URLs to prevent errors (cleanup from v0 -> v1)
          const cleanBlobUrls = (nodes: BaseNode[]): BaseNode[] => {
            return nodes
              .map((node) => {
                // Clean reference-image and scan nodes with blob URLs
                if (
                  (node.type === 'reference-image' || node.type === 'scan') &&
                  'url' in node &&
                  typeof node.url === 'string' &&
                  node.url.startsWith('blob:')
                ) {
                  console.warn(`[Migration] Removing invalid blob URL for ${node.type} ${node.id}`)
                  // Remove the node by filtering it out (return null and filter later)
                  return null as any
                }

                // Recursively clean children if present
                if (
                  'children' in node &&
                  Array.isArray(node.children) &&
                  node.children.length > 0
                ) {
                  return {
                    ...node,
                    children: cleanBlobUrls(node.children),
                  }
                }

                return node
              })
              .filter((node): node is BaseNode => node !== null)
          }

          // Clean blob URLs from root tree
          if (state.root) {
            const cleanNode = (node: BaseNode): BaseNode => ({
              ...node,
              children: cleanBlobUrls(node.children),
            })
            state.root = cleanNode(state.root) as RootNode
          }

          // Initialize root structure if not present
          if (!state.root) {
            state.root = {
              id: 'root',
              type: 'root',
              name: 'root',
              children: [
                {
                  id: 'building-1',
                  type: 'building',
                  name: 'building-1',
                  children: [
                    {
                      id: createId('level'),
                      type: 'level',
                      name: 'base level',
                      level: 0,
                      visible: true,
                      children: [],
                    },
                  ],
                },
              ],
            }
          }

          // Always rebuild node index from root (Maps can't be persisted)
          state.nodeIndex = buildNodeIndex([state.root])
          const levels = getLevels(state.root)
          console.log('[Rehydration] Built node index:', {
            nodes: state.nodeIndex.size,
            levels: levels.length,
          })

          // Reinitialize command manager (can't be persisted)
          state.commandManager = new CommandManager()

          // Reinitialize and rebuild spatial grid (Maps can't be persisted)
          state.spatialGrid = new SpatialGrid(1)
          rebuildSpatialGrid(state.spatialGrid, state.nodeIndex, state.root)
          console.log('[Rehydration] Rebuilt spatial grid:', {
            totalNodes: state.nodeIndex.size,
            levels: levels.map((level) => ({
              id: level.id,
              nodesInGrid: state.spatialGrid.getNodesInLevel(level.id).size,
            })),
          })

          // Preselect base level if no level is selected
          if (!state.selectedFloorId && levels.length > 0) {
            state.selectedFloorId = levels[0].id
            state.currentLevel = 0
            state.viewMode = 'level'
          }

          // Ensure viewMode is set correctly based on selectedFloorId
          if (state.selectedFloorId === null) {
            state.viewMode = 'full'
          } else if (state.viewMode === undefined) {
            state.viewMode = 'level'
          }

          // Initialize selectedScanIds if not present
          if (!state.selectedScanIds) {
            state.selectedScanIds = []
          }
        }
      },
    },
  ),
)

export const useEditor = useStore
