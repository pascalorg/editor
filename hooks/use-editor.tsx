'use client'

import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { enableMapSet, produce } from 'immer'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

// Enable Map/Set support in Immer
enableMapSet()

import { emitter } from '@/events/bus'
import { handleSimpleClick } from '@/lib/building-elements'
import { GroupNodesCommand, UngroupNodesCommand } from '@/lib/commands/group-commands'
import {
  AddLevelCommand,
  AddNodeCommand,
  BatchDeleteCommand,
  CommandManager,
  DeleteLevelCommand,
  DeleteNodeCommand,
  MoveNodeCommand,
  ReorderLevelsCommand,
  UpdateNodeCommand,
} from '@/lib/commands/scenegraph-commands'
import { LevelElevationProcessor } from '@/lib/processors/level-elevation-processor'
import { LevelHeightProcessor } from '@/lib/processors/level-height-processor'
import { RoomDetectionProcessor } from '@/lib/processors/room-detection-processor'
import { VerticalStackingProcessor } from '@/lib/processors/vertical-stacking-processor'
import { getLevelIdForNode, SceneGraph, type SceneNodeHandle } from '@/lib/scenegraph/index'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  initScene,
  RootNode,
  type Scene,
  type SceneNode,
  SiteNode,
} from '@/lib/scenegraph/schema/index'
import { type Collection, CollectionSchema } from '@/lib/scenegraph/schema/collections'
import { type View, ViewSchema } from '@/lib/scenegraph/schema/views'
import { type Zone, ZoneSchema } from '@/lib/scenegraph/schema/zones'
import { calculateNodeBounds, SpatialGrid } from '@/lib/spatial-grid'

// Split structure and heavy assets across two IDB keys to avoid rewriting large payloads
type AssetMap = Record<string, string>
type PersistEnvelope = { state: any; version: number }

/**
 * Extracts heavy asset URLs from root node structure into a separate map.
 */
function extractAssetsFromRoot(root: RootNode): {
  root: RootNode
  assets: AssetMap
} {
  const assets: AssetMap = {}

  const walk = (node: SceneNode): SceneNode => {
    const n = { ...node } as any

    if (
      (n.type === 'reference-image' || n.type === 'scan') &&
      typeof n.url === 'string' &&
      n.url.length > 0
    ) {
      assets[n.id] = n.url
      n.url = `asset:${n.id}`
    }

    // Generic traversal
    for (const key of Object.keys(n)) {
      const value = n[key]
      if (typeof value === 'object' && value !== null) {
        if ((value as any).object === 'node') {
          n[key] = walk(value)
        } else if (Array.isArray(value)) {
          n[key] = value.map((item: any) =>
            typeof item === 'object' && item !== null && item.object === 'node' ? walk(item) : item,
          )
        }
      }
    }
    return n as SceneNode
  }

  // Walk sites
  if (root.children) {
    root.children = root.children.map((site) => walk(site) as SiteNode)
  }

  return { root, assets }
}

/**
 * Injects asset URLs back into root structure from the assets map.
 */
function injectAssetsIntoRoot(root: RootNode, assets: AssetMap): RootNode {
  const walk = (node: SceneNode): SceneNode => {
    const n = { ...node } as any

    if (typeof n.url === 'string' && n.url.startsWith('asset:')) {
      const id = n.url.slice('asset:'.length)
      n.url = assets[id] ?? n.url
    }

    // Generic traversal
    for (const key of Object.keys(n)) {
      const value = n[key]
      if (typeof value === 'object' && value !== null) {
        if ((value as any).object === 'node') {
          n[key] = walk(value)
        } else if (Array.isArray(value)) {
          n[key] = value.map((item: any) =>
            typeof item === 'object' && item !== null && item.object === 'node' ? walk(item) : item,
          )
        }
      }
    }
    return n as SceneNode
  }

  // Walk sites
  if (root.children) {
    root.children = root.children.map((site) => walk(site) as SiteNode)
  }

  return root
}

// Cache for last persisted scene - used to prevent transient scenes from overwriting storage
let lastPersistedSceneCache: Scene | null = null

// IndexedDB storage adapter for Zustand persist middleware (split keys)
const indexedDBStorage: StateStorage = {
  getItem: async (name: string) => {
    // Read split keys
    const structureRaw = await idbGet<string>(`${name}:structure`)
    // Backwards compatibility: check single key if split key not found
    const raw = structureRaw || (await idbGet<string>(name))

    if (!raw) return null

    const assetsRaw = (await idbGet<string>(`${name}:assets`)) ?? '{"assets":{}}'
    try {
      const env = JSON.parse(raw) as PersistEnvelope
      const { assets } = JSON.parse(assetsRaw) as { assets: AssetMap }

      // Handle Scene structure (v3+)
      if (env.state?.scene?.root) {
        env.state.scene.root = injectAssetsIntoRoot(env.state.scene.root as RootNode, assets)
        return JSON.stringify(env)
      }

      return JSON.stringify(env)
    } catch (error) {
      console.error('[Storage] Failed to parse storage:', error)
      return null
    }
  },

  setItem: async (name: string, value: string) => {
    try {
      const env = JSON.parse(value) as PersistEnvelope

      // Check for scene root
      const root = env.state?.scene?.root
      if (!root) {
        // Fallback: store unmodified
        await idbSet(name, value)
        return
      }

      // Extract assets from root
      const { root: processedRoot, assets } = extractAssetsFromRoot(root as RootNode)

      // Prepare structure to save
      const stateToSave = {
        ...env.state,
        scene: {
          ...env.state.scene,
          root: processedRoot,
        },
      }

      const structureToSave = JSON.stringify({
        state: stateToSave,
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
      await idbSet(name, value)
    }
  },

  removeItem: async (name: string) => {
    await idbDel(name)
    await idbDel(`${name}:structure`)
    await idbDel(`${name}:assets`)
  },
}

// Re-export types needed by components
export type {
  AnyNode,
  BaseNode,
  ColumnNode,
  DoorNode,
  GridItem,
  GroupNode,
  ImageNode,
  LevelNode,
  RoofNode,
  ScanNode,
  WallNode,
  WindowNode,
} from '@/lib/scenegraph/schema/index'

// Using Schema types instead for internal use
import type { LevelNode as SchemaLevelNode } from '@/lib/scenegraph/schema/index'

// Editor modes - high-level workflow modes
export type EditorMode = 'site' | 'structure' | 'furnish'

// Site mode tools
export type SiteTool = 'property-line' | 'building-select'

// Structure mode tools (building elements)
export type StructureTool =
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'column'
  | 'stair'
  | 'door'
  | 'window'
  | 'zone'

// Furnish mode tools (items and decoration)
export type FurnishTool =
  | 'furniture'
  | 'appliance'
  | 'kitchen'
  | 'bathroom'
  | 'outdoor'
  | 'painting'

// Combined tool type (including 'item' for backward compatibility during transition)
export type Tool = SiteTool | StructureTool | FurnishTool | 'item'

// Catalog categories for furnish mode items
export type CatalogCategory =
  | 'furniture'
  | 'appliance'
  | 'bathroom'
  | 'kitchen'
  | 'outdoor'
  | 'window'
  | 'door'

// Control modes - sub-modes within each editor mode (keeping legacy values for compatibility during transition)
export type ControlMode = 'select' | 'edit' | 'delete' | 'build' | 'building' | 'guide' | 'painting'
export type CameraMode = 'perspective' | 'orthographic'
export type LevelMode = 'stacked' | 'exploded'
export type WallMode = 'up' | 'cutaway' | 'down'
export type ViewMode = 'full' | 'level'
export type ViewerDisplayMode = 'scans' | 'objects'
export type PaintMode = 'wall' | 'room'

// Scene source tracking - determines persistence behavior
export type SceneSource =
  | { type: 'persisted' } // Default: saved to IndexedDB (editor mode)
  | { type: 'url'; url: string } // Loaded from URL, not persisted (viewer mode)
  | { type: 'slot'; name: string } // Named slot for future multi-project support

export type AddToCollectionState = {
  isActive: boolean
  nodeIds: string[]
}

export type StoreState = {
  // ============================================================================
  // SCENE GRAPH STATE
  // ============================================================================
  scene: Scene
  graph: SceneGraph
  spatialGrid: SpatialGrid
  /** Tracks where the current scene was loaded from - determines persistence behavior */
  sceneSource: SceneSource

  // ============================================================================
  // UNDO/REDO
  // ============================================================================
  commandManager: CommandManager

  // ============================================================================
  // UI STATE
  // ============================================================================
  currentLevel: number
  selectedFloorId: string | null
  viewMode: ViewMode
  viewerDisplayMode: ViewerDisplayMode
  selectedNodeIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  activeTool: Tool | null
  lastBuildingTool: Tool
  lastCatalogCategory: CatalogCategory | null
  catalogCategory: CatalogCategory | null
  controlMode: ControlMode

  // New editor mode system
  editorMode: EditorMode
  selectedBuildingId: string | null
  lastToolByMode: Record<EditorMode, Tool | null>
  cameraMode: CameraMode
  levelMode: LevelMode
  wallMode: WallMode
  movingCamera: boolean
  isManipulatingImage: boolean
  isManipulatingScan: boolean
  handleClear: () => void
  pointerPosition: [number, number] | null
  debug: boolean

  addToCollectionState: AddToCollectionState
  selectedCollectionId: string | null
  // Zone selection (for editing boundaries)
  selectedZoneId: string | null

  selectedItem: {
    category?: CatalogCategory
    name?: string
    modelUrl: string
    scale: [number, number, number]
    size: [number, number]
    position?: [number, number, number]
    rotation?: [number, number, number]
    attachTo?: 'ceiling' | 'wall' | 'wall-side'
  }

  // Painting mode
  selectedMaterial: string
  paintMode: PaintMode

  // Processors
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
  roomDetectionProcessor: RoomDetectionProcessor
} & {
  // Operations
  addLevel: (level: Omit<SchemaLevelNode, 'children'>) => void
  deleteLevel: (levelId: string) => void
  reorderLevels: (levels: SchemaLevelNode[]) => void
  selectFloor: (floorId: string | null) => void
  selectZone: (zoneId: string | null) => void

  handleNodeSelect: (
    nodeId: string,
    event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => void

  // Deprecated/Compatibility aliases - mapping to handleNodeSelect/selectedNodeIds
  handleElementSelect: (
    elementId: AnyNodeId,
    event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => void
  setSelectedImageIds: (ids: string[]) => void
  setSelectedScanIds: (ids: string[]) => void

  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setActiveTool: (tool: Tool | null, catalogCategory?: CatalogCategory | null) => void
  setCatalogCategory: (category: CatalogCategory | null) => void
  setControlMode: (mode: ControlMode) => void
  setEditorMode: (mode: EditorMode, buildingId?: string | null) => void
  setCameraMode: (mode: CameraMode) => void
  toggleLevelMode: () => void
  toggleWallMode: () => void
  setViewerDisplayMode: (mode: ViewerDisplayMode) => void
  setMovingCamera: (moving: boolean) => void
  setIsManipulatingImage: (manipulating: boolean) => void
  setIsManipulatingScan: (manipulating: boolean) => void
  setDebug: (debug: boolean) => void
  setPointerPosition: (position: [number, number] | null) => void
  setSelectedItem: (item: any) => void
  setSelectedMaterial: (material: string) => void
  setPaintMode: (mode: PaintMode) => void

  getSelectedElementsSet: () => Set<AnyNodeId>
  getSelectedImageIdsSet: () => Set<string>
  getSelectedScanIdsSet: () => Set<string>

  handleExport: () => void
  handleDeleteSelected: () => void
  handleDeleteSelectedElements: () => void
  handleDeleteSelectedImages: () => void
  handleDeleteSelectedScans: () => void

  groupSelected: () => void
  ungroupSelected: () => void

  serializeLayout: () => any
  loadLayout: (json: any) => void
  /** Load a scene transiently (e.g., from URL) without affecting persisted editor state */
  loadTransientScene: (json: any, sourceUrl?: string) => void
  /** Restore the persisted editor scene from storage */
  restorePersistedScene: () => Promise<void>
  /** Check if current scene is transient (not persisted) */
  isTransientScene: () => boolean
  handleLoadLayout: (file: File) => void
  handleResetToDefault: () => void

  undo: () => void
  redo: () => void

  // Simplified Node Operations
  toggleNodeVisibility: (nodeId: string) => void
  setNodeOpacity: (nodeId: string, opacity: number) => void

  // Helper accessors
  getLevelId: (nodeId: string) => string | null
  getNode: (nodeId: string) => SceneNodeHandle | null

  // Generic node operations
  selectNode: (nodeId: string) => void
  addNode: (nodeData: Omit<AnyNode, 'id'>, parentId: string | null) => string
  moveNode: (nodeId: string, parentId: string) => void
  updateNode: (nodeId: string, updates: Partial<AnyNode>, skipUndo?: boolean) => string
  deleteNode: (nodeId: string) => void
  deleteNodes: (nodeIds: string[]) => void
  deletePreviewNodes: () => void
  commitMove: (
    nodeId: string,
    originalData: {
      position: [number, number]
      rotation: number
      start?: [number, number]
      end?: [number, number]
    },
  ) => void

  // Zone operations
  addZone: (name: string, levelId: string, polygon: [number, number][]) => Zone
  deleteZone: (zoneId: string) => void
  renameZone: (zoneId: string, name: string) => void
  updateZonePolygon: (zoneId: string, polygon: [number, number][]) => void
  setZoneColor: (zoneId: string, color: string) => void

  // Collection operations (logical groupings of nodes)
  selectCollection: (collectionId: string | null) => void
  addCollection: (name: string) => Collection
  deleteCollection: (collectionId: string) => void
  renameCollection: (collectionId: string, name: string) => void
  addNodesToCollection: (collectionId: string, nodeIds: string[]) => void
  removeNodesFromCollection: (collectionId: string, nodeIds: string[]) => void
  startAddToCollection: () => void
  confirmAddToCollection: (collectionId: string) => void
  cancelAddToCollection: () => void

  // View operations
  addView: (viewData: Omit<View, 'id' | 'object'>) => void
  deleteView: (viewId: string) => void
  updateView: (viewId: string, updates: Partial<View>) => void
  applyView: (viewId: string) => void

  // Transaction operations (for grouping multiple operations into one undo step)
  startTransaction: () => void
  commitTransaction: () => void
  cancelTransaction: () => void
  isTransactionActive: () => boolean
  captureSnapshot: (nodeId: string) => void
  trackCreatedNode: (nodeId: string) => void
}

/**
 * Rebuild the spatial grid from the scene graph
 */
function rebuildSpatialGrid(spatialGrid: SpatialGrid, graph: SceneGraph): void {
  spatialGrid.clear()
  const getNode = (id: string) => graph.getNodeById(id as AnyNodeId)?.data() ?? null

  graph.traverse((handle) => {
    const node = handle.data()
    const levelId = getLevelIdForNode(graph.index, handle.id)
    if (levelId) {
      spatialGrid.updateNode(node.id, levelId, node, getNode)
    }
  })
}

/**
 * Process all nodes in a level with their spatial neighbors
 */
function processLevel(
  state: {
    spatialGrid: SpatialGrid
    graph: SceneGraph
    verticalStackingProcessor: VerticalStackingProcessor
    levelHeightProcessor: LevelHeightProcessor
    levelElevationProcessor: LevelElevationProcessor
    roomDetectionProcessor: RoomDetectionProcessor
  },
  levelId: string | null,
): void {
  if (!levelId) return

  const levelHandle = state.graph.getNodeById(levelId as AnyNodeId)
  if (!levelHandle || levelHandle.type !== 'level') return

  const nodeIds = state.spatialGrid.getNodesInLevel(levelId)

  for (const nodeId of nodeIds) {
    const handle = state.graph.getNodeById(nodeId as AnyNodeId)
    if (!handle) continue

    const bounds = state.spatialGrid.getNodeBounds(nodeId)
    if (!bounds) continue

    const neighborIds = state.spatialGrid.query(levelId, bounds)

    const neighbors = Array.from(neighborIds)
      .map((id) => state.graph.getNodeById(id as AnyNodeId)?.data())
      .filter((n): n is AnyNode => n !== undefined)

    const results = state.verticalStackingProcessor.process(neighbors, state.graph)
    const nodeResults = results.filter((r) => r.nodeId === nodeId)

    nodeResults.forEach(({ nodeId, updates }) => {
      // Direct update on graph (triggers onChange)
      state.graph.updateNode(nodeId as AnyNodeId, updates)
    })
  }

  // Step 2: Calculate level height
  const levelNode = levelHandle.data() as unknown as SchemaLevelNode
  const heightResults = state.levelHeightProcessor.process([levelNode], state.graph)
  heightResults.forEach(({ nodeId, updates }) => {
    state.graph.updateNode(nodeId as AnyNodeId, updates)
  })

  // Step 3: Calculate elevation for all levels
  const building = state.graph.nodes.find({ type: 'building' })[0]
  if (building) {
    const allLevels = building.children().map((h) => h.data()) as unknown as SchemaLevelNode[]
    const elevationResults = state.levelElevationProcessor.process(allLevels, state.graph)

    elevationResults.forEach(({ nodeId, updates }) => {
      state.graph.updateNode(nodeId as AnyNodeId, updates)
    })
  }

  // Step 4: Detect rooms and assign wall interior sides
  const roomResults = state.roomDetectionProcessor.process([levelNode], state.graph)
  roomResults.forEach(({ nodeId, updates }) => {
    state.graph.updateNode(nodeId as AnyNodeId, updates)
  })
}

function recomputeAllLevels(state: {
  spatialGrid: SpatialGrid
  graph: SceneGraph
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
  roomDetectionProcessor: RoomDetectionProcessor
}): void {
  const levels = state.graph.nodes.find({ type: 'level' })
  for (const level of levels) {
    processLevel(state, level.id)
  }
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const initialScene = initScene()

      // Handler for graph changes
      const handleGraphChange = (nextScene: Scene) => {
        const currentScene = get().scene

        // Preserve data that is managed outside the graph:
        // - environment: managed directly via setState in updateEnvironment
        // - zones: managed via zone operations in the store
        // - collections: managed via collection operations in the store
        // - metadata: scene-level metadata not managed by the graph
        // The graph's scene copy may have stale data for these fields.
        const sceneWithPreservedData = {
          ...nextScene,
          zones: currentScene.zones,
          collections: currentScene.collections,
          views: currentScene.views,
          metadata: currentScene.metadata,
          root: {
            ...nextScene.root,
            environment: currentScene.root.environment,
          },
        }
        set({ scene: sceneWithPreservedData })

        // Get fresh state after updating scene
        const currentState = get()
        rebuildSpatialGrid(currentState.spatialGrid, currentState.graph)
        recomputeAllLevels(currentState)
      }

      const graph = new SceneGraph(initialScene, {
        onChange: (nextScene) => handleGraphChange(nextScene),
      })

      return {
        scene: initialScene,
        graph,
        spatialGrid: new SpatialGrid(1),
        sceneSource: { type: 'persisted' } as SceneSource,
        commandManager: new CommandManager(),

        verticalStackingProcessor: new VerticalStackingProcessor(),
        levelHeightProcessor: new LevelHeightProcessor(),
        levelElevationProcessor: new LevelElevationProcessor(),
        roomDetectionProcessor: new RoomDetectionProcessor(),

        currentLevel: 0,
        selectedFloorId: null,
        viewMode: 'level',
        viewerDisplayMode: 'objects',
        selectedNodeIds: [],
        isHelpOpen: false,
        isJsonInspectorOpen: false,
        wallsGroupRef: null,
        activeTool: 'wall',
        lastBuildingTool: 'wall',
        lastCatalogCategory: null,
        catalogCategory: null,
        controlMode: 'building',

        // New editor mode system - default to structure mode
        editorMode: 'structure',
        selectedBuildingId: null,
        lastToolByMode: {
          site: null,
          structure: 'wall',
          furnish: 'furniture',
        },
        cameraMode: 'perspective',
        levelMode: 'stacked',
        wallMode: 'cutaway',
        movingCamera: false,
        isManipulatingImage: false,
        isManipulatingScan: false,
        debug: false,
        pointerPosition: null,
        addToCollectionState: { isActive: false, nodeIds: [] },
        selectedCollectionId: null,
        selectedZoneId: null,
        selectedItem: {
          modelUrl: '/items/couch-medium/model.glb',
          scale: [0.4, 0.4, 0.4],
          size: [4, 2],
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
        selectedMaterial: 'brick',
        paintMode: 'wall',

        addLevel: (level) => {
          const { graph, commandManager } = get()
          const command = new AddLevelCommand(level)
          commandManager.execute(command, graph)
        },
        deleteLevel: (levelId) => {
          const { graph, commandManager } = get()
          const command = new DeleteLevelCommand(levelId)
          commandManager.execute(command, graph)
        },
        reorderLevels: (levels) => {
          const { graph, commandManager } = get()
          const command = new ReorderLevelsCommand(levels)
          commandManager.execute(command, graph)
        },
        selectFloor: (floorId) => {
          const state = get()
          if (!floorId) {
            set({
              selectedFloorId: null,
              currentLevel: -1,
              viewMode: 'full',
              controlMode: 'select',
              activeTool: null,
            })
            return
          }

          const level = state.graph.nodes.find({ type: 'level' }).find((l) => l.id === floorId)
          if (level) {
            set({
              selectedFloorId: floorId,
              currentLevel: (level.data() as unknown as SchemaLevelNode).level,
              viewMode: 'level',
              selectedNodeIds: [],
              selectedZoneId: null, // Clear zone selection when floor changes
            })
          }
        },
        selectZone: (zoneId) => {
          const state = get()
          if (!zoneId) {
            set({
              selectedZoneId: null,
              selectedNodeIds: [],
            })
            return
          }

          // Find the zone
          const zone = state.scene.zones?.find((c) => c.id === zoneId)
          if (!zone) return

          // If zone has a levelId, ensure that level is selected
          if (zone.levelId && zone.levelId !== state.selectedFloorId) {
            const level = state.graph.nodes
              .find({ type: 'level' })
              .find((l) => l.id === zone.levelId)
            if (level) {
              set({
                selectedFloorId: zone.levelId,
                currentLevel: (level.data() as unknown as SchemaLevelNode).level,
                viewMode: 'level',
              })
            }
          }

          set({
            selectedZoneId: zoneId,
            selectedNodeIds: [], // Zones are polygon areas, not node containers
          })
        },
        handleNodeSelect: (nodeId, event) => {
          const currentSelection = get().selectedNodeIds
          const updatedSelection = handleSimpleClick(
            currentSelection as AnyNodeId[],
            nodeId as AnyNodeId,
            event,
          )

          const state = get()
          const updates: Partial<StoreState> = {
            selectedNodeIds: updatedSelection,
            selectedZoneId: null, // Clear zone selection when individual nodes are selected
          }

          // Auto-switch level if the selected node is on a different level
          const levelId = getLevelIdForNode(state.graph.index, nodeId as AnyNodeId)
          if (
            levelId &&
            levelId !== state.selectedFloorId &&
            updatedSelection.includes(nodeId as AnyNodeId)
          ) {
            const level = state.graph.nodes.find({ type: 'level' }).find((l) => l.id === levelId)
            if (level) {
              Object.assign(updates, {
                selectedFloorId: levelId,
                currentLevel: (level.data() as unknown as SchemaLevelNode).level,
                viewMode: 'level',
              })
            }
          }

          set(updates)

          // Auto-switch control mode based on node type
          const handle = state.graph.getNodeById(nodeId as AnyNodeId)
          const node = handle?.data()

          if (node?.type === 'site') {
            // Site nodes should enter edit mode for property line editing
            set({ controlMode: 'edit' })
          } else if (node?.type === 'reference-image' || node?.type === 'scan') {
            set({ controlMode: 'guide' })
          } else if (state.controlMode !== 'select' && state.controlMode !== 'edit') {
            set({ controlMode: 'building' })
          }
        },

        // Compatibility Wrappers
        handleElementSelect: (elementId, event) => get().handleNodeSelect(elementId, event),
        setSelectedImageIds: (ids) => set({ selectedNodeIds: ids }), // This overwrites selection, matching previous behavior somewhat
        setSelectedScanIds: (ids) => set({ selectedNodeIds: ids }),

        setIsHelpOpen: (open) => set({ isHelpOpen: open }),
        setIsJsonInspectorOpen: (open) => set({ isJsonInspectorOpen: open }),
        setActiveTool: (tool, catalogCategory) => {
          get().deletePreviewNodes()
          // If catalogCategory is explicitly passed, use it; otherwise clear it unless tool is 'item'
          const newCatalogCategory =
            catalogCategory !== undefined
              ? catalogCategory
              : tool === 'item'
                ? (get().catalogCategory ?? 'furniture')
                : null

          const state = get()
          const updates: Partial<StoreState> = {
            activeTool: tool,
            catalogCategory: newCatalogCategory,
          }

          if (tool !== null) {
            updates.controlMode = 'building'

            // Auto-select floor if none selected
            if (!state.selectedFloorId) {
              const levels = state.graph.nodes.find({ type: 'level' })
              if (levels.length > 0) {
                // Try to find level 0, otherwise default to first level found
                const level0 = levels.find((l) => (l.data() as any).level === 0)
                const targetLevel = level0 || levels[0]

                Object.assign(updates, {
                  selectedFloorId: targetLevel.id,
                  currentLevel: (targetLevel.data() as unknown as SchemaLevelNode).level,
                  viewMode: 'level',
                })
              }
            }
          } else {
            updates.controlMode = 'select'
          }

          set(updates)
        },
        setCatalogCategory: (category) => set({ catalogCategory: category }),
        setControlMode: (mode) => {
          if (mode !== 'building') {
            get().deletePreviewNodes()
          }
          set({ controlMode: mode })
          if (mode !== 'building') {
            // Save current tool and catalog category before clearing so we can restore them when re-entering building mode
            const currentTool = get().activeTool
            const currentCategory = get().catalogCategory
            if (currentTool) {
              set({ lastBuildingTool: currentTool, lastCatalogCategory: currentCategory })
            }
            set({ activeTool: null, catalogCategory: null })
          }
        },
        setEditorMode: (mode, buildingId) => {
          const state = get()

          // Save current tool for the current editor mode
          const currentTool = state.activeTool
          if (currentTool) {
            set({
              lastToolByMode: {
                ...state.lastToolByMode,
                [state.editorMode]: currentTool,
              },
            })
          }

          // Prepare updates
          const updates: Partial<StoreState> = {
            editorMode: mode,
          }

          // Filter selected nodes based on target mode
          if (state.selectedNodeIds.length > 0) {
            const filteredSelection = state.selectedNodeIds.filter((nodeId) => {
              const handle = state.graph.getNodeById(nodeId as AnyNodeId)
              if (!handle) return false
              const nodeType = handle.type

              if (mode === 'site') {
                // Site mode: only keep site or building selections
                return nodeType === 'site' || nodeType === 'building'
              }
              // Structure/Furnish mode: deselect site and building nodes
              return nodeType !== 'site' && nodeType !== 'building'
            })

            if (filteredSelection.length !== state.selectedNodeIds.length) {
              updates.selectedNodeIds = filteredSelection
            }
          }

          // Define available control modes per editor mode
          const modesByEditorMode: Record<EditorMode, ControlMode[]> = {
            site: ['select', 'edit'],
            structure: ['select', 'delete', 'building', 'guide'],
            furnish: ['select', 'delete', 'building', 'painting'],
          }

          // Check if current control mode is available in target editor mode
          const availableModes = modesByEditorMode[mode]
          const currentControlMode = state.controlMode
          const isCurrentModeAvailable = availableModes.includes(currentControlMode)

          // Handle building selection for structure/furnish modes
          if (mode === 'structure' || mode === 'furnish') {
            if (buildingId !== undefined) {
              updates.selectedBuildingId = buildingId
            }

            // Only switch control mode if current one is not available
            if (!isCurrentModeAvailable) {
              updates.controlMode = 'select'
              updates.activeTool = null
              updates.catalogCategory = null
            }
          } else if (mode === 'site') {
            // Clear building selection when entering site mode
            updates.selectedBuildingId = null

            // Only switch control mode if current one is not available
            if (!isCurrentModeAvailable) {
              updates.controlMode = 'select'
            }
            updates.activeTool = null
            updates.catalogCategory = null
          }

          set(updates)
        },
        setCameraMode: (mode) => set({ cameraMode: mode }),
        setMovingCamera: (moving) => set({ movingCamera: moving }),
        setIsManipulatingImage: (manipulating) => set({ isManipulatingImage: manipulating }),
        setIsManipulatingScan: (manipulating) => set({ isManipulatingScan: manipulating }),
        setDebug: (debug) => set({ debug }),
        setSelectedItem: (item) => set({ selectedItem: item }),
        setSelectedMaterial: (material) => set({ selectedMaterial: material }),
        setPaintMode: (mode) => set({ paintMode: mode }),
        setViewerDisplayMode: (mode) => set({ viewerDisplayMode: mode }),
        toggleLevelMode: () =>
          set((state) => ({
            levelMode: state.levelMode === 'stacked' ? 'exploded' : 'stacked',
          })),
        toggleWallMode: () =>
          set((state) => {
            const modes: WallMode[] = ['up', 'cutaway', 'down']
            const currentIndex = modes.indexOf(state.wallMode)
            const nextIndex = (currentIndex + 1) % modes.length
            return { wallMode: modes[nextIndex] }
          }),

        getSelectedElementsSet: () => {
          const state = get()
          const set = new Set<AnyNodeId>()
          state.selectedNodeIds.forEach((id) => {
            const node = state.graph.getNodeById(id as AnyNodeId)?.data()
            // Filter out images/scans to match legacy behavior of "elements"
            if (node && node.type !== 'reference-image' && node.type !== 'scan') {
              set.add(id as AnyNodeId)
            }
          })
          return set
        },
        getSelectedImageIdsSet: () => {
          const state = get()
          const set = new Set<string>()
          state.selectedNodeIds.forEach((id) => {
            const node = state.graph.getNodeById(id as AnyNodeId)?.data()
            if (node?.type === 'reference-image') set.add(id)
          })
          return set
        },
        getSelectedScanIdsSet: () => {
          const state = get()
          const set = new Set<string>()
          state.selectedNodeIds.forEach((id) => {
            const node = state.graph.getNodeById(id as AnyNodeId)?.data()
            if (node?.type === 'scan') set.add(id)
          })
          return set
        },

        handleExport: () => {
          const ref = get().wallsGroupRef
          if (!ref) return
          const exporter = new GLTFExporter()
          exporter.parse(
            ref,
            (result) => {
              const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'house_model.glb'
              link.click()
              URL.revokeObjectURL(url)
            },
            (error) => console.error('Export error:', error),
            { binary: true },
          )
        },

        handleDeleteSelected: () => {
          const state = get()
          if (state.selectedNodeIds.length === 0) return

          const batchCommand = new BatchDeleteCommand(state.selectedNodeIds)
          state.commandManager.execute(batchCommand, state.graph)

          // Remove deleted nodes from any collections they belong to
          const deletedSet = new Set(state.selectedNodeIds)
          const updatedCollections = (state.scene.collections || []).map((c) => ({
            ...c,
            nodeIds: c.nodeIds.filter((id) => !deletedSet.has(id)),
          }))
          set({ scene: { ...state.scene, collections: updatedCollections }, selectedNodeIds: [] })
        },
        handleDeleteSelectedElements: () => get().handleDeleteSelected(),
        handleDeleteSelectedImages: () => get().handleDeleteSelected(),
        handleDeleteSelectedScans: () => get().handleDeleteSelected(),
        handleClear: () => set({ selectedNodeIds: [] }),

        groupSelected: () => {
          const { graph, commandManager, selectedNodeIds } = get()
          if (selectedNodeIds.length < 1) return // Can group 1 node effectively wrapping it, but usually 2+

          const command = new GroupNodesCommand(selectedNodeIds)
          commandManager.execute(command, graph)

          // Select the new group
          set({ selectedNodeIds: [command.getGroupNodeId()] })
        },

        ungroupSelected: () => {
          const { graph, commandManager, selectedNodeIds } = get()
          if (selectedNodeIds.length === 0) return

          const newSelection: string[] = []
          let didUngroup = false

          // Collect all commands first
          for (const id of selectedNodeIds) {
            const handle = graph.getNodeById(id as AnyNodeId)
            if (handle && handle.type === 'group') {
              const children = handle.children()
              children.forEach((c) => {
                newSelection.push(c.id)
              })

              const command = new UngroupNodesCommand(id)
              commandManager.execute(command, graph)
              didUngroup = true
            } else {
              // Keep non-group nodes selected
              newSelection.push(id)
            }
          }

          if (didUngroup) {
            set({ selectedNodeIds: newSelection })
          }
        },

        serializeLayout: () => get().scene,

        loadTransientScene: (json, sourceUrl) => {
          // Load the scene using loadLayout logic but mark it as transient
          // This prevents it from being persisted to storage
          get().loadLayout(json)
          set({
            sceneSource: sourceUrl
              ? { type: 'url', url: sourceUrl }
              : { type: 'url', url: 'unknown' },
          })
        },

        restorePersistedScene: async () => {
          // Force rehydration from storage to restore the persisted editor state
          // This is useful when returning to editor after viewing a transient scene
          const storage = indexedDBStorage
          const raw = await storage.getItem('editor-storage')
          if (raw) {
            try {
              const env = JSON.parse(raw) as { state: any; version: number }
              if (env.state?.scene) {
                get().loadLayout(env.state.scene)
                set({ sceneSource: { type: 'persisted' } })
              }
            } catch (error) {
              console.error('[Storage] Failed to restore persisted scene:', error)
            }
          }
        },

        isTransientScene: () => get().sceneSource.type !== 'persisted',

        loadLayout: (json) => {
          // Helper to ensure all nodes have the 'object: node' marker
          const ensureNodeMarkers = (node: any): void => {
            if (typeof node !== 'object' || node === null) return

            // Mark as node if it has id and type
            if (node.id && node.type && !node.object) {
              node.object = 'node'
            }

            // Recursively process all properties
            for (const value of Object.values(node)) {
              if (Array.isArray(value)) {
                value.forEach((v: any) => {
                  ensureNodeMarkers(v)
                })
              } else if (typeof value === 'object' && value !== null) {
                ensureNodeMarkers(value)
              }
            }
          }

          set({
            selectedNodeIds: [],
            selectedFloorId: null,
            viewMode: 'full',
            controlMode: 'select',
            activeTool: null,
          })

          if (json.root) {
            const root = json.root as any

            const fixBuilding = (b: any) => {
              if (b.levels && !b.children) {
                b.children = b.levels
                delete b.levels
              }
            }

            if (root.buildings && !root.children) {
              if (Array.isArray(root.buildings)) {
                root.buildings.forEach(fixBuilding)
                const site = {
                  id: 'site_default',
                  type: 'site',
                  object: 'node',
                  children: root.buildings,
                }
                root.children = [site]
              }
              delete root.buildings
            } else if (root.children) {
              if (root.children.length > 0 && root.children[0].type === 'building') {
                const buildings = root.children
                buildings.forEach(fixBuilding)
                const site = {
                  id: 'site_default',
                  type: 'site',
                  object: 'node',
                  children: buildings,
                }
                root.children = [site]
              } else {
                root.children.forEach((site: any) => {
                  if (site.children) {
                    site.children.forEach((c: any) => {
                      if (c.type === 'building') fixBuilding(c)
                    })
                  }
                })
              }
            }

            ensureNodeMarkers(root)

            // Parse zones and collections if present
            const zones = Array.isArray(json.zones) ? json.zones : []
            const collections = Array.isArray(json.collections) ? json.collections : []
            const metadata = json.metadata || {}

            const newScene = { root, zones, collections, metadata } as unknown as Scene
            const newGraph = new SceneGraph(newScene, {
              onChange: (s) => handleGraphChange(s),
            })

            set({ scene: newScene, graph: newGraph, sceneSource: { type: 'persisted' } })
            rebuildSpatialGrid(get().spatialGrid, newGraph)
          } else if (json.levels) {
            const migratedRoot = RootNode.parse({
              children: [
                SiteNode.parse({
                  children: [
                    BuildingNode.parse({
                      children: json.levels,
                    }),
                  ],
                }),
              ],
            })
            ensureNodeMarkers(migratedRoot)

            const newScene = {
              root: migratedRoot,
              zones: [],
              collections: [],
              views: [],
              metadata: {},
            } as unknown as Scene
            const newGraph = new SceneGraph(newScene, {
              onChange: (s) => handleGraphChange(s),
            })
            set({ scene: newScene, graph: newGraph, sceneSource: { type: 'persisted' } })
            rebuildSpatialGrid(get().spatialGrid, newGraph)
          }
        },
        handleLoadLayout: (file) => {
          if (file && file.type === 'application/json') {
            const reader = new FileReader()
            reader.onload = (event) => {
              try {
                const json = JSON.parse(event.target?.result as string)
                get().loadLayout(json)
              } catch (error) {
                console.error('Failed to parse layout JSON:', error)
              }
            }
            reader.readAsText(file)
          }
        },
        handleResetToDefault: () => {
          const initialScene = initScene()
          const newGraph = new SceneGraph(initialScene, {
            onChange: (s) => handleGraphChange(s),
          })
          const site = initialScene.root.children?.[0]
          const mainBuilding = site?.children?.find((c) => c.type === 'building')

          set({
            scene: initialScene,
            graph: newGraph,
            sceneSource: { type: 'persisted' },
            currentLevel: 0,
            selectedFloorId: mainBuilding?.children?.[0]?.id ?? null,
            viewMode: 'level',
            selectedNodeIds: [],
          })
          get().commandManager.clear()
          rebuildSpatialGrid(get().spatialGrid, newGraph)
        },

        undo: () => {
          const { commandManager, graph } = get()
          const success = commandManager.undo(graph)
          if (success) {
            set({
              selectedNodeIds: [],
            })
          }
        },
        redo: () => {
          const { commandManager, graph } = get()
          const success = commandManager.redo(graph)
          if (success) {
            set({
              selectedNodeIds: [],
            })
          }
        },

        toggleNodeVisibility: (nodeId) => {
          const { graph } = get()
          const handle = graph.getNodeById(nodeId as AnyNodeId)
          if (handle) {
            const node = handle.data()
            graph.updateNode(nodeId as AnyNodeId, { visible: !(node.visible ?? true) } as any)
          }
        },
        setNodeOpacity: (nodeId, opacity) => {
          get().graph.updateNode(nodeId as AnyNodeId, { opacity } as any)
        },

        getLevelId: (nodeId) => {
          const { graph } = get()
          return getLevelIdForNode(graph.index, nodeId as AnyNodeId)
        },
        getNode: (nodeId) => {
          const { graph } = get()
          return graph.getNodeById(nodeId as AnyNodeId)
        },

        selectNode: (nodeId) => {
          // Force single selection of this node
          const state = get()
          const handle = state.graph.getNodeById(nodeId as AnyNodeId)
          if (!handle) return

          // Set selection
          set({ selectedNodeIds: [nodeId] })

          const node = handle.data()

          // Switch context if needed
          if (node.type === 'level') {
            state.selectFloor(node.id)
          } else if (node.type === 'reference-image' || node.type === 'scan') {
            // Ensure guide mode if selecting reference/scan?
            // Legacy behavior was specific:
            // set({ controlMode: 'guide' })
            // We can keep that if desired, but maybe let the user decide or handle in handleNodeSelect
          }
        },

        addNode: (nodeData, parentId) => {
          const { graph, commandManager } = get()
          const command = new AddNodeCommand(nodeData, parentId)

          // Skip undo if preview node OR if a transaction is active (transaction handles undo via snapshots)
          if ((nodeData as any).editor?.preview || commandManager.isTransactionActive()) {
            command.execute(graph)
          } else {
            commandManager.execute(command, graph)
          }

          return command.getNodeId()
        },

        moveNode: (nodeId, parentId) => {
          const { graph, commandManager } = get()
          const command = new MoveNodeCommand(nodeId, parentId)
          commandManager.execute(command, graph)
        },

        updateNode: (nodeId, updates, skipUndo = false) => {
          const { graph, commandManager } = get()

          const handle = graph.getNodeById(nodeId as AnyNodeId)
          if (!handle) return nodeId
          const fromNode = handle.data()

          const isCommittingPreview =
            (fromNode as any).editor?.preview === true && (updates as any).editor?.preview === false

          if (isCommittingPreview) {
            // Get parent info before deletion
            const parentHandle = handle.parent()
            const parentId = parentHandle ? parentHandle.id : null

            // Recursively collect and clean node data
            const cleanNodeData = (node: any): any => {
              const cleaned = { ...node }

              // Clean up preview flag
              if (cleaned.editor?.preview) {
                cleaned.editor = { ...cleaned.editor, preview: false }
              }

              // Clean up name if it contains "Preview"
              if (cleaned.name && typeof cleaned.name === 'string') {
                cleaned.name = cleaned.name.replace(' Preview', '').replace('Preview ', '')
              }

              // Apply updates to root node
              if (node.id === nodeId) {
                Object.assign(cleaned, updates)
              }

              // Recursively clean children
              if (cleaned.children && Array.isArray(cleaned.children)) {
                cleaned.children = cleaned.children.map((child: any) => cleanNodeData(child))
              }

              return cleaned
            }

            const cleanedData = cleanNodeData(fromNode)

            // Delete preview node (no undo)
            const deleteCommand = new DeleteNodeCommand(nodeId)
            deleteCommand.execute(graph)

            // Add new real node (with undo) - this is the only operation in undo stack
            const { id, ...dataWithoutId } = cleanedData
            const addCommand = new AddNodeCommand(dataWithoutId, parentId, nodeId)
            commandManager.execute(addCommand, graph)

            return nodeId
          }
          const command = new UpdateNodeCommand(nodeId, updates)
          // Skip undo if explicitly requested, preview node, OR if a transaction is active
          if (
            skipUndo ||
            (fromNode as any).editor?.preview ||
            commandManager.isTransactionActive()
          ) {
            command.execute(graph)
          } else {
            commandManager.execute(command, graph)
          }
          return nodeId
        },
        deleteNode: (nodeId) => {
          const { graph, commandManager, scene } = get()
          const handle = graph.getNodeById(nodeId as AnyNodeId)

          const command = new DeleteNodeCommand(nodeId)
          // Skip undo if preview node OR if a transaction is active (transaction handles undo via snapshots)
          if ((handle?.data() as any)?.editor?.preview || commandManager.isTransactionActive()) {
            command.execute(graph)
          } else {
            commandManager.execute(command, graph)
          }

          // Remove the node from any collections it belongs to
          const updatedCollections = (scene.collections || []).map((c) => ({
            ...c,
            nodeIds: c.nodeIds.filter((id) => id !== nodeId),
          }))
          set({ scene: { ...scene, collections: updatedCollections } })
        },

        deleteNodes: (nodeIds) => {
          const { graph, commandManager, scene } = get()

          // Filter out preview nodes and regular nodes
          const previewNodeIds: string[] = []
          const regularNodeIds: string[] = []

          for (const nodeId of nodeIds) {
            const handle = graph.getNodeById(nodeId as AnyNodeId)
            if ((handle?.data() as any)?.editor?.preview) {
              previewNodeIds.push(nodeId)
            } else {
              regularNodeIds.push(nodeId)
            }
          }

          // Delete preview nodes without adding to history
          for (const nodeId of previewNodeIds) {
            const command = new DeleteNodeCommand(nodeId)
            command.execute(graph)
          }

          // Batch delete regular nodes with single history entry
          if (regularNodeIds.length > 0) {
            const command = new BatchDeleteCommand(regularNodeIds)
            commandManager.execute(command, graph)
          }

          // Remove deleted nodes from any collections they belong to
          const deletedSet = new Set(nodeIds)
          const updatedCollections = (scene.collections || []).map((c) => ({
            ...c,
            nodeIds: c.nodeIds.filter((id) => !deletedSet.has(id)),
          }))
          set({ scene: { ...scene, collections: updatedCollections }, selectedNodeIds: [] })
        },

        deletePreviewNodes: () => {
          const { graph } = get()
          const previewIds = Array.from(graph.index.previewIds)

          previewIds.forEach((id) => {
            const command = new DeleteNodeCommand(id)
            command.execute(graph)
          })
        },

        commitMove: (nodeId, originalData) => {
          const { graph, commandManager } = get()
          const handle = graph.getNodeById(nodeId as AnyNodeId)
          if (!handle) return

          const currentNode = handle.data() as any

          // Build update with current position and preview: false
          const updates: any = {
            position: currentNode.position,
            rotation: currentNode.rotation,
            editor: { preview: false },
          }
          // Include wall-specific data if present
          if (currentNode.start && currentNode.end) {
            updates.start = currentNode.start
            updates.end = currentNode.end
          }

          // First, clear preview flag without undo (direct graph update)
          graph.updateNode(nodeId as AnyNodeId, { editor: { preview: false } })

          // Now create an UpdateNodeCommand that records the position change
          // The command will store originalData as previousState for undo
          const command = new UpdateNodeCommand(nodeId, {
            position: currentNode.position,
            rotation: currentNode.rotation,
            ...(currentNode.start && currentNode.end
              ? { start: currentNode.start, end: currentNode.end }
              : {}),
          })

          // Manually set the previousState to originalData so undo restores original position
          ;(command as any).previousState = {
            position: originalData.position,
            rotation: originalData.rotation,
            ...(originalData.start && originalData.end
              ? { start: originalData.start, end: originalData.end }
              : {}),
          }

          // Push to undo stack (execute is a no-op since we already have current values)
          commandManager.execute(command, graph)
        },

        setPointerPosition: (position: [number, number] | null) =>
          set({ pointerPosition: position }),

        // Zone operations
        addZone: (name: string, levelId: string, polygon: [number, number][]) => {
          const zone = ZoneSchema.parse({ name, levelId, polygon })
          const state = get()
          set({
            scene: {
              ...state.scene,
              zones: [...(state.scene.zones || []), zone],
            },
          })
          return zone
        },

        deleteZone: (zoneId: string) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              zones: (state.scene.zones || []).filter((c) => c.id !== zoneId),
            },
          })
        },

        renameZone: (zoneId: string, name: string) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              zones: (state.scene.zones || []).map((c) => (c.id === zoneId ? { ...c, name } : c)),
            },
          })
        },

        updateZonePolygon: (zoneId: string, polygon: [number, number][]) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              zones: (state.scene.zones || []).map((c) =>
                c.id === zoneId ? { ...c, polygon } : c,
              ),
            },
          })
        },

        setZoneColor: (zoneId: string, color: string) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              zones: (state.scene.zones || []).map((c) => (c.id === zoneId ? { ...c, color } : c)),
            },
          })
        },

        // Collection operations (logical groupings of nodes)
        selectCollection: (collectionId) => {
          const state = get()
          if (!collectionId) {
            set({
              selectedCollectionId: null,
              selectedNodeIds: [],
            })
            return
          }

          // Find the collection
          const collection = state.scene.collections?.find((c) => c.id === collectionId)
          if (!collection) return

          // If collection has a levelId, ensure that level is selected
          if (collection.levelId && collection.levelId !== state.selectedFloorId) {
            const level = state.graph.nodes
              .find({ type: 'level' })
              .find((l) => l.id === collection.levelId)
            if (level) {
              set({
                selectedFloorId: collection.levelId,
                currentLevel: (level.data() as unknown as SchemaLevelNode).level,
                viewMode: 'level',
              })
            }
          }

          set({
            selectedCollectionId: collectionId,
            selectedNodeIds: [...collection.nodeIds],
          })
        },

        addCollection: (name: string) => {
          const collection = CollectionSchema.parse({ name })
          const state = get()
          set({
            scene: {
              ...state.scene,
              collections: [...(state.scene.collections || []), collection],
            },
          })
          return collection
        },

        deleteCollection: (collectionId: string) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              collections: (state.scene.collections || []).filter((c) => c.id !== collectionId),
            },
          })
        },

        renameCollection: (collectionId: string, name: string) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              collections: (state.scene.collections || []).map((c) =>
                c.id === collectionId ? { ...c, name } : c,
              ),
            },
          })
        },

        addNodesToCollection: (collectionId: string, nodeIds: string[]) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              collections: (state.scene.collections || []).map((c) => {
                if (c.id !== collectionId) return c
                // Add only node IDs that aren't already in the collection
                const existingIds = new Set(c.nodeIds || [])
                const newIds = nodeIds.filter((id) => !existingIds.has(id))

                // If this is the first node being added, set the levelId from that node
                const isFirstNode = existingIds.size === 0 && newIds.length > 0
                const levelId = isFirstNode
                  ? getLevelIdForNode(state.graph.index, newIds[0] as AnyNodeId)
                  : c.levelId

                return {
                  ...c,
                  nodeIds: [...(c.nodeIds || []), ...newIds],
                  levelId,
                }
              }),
            },
          })
        },

        removeNodesFromCollection: (collectionId: string, nodeIds: string[]) => {
          const state = get()
          const idsToRemove = new Set(nodeIds)
          set({
            scene: {
              ...state.scene,
              collections: (state.scene.collections || []).map((c) => {
                if (c.id !== collectionId) return c
                return { ...c, nodeIds: (c.nodeIds || []).filter((id) => !idsToRemove.has(id)) }
              }),
            },
          })
        },

        startAddToCollection: () => {
          const { selectedNodeIds } = get()
          if (selectedNodeIds.length === 0) return
          set({
            addToCollectionState: {
              isActive: true,
              nodeIds: [...selectedNodeIds],
            },
          })
        },

        confirmAddToCollection: (collectionId: string) => {
          const { addToCollectionState, addNodesToCollection } = get()
          if (!addToCollectionState.isActive || addToCollectionState.nodeIds.length === 0) return
          addNodesToCollection(collectionId, addToCollectionState.nodeIds)
          set({ addToCollectionState: { isActive: false, nodeIds: [] } })
        },

        cancelAddToCollection: () => {
          set({ addToCollectionState: { isActive: false, nodeIds: [] } })
        },

        // View operations
        addView: (viewData) => {
          const view = ViewSchema.parse(viewData)
          const state = get()
          set({
            scene: {
              ...state.scene,
              views: [...(state.scene.views || []), view],
            },
          })
        },

        deleteView: (viewId) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              views: (state.scene.views || []).filter((v) => v.id !== viewId),
            },
          })
        },

        updateView: (viewId, updates) => {
          const state = get()
          set({
            scene: {
              ...state.scene,
              views: (state.scene.views || []).map((v) =>
                v.id === viewId ? { ...v, ...updates } : v,
              ),
            },
          })
        },

        applyView: (viewId) => {
          const state = get()
          const view = state.scene.views?.find((v) => v.id === viewId)
          if (!view) return

          // Apply scene overrides
          if (view.sceneState) {
            if (view.sceneState.selectedLevelId !== undefined) {
              state.selectFloor(view.sceneState.selectedLevelId)
            }
            if (view.sceneState.levelMode) {
              const mode = view.sceneState.levelMode
              if (mode === 'single-floor') {
                set({ viewMode: 'level' })
              } else {
                set({ levelMode: mode as LevelMode, viewMode: 'full' })
              }
            }
            // Add other overrides here (time, visibility) when supported
          }

          // Apply camera
          emitter.emit('view:apply', { camera: view.camera })
        },

        // Transaction operations (for grouping multiple operations into one undo step)
        startTransaction: () => {
          const { commandManager, graph } = get()
          commandManager.startTransaction(graph)
        },

        commitTransaction: () => {
          const { commandManager } = get()
          commandManager.commitTransaction()
        },

        cancelTransaction: () => {
          const { commandManager, graph } = get()
          commandManager.cancelTransaction(graph)
        },

        isTransactionActive: () => {
          const { commandManager } = get()
          return commandManager.isTransactionActive()
        },

        captureSnapshot: (nodeId: string) => {
          const { commandManager } = get()
          const transaction = commandManager.getActiveTransaction()
          if (transaction) {
            transaction.captureSnapshot(nodeId)
          }
        },

        trackCreatedNode: (nodeId: string) => {
          const { commandManager } = get()
          const transaction = commandManager.getActiveTransaction()
          if (transaction) {
            transaction.trackCreatedNode(nodeId)
          }
        },
      }
    },
    {
      name: 'editor-storage',
      version: 5, // Increment version for migration
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => {
        const filterPreviewNodes = (node: SceneNode): SceneNode => {
          const n = { ...node } as any
          for (const key of Object.keys(n)) {
            const value = n[key]
            if (typeof value === 'object' && value !== null) {
              if ((value as any).object === 'node') {
                n[key] = filterPreviewNodes(value)
              } else if (Array.isArray(value)) {
                n[key] = value
                  .filter((item: any) => !(typeof item === 'object' && item?.editor?.preview))
                  .map((item: any) =>
                    typeof item === 'object' && item !== null && item.object === 'node'
                      ? filterPreviewNodes(item)
                      : item,
                  )
              }
            }
          }
          return n as SceneNode
        }

        // Only persist the scene if it's from a persisted source
        // For transient scenes (loaded via URL), keep the last persisted scene in storage
        if (state.sceneSource?.type === 'persisted') {
          const processedRoot = { ...state.scene.root } as RootNode
          if (processedRoot.children) {
            processedRoot.children = processedRoot.children.map(
              (site) => filterPreviewNodes(site) as SiteNode,
            )
          }

          const sceneToStore = {
            ...state.scene,
            root: processedRoot,
            zones: state.scene.zones || [],
            collections: state.scene.collections || [],
          }

          // Cache this as the last persisted scene
          lastPersistedSceneCache = sceneToStore as Scene

          return {
            scene: sceneToStore,
            selectedNodeIds: state.selectedNodeIds,
            debug: state.debug,
          }
        }

        // For transient scenes, persist the cached scene instead (or nothing if no cache)
        // This prevents URL-loaded scenes from overwriting the editor's work-in-progress
        if (lastPersistedSceneCache) {
          return {
            scene: lastPersistedSceneCache,
            // Don't persist selection state from transient scenes
            selectedNodeIds: [],
            debug: state.debug,
          }
        }

        // No cached scene yet - don't persist anything
        // This can happen on first load before any persisted scene exists
        return {
          scene: state.scene,
          selectedNodeIds: [],
          debug: state.debug,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate old keys if present (though partialize won't save them anymore)
          if ((state as any).selectedElements) {
            state.selectedNodeIds = [
              ...((state as any).selectedElements || []),
              ...((state as any).selectedImageIds || []),
              ...((state as any).selectedScanIds || []),
            ]
            delete (state as any).selectedElements
            delete (state as any).selectedImageIds
            delete (state as any).selectedScanIds
          }

          if (state.scene?.root) {
            const root = state.scene.root as any
            const fixBuilding = (b: any) => {
              if (b.levels && !b.children) {
                b.children = b.levels
                delete b.levels
              }
            }
            if (root.buildings && !root.children) {
              if (Array.isArray(root.buildings)) {
                root.buildings.forEach(fixBuilding)
                const site = {
                  id: 'site_default',
                  type: 'site',
                  object: 'node',
                  children: root.buildings,
                }
                root.children = [site]
              }
              delete root.buildings
            } else if (root.children) {
              if (root.children.length > 0 && root.children[0].type === 'building') {
                const buildings = root.children
                buildings.forEach(fixBuilding)
                const site = {
                  id: 'site_default',
                  type: 'site',
                  object: 'node',
                  children: buildings,
                }
                root.children = [site]
              } else {
                root.children.forEach((site: any) => {
                  if (site.children) {
                    site.children.forEach((c: any) => {
                      if (c.type === 'building') fixBuilding(c)
                    })
                  }
                })
              }
            }
          } else {
            state.scene = initScene()
          }

          state.commandManager = new CommandManager()
          state.spatialGrid = new SpatialGrid(1)
          // Scene loaded from storage is always persisted source
          state.sceneSource = { type: 'persisted' }
          // Cache the rehydrated scene for transient scene handling
          lastPersistedSceneCache = state.scene

          const handleGraphChange = (nextScene: Scene) => {
            useStore.setState((s) => {
              const currentGraph = s.graph
              rebuildSpatialGrid(s.spatialGrid, currentGraph)
              recomputeAllLevels(s as any)

              // Preserve data that is managed outside the graph:
              // - environment: managed directly via setState in updateEnvironment
              // - zones: managed via zone operations in the store
              // - collections: managed via collection operations in the store
              // - metadata: scene-level metadata not managed by the graph
              // The graph's scene copy may have stale data for these fields.
              return {
                scene: {
                  ...nextScene,
                  zones: s.scene.zones,
                  collections: s.scene.collections,
                  views: s.scene.views,
                  metadata: s.scene.metadata,
                  root: {
                    ...nextScene.root,
                    environment: s.scene.root.environment,
                  },
                },
              }
            })
          }

          state.graph = new SceneGraph(state.scene, {
            onChange: handleGraphChange,
          })

          rebuildSpatialGrid(state.spatialGrid, state.graph)

          const levels = state.graph.nodes.find({ type: 'level' })
          if (!state.selectedFloorId && levels.length > 0) {
            const mainLevel = levels.find((lvl) => (lvl.data() as any).level === 0)
            if (mainLevel) {
              state.selectedFloorId = mainLevel.id
              state.currentLevel = 0
            } else {
              state.selectedFloorId = levels[0].id
              state.currentLevel = (levels[0].data() as unknown as SchemaLevelNode).level
            }
            state.viewMode = 'level'
          }

          if (state.selectedFloorId === null) {
            state.viewMode = 'full'
          } else if (state.viewMode === undefined) {
            state.viewMode = 'level'
          }

          if (!state.selectedNodeIds) state.selectedNodeIds = []

          state.verticalStackingProcessor = new VerticalStackingProcessor()
          state.levelHeightProcessor = new LevelHeightProcessor()
          state.levelElevationProcessor = new LevelElevationProcessor()
        }
      },
    },
  ),
)

export const useEditor = useStore

// Helper to wait for hydration to complete before performing actions
export const waitForHydration = (): Promise<void> => {
  return new Promise((resolve) => {
    // Check if already hydrated
    if (useStore.persist.hasHydrated()) {
      resolve()
      return
    }
    // Otherwise wait for hydration
    const unsubscribe = useStore.persist.onFinishHydration(() => {
      unsubscribe()
      resolve()
    })
  })
}
