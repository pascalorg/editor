'use client'

import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { current, enableMapSet, produce } from 'immer'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

// Enable Map/Set support in Immer
enableMapSet()

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
} from '@/lib/commands/scenegraph-commands'
import { LevelElevationProcessor } from '@/lib/processors/level-elevation-processor'
import { LevelHeightProcessor } from '@/lib/processors/level-height-processor'
import { VerticalStackingProcessor } from '@/lib/processors/vertical-stacking-processor'
import { buildDraftNodeIndex, getLevelIdFromDraft, getLevels } from '@/lib/scenegraph/editor-utils'
import {
  type AnyNode,
  BuildingNode,
  initScene,
  RootNode,
  type Scene,
  type SceneNode,
} from '@/lib/scenegraph/schema/index'
import { calculateNodeBounds, SpatialGrid } from '@/lib/spatial-grid'
import { createId } from '@/lib/utils'

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

  const processedRoot = walk(root) as RootNode
  return { root: processedRoot, assets }
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

  const processedRoot = walk(root) as RootNode
  return processedRoot
}

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

      // Migration: Old format had root directly in state
      if (env.state?.root) {
        const root = injectAssetsIntoRoot(env.state.root as RootNode, assets)
        // Migrate to scene structure
        env.state = {
          ...env.state,
          scene: { root, metadata: {} },
          root: undefined, // Remove old root
        }
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
import type { AnyNodeId, LevelNode as SchemaLevelNode } from '@/lib/scenegraph/schema/index'

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
export type ViewMode = 'full' | 'level'
export type ViewerDisplayMode = 'scans' | 'objects'

type StoreState = {
  // ============================================================================
  // SCENE GRAPH STATE
  // ============================================================================
  scene: Scene
  nodeIndex: Map<string, AnyNode> // Mutable draft index for O(1) access
  spatialGrid: SpatialGrid

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
  selectedElements: AnyNodeId[]
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
  isManipulatingImage: boolean
  isManipulatingScan: boolean
  handleClear: () => void
  pointerPosition: [number, number] | null
  debug: boolean

  selectedItem: {
    modelUrl: string
    scale: [number, number, number]
    size: [number, number]
    position?: [number, number, number]
    rotation?: [number, number, number]
  }

  // Processors
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
} & {
  // Operations
  addLevel: (level: Omit<SchemaLevelNode, 'children'>) => void
  deleteLevel: (levelId: string) => void
  reorderLevels: (levels: SchemaLevelNode[]) => void
  selectFloor: (floorId: string | null) => void

  handleElementSelect: (
    elementId: AnyNodeId,
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
  setPointerPosition: (position: [number, number] | null) => void
  setSelectedItem: (item: any) => void

  getWallsSet: () => Set<string>
  getRoofsSet: () => Set<string>
  getSelectedElementsSet: () => Set<AnyNodeId>
  getSelectedImageIdsSet: () => Set<string>
  getSelectedScanIdsSet: () => Set<string>

  handleExport: () => void
  handleDeleteSelectedElements: () => void
  handleDeleteSelectedImages: () => void
  handleDeleteSelectedScans: () => void

  serializeLayout: () => any
  loadLayout: (json: any) => void
  handleLoadLayout: (file: File) => void
  handleResetToDefault: () => void

  undo: () => void
  redo: () => void

  // Simplified Node Operations
  toggleNodeVisibility: (nodeId: string) => void
  setNodeOpacity: (nodeId: string, opacity: number) => void

  // Helper accessors
  getLevelId: (node: AnyNode) => string | null

  // Generic node operations
  selectNode: (nodeId: string) => void
  addNode: (nodeData: Omit<AnyNode, 'id'>, parentId: string | null) => string
  updateNode: (nodeId: string, updates: Partial<AnyNode>) => string
  deleteNode: (nodeId: string) => void
  deletePreviewNodes: () => void
}

/**
 * Rebuild the spatial grid from the node index
 */
function rebuildSpatialGrid(
  spatialGrid: SpatialGrid,
  nodeIndex: Map<string, SceneNode>,
  root: RootNode,
): void {
  spatialGrid.clear()
  for (const [nodeId, node] of nodeIndex.entries()) {
    const levelId = getLevelIdFromDraft(node, nodeIndex)
    if (levelId) {
      spatialGrid.updateNode(nodeId, levelId, node, nodeIndex)
    }
  }
}

/**
 * Update a node's properties in both the tree and nodeIndex
 */
function updateNodeInDraft(
  nodeId: string,
  updates: Partial<AnyNode>,
  root: RootNode,
  nodeIndex: Map<string, SceneNode>,
): void {
  // Using nodeIndex for direct access since it's mutable in draft
  const node = nodeIndex.get(nodeId)
  if (node) {
    Object.assign(node, updates)
  }
}

/**
 * Process all nodes in a level with their spatial neighbors
 */
function processLevel(
  draft: {
    spatialGrid: SpatialGrid
    nodeIndex: Map<string, SceneNode>
    verticalStackingProcessor: VerticalStackingProcessor
    levelHeightProcessor: LevelHeightProcessor
    levelElevationProcessor: LevelElevationProcessor
    scene: Scene
  },
  levelId: string | null,
): void {
  if (!levelId) return

  const level = draft.nodeIndex.get(levelId)
  if (!level || level.type !== 'level') return

  const nodeIds = draft.spatialGrid.getNodesInLevel(levelId)

  for (const nodeId of nodeIds) {
    const node = draft.nodeIndex.get(nodeId)
    if (!node) continue

    const bounds = draft.spatialGrid.getNodeBounds(nodeId)
    if (!bounds) continue

    const neighborIds = draft.spatialGrid.query(levelId, bounds)
    const neighbors = Array.from(neighborIds)
      .map((id) => draft.nodeIndex.get(id))
      .filter((n): n is AnyNode => n !== undefined)

    const results = draft.verticalStackingProcessor.process(neighbors)
    const nodeResults = results.filter((r) => r.nodeId === nodeId)

    nodeResults.forEach(({ nodeId, updates }) => {
      updateNodeInDraft(nodeId, updates, draft.scene.root, draft.nodeIndex)
    })
  }

  // Step 2: Calculate level height
  const heightResults = draft.levelHeightProcessor.process([level])
  heightResults.forEach(({ nodeId, updates }) => {
    updateNodeInDraft(nodeId, updates, draft.scene.root, draft.nodeIndex)
  })

  // Step 3: Calculate elevation for all levels
  const building = draft.scene.root.buildings?.[0] as BuildingNode | undefined
  if (building && building.type === 'building') {
    const allLevels = building.children
    const elevationResults = draft.levelElevationProcessor.process(allLevels)
    elevationResults.forEach(({ nodeId, updates }) => {
      updateNodeInDraft(nodeId, updates, draft.scene.root, draft.nodeIndex)
    })
  }
}

function recomputeAllLevels(draft: {
  spatialGrid: SpatialGrid
  nodeIndex: Map<string, SceneNode>
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
  scene: Scene
}): void {
  const levels = getLevels(draft.scene.root)
  for (const level of levels) {
    processLevel(draft, level.id)
  }
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const initialScene = initScene()

      return {
        scene: initialScene,
        nodeIndex: new Map(),
        spatialGrid: new SpatialGrid(1),
        commandManager: new CommandManager(),

        verticalStackingProcessor: new VerticalStackingProcessor(),
        levelHeightProcessor: new LevelHeightProcessor(),
        levelElevationProcessor: new LevelElevationProcessor(),

        currentLevel: 0,
        selectedFloorId: null,
        viewMode: 'level',
        viewerDisplayMode: 'objects',
        selectedElements: [],
        selectedImageIds: [],
        selectedScanIds: [],
        isHelpOpen: false,
        isJsonInspectorOpen: false,
        wallsGroupRef: null,
        activeTool: 'wall',
        controlMode: 'building',
        cameraMode: 'perspective',
        levelMode: 'stacked',
        movingCamera: false,
        isManipulatingImage: false,
        isManipulatingScan: false,
        debug: false,
        pointerPosition: null,
        selectedItem: {
          modelUrl: '/items/couch-medium/model.glb',
          scale: [0.4, 0.4, 0.4],
          size: [4, 2],
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },

        addLevel: (level) => {
          set(
            produce((draft) => {
              const command = new AddLevelCommand(level)
              draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
              processLevel(draft, level.id)
            }),
          )
        },
        deleteLevel: (levelId) => {
          set(
            produce((draft) => {
              const command = new DeleteLevelCommand(levelId)
              draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
              recomputeAllLevels(draft)
            }),
          )
        },
        reorderLevels: (levels) => {
          set(
            produce((draft) => {
              const command = new ReorderLevelsCommand(levels)
              draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
              recomputeAllLevels(draft)
            }),
          )
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

          const level = getLevels(state.scene.root).find((l) => l.id === floorId)
          if (level) {
            set({
              selectedFloorId: floorId,
              currentLevel: level.level,
              viewMode: 'level',
              selectedElements: [],
            })
          }
        },
        handleElementSelect: (elementId, event) => {
          const currentSelection = get().selectedElements
          const updatedSelection = handleSimpleClick(currentSelection, elementId, event)
          set({ selectedElements: updatedSelection })

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
          get().deletePreviewNodes()
          set({ activeTool: tool })
          if (tool !== null) {
            set({ controlMode: 'building' })
          } else {
            set({ controlMode: 'select' })
          }
        },
        setControlMode: (mode) => {
          if (mode !== 'building') {
            get().deletePreviewNodes()
          }
          set({ controlMode: mode })
          if (mode !== 'building') {
            set({ activeTool: null })
          }
        },
        setCameraMode: (mode) => set({ cameraMode: mode }),
        setMovingCamera: (moving) => set({ movingCamera: moving }),
        setIsManipulatingImage: (manipulating) => set({ isManipulatingImage: manipulating }),
        setIsManipulatingScan: (manipulating) => set({ isManipulatingScan: manipulating }),
        setDebug: (debug) => set({ debug }),
        setSelectedItem: (item) => set({ selectedItem: item }),
        setViewerDisplayMode: (mode) => set({ viewerDisplayMode: mode }),
        toggleLevelMode: () =>
          set((state) => ({
            levelMode: state.levelMode === 'stacked' ? 'exploded' : 'stacked',
          })),

        getWallsSet: () => {
          const state = get()
          const selectedFloorId = state.selectedFloorId
          if (!selectedFloorId) return new Set<string>()

          const level = getLevels(state.scene.root).find((l) => l.id === selectedFloorId)
          if (!level) return new Set<string>()

          const wallKeys = level.children
            .filter((child: any) => child.type === 'wall')
            .map((wall: any) => wall.id)

          return new Set(wallKeys)
        },
        getRoofsSet: () => {
          const state = get()
          const selectedFloorId = state.selectedFloorId
          if (!selectedFloorId) return new Set<string>()

          const level = getLevels(state.scene.root).find((l) => l.id === selectedFloorId)
          if (!level) return new Set<string>()

          const roofKeys = level.children
            .filter((child: any) => child.type === 'roof')
            .map((roof: any) => roof.id)

          return new Set(roofKeys)
        },
        getSelectedElementsSet: () => new Set(get().selectedElements),
        getSelectedImageIdsSet: () => new Set(get().selectedImageIds),
        getSelectedScanIdsSet: () => new Set(get().selectedScanIds),

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

        handleDeleteSelectedElements: () => {
          const state = get()
          if (state.selectedElements.length === 0) return
          const elementIds = [...state.selectedElements]

          set(
            produce((draft) => {
              const affectedLevels = new Set<string>()
              for (const nodeId of elementIds) {
                const node = draft.nodeIndex.get(nodeId)
                if (!node) continue
                const levelId = getLevelIdFromDraft(node, draft.nodeIndex)
                if (levelId) affectedLevels.add(levelId)
              }

              const batchCommand = new BatchDeleteCommand(elementIds)
              draft.commandManager.execute(batchCommand, draft.scene.root, draft.nodeIndex)

              for (const nodeId of elementIds) {
                draft.spatialGrid.removeNode(nodeId)
              }

              for (const levelId of affectedLevels) {
                processLevel(draft, levelId)
              }

              draft.selectedElements = []
            }),
          )
        },
        handleDeleteSelectedImages: () => {
          const state = get()
          const imageIds = [...state.selectedImageIds]
          for (const id of imageIds) {
            get().deleteNode(id)
          }
          set({ selectedImageIds: [] })
        },
        handleDeleteSelectedScans: () => {
          const state = get()
          const scanIds = [...state.selectedScanIds]
          for (const id of scanIds) {
            get().deleteNode(id)
          }
          set({ selectedScanIds: [] })
        },
        handleClear: () => set({ selectedElements: [] }),

        serializeLayout: () => {
          const state = get()
          return {
            version: '3.0',
            grid: { size: 61 },
            root: state.scene.root,
          }
        },
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
                value.forEach(ensureNodeMarkers)
              } else if (typeof value === 'object' && value !== null) {
                ensureNodeMarkers(value)
              }
            }
          }

          set({
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
            selectedFloorId: null,
            viewMode: 'full',
            controlMode: 'select',
            activeTool: null,
          })

          if (json.root) {
            set(
              produce((draft) => {
                // Handle legacy structure in JSON load too if needed
                const root = json.root as any
                if (root.children && !root.buildings) {
                  root.buildings = root.children
                  delete root.children
                }
                if (root.buildings && Array.isArray(root.buildings)) {
                  root.buildings.forEach((building: any) => {
                    if (building.levels && !building.children) {
                      building.children = building.levels
                      delete building.levels
                    }
                  })
                }

                // Ensure all nodes have object: 'node' marker for indexing
                ensureNodeMarkers(root)

                draft.scene.root = root
                draft.nodeIndex = buildDraftNodeIndex(draft.scene.root)
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.scene.root)
              }),
            )
          } else if (json.levels) {
            // Simple legacy migration for levels array
            const migratedRoot = RootNode.parse({
              buildings: [
                BuildingNode.parse({
                  children: json.levels,
                }),
              ],
            })

            // Ensure all nodes have object: 'node' marker for indexing
            ensureNodeMarkers(migratedRoot)

            set(
              produce((draft) => {
                draft.scene.root = migratedRoot
                draft.nodeIndex = buildDraftNodeIndex(draft.scene)
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, migratedRoot)
              }),
            )
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
        handleSaveLayout: () => {
          // Implementation moved to component but keeping empty stub if needed or removing
          // We removed it from return type? No, it's still in the interface in the user query implies "separated logic"
          // But I will remove it from here and implement in component.
          // Actually the interface has it. I will implement it here as it's just downloading.
          // User said "saveLayout can be in it's own component".
          // So I will remove it from here.
          // Wait, I need to remove it from type definition too.
        },

        handleResetToDefault: () => {
          const initialScene = initScene()
          set({
            scene: initialScene,
            nodeIndex: buildDraftNodeIndex(initialScene),
            currentLevel: 0,
            selectedFloorId: initialScene.root.buildings[0].children[0].id,
            viewMode: 'level',
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          })
          get().commandManager.clear()
          const state = get()
          rebuildSpatialGrid(state.spatialGrid, state.nodeIndex, state.scene.root)
        },

        undo: () =>
          set(
            produce((draft) => {
              const success = draft.commandManager.undo(draft.scene.root, draft.nodeIndex)
              if (success) {
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.scene.root)
                recomputeAllLevels(draft)
              }
            }),
          ),
        redo: () =>
          set(
            produce((draft) => {
              const success = draft.commandManager.redo(draft.scene.root, draft.nodeIndex)
              if (success) {
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []
                rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.scene.root)
                recomputeAllLevels(draft)
              }
            }),
          ),

        // Simplified Node Operations
        toggleNodeVisibility: (nodeId) => {
          const node = get().nodeIndex.get(nodeId)
          if (node && 'visible' in node) {
            get().updateNode(nodeId, { visible: !(node.visible ?? true) } as any)
          }
        },
        setNodeOpacity: (nodeId, opacity) => {
          get().updateNode(nodeId, { opacity } as any)
        },

        getLevelId: (node) => getLevelIdFromDraft(node, get().nodeIndex),

        selectNode: (nodeId) => {
          const state = get()
          const node = state.nodeIndex.get(nodeId)
          if (!node) return

          // Clear all selections first
          set({
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          })

          switch (node.type) {
            case 'level':
              get().selectFloor(node.id)
              break
            case 'wall':
            case 'roof':
            case 'column':
              // Use handleElementSelect which handles selection state and mode switching
              get().handleElementSelect(node.id, {})
              break
            case 'image':
              set({ selectedImageIds: [node.id] })
              break
            case 'scan':
              set({ selectedScanIds: [node.id] })
              break
            default: {
              // For elements like doors/windows, try to select parent wall
              const parentId = (node as any).parent
              if (parentId) {
                const parentNode = state.nodeIndex.get(parentId)
                if (parentNode?.type === 'wall') {
                  get().handleElementSelect(parentId, {})
                }
              }
              break
            }
          }
        },

        addNode: (nodeData, parentId) => {
          let nodeId = ''
          set(
            produce((draft) => {
              const command = new AddNodeCommand(nodeData, parentId)
              nodeId = command.getNodeId()

              if ((nodeData as any).editor?.preview) {
                command.execute(draft.scene.root, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
              }

              // Rebuild nodeIndex from tree to ensure all references are up-to-date
              draft.nodeIndex = buildDraftNodeIndex(draft.scene)

              const node = draft.nodeIndex.get(nodeId)

              if (node) {
                const levelId = getLevelIdFromDraft(node, draft.nodeIndex)
                if (levelId) {
                  draft.spatialGrid.updateNode(nodeId, levelId, node, draft.nodeIndex)
                  processLevel(draft, levelId)
                }
              }
            }),
          )
          return nodeId
        },

        updateNode: (nodeId, updates) => {
          let resultNodeId = nodeId
          set(
            produce((draft) => {
              const fromNode = draft.nodeIndex.get(nodeId)

              if (!fromNode) return

              const isCommittingPreview =
                fromNode.editor?.preview === true && (updates as any).editor?.preview === false

              if (isCommittingPreview) {
                const previewNode = current(fromNode)
                const deleteCommand = new DeleteNodeCommand(nodeId)
                deleteCommand.execute(draft.scene.root, draft.nodeIndex)

                const { editor, id, children, parent, ...nodeData } = previewNode as any
                const cleanName =
                  (updates as any).name ||
                  nodeData.name?.replace(' Preview', '').replace('Preview ', '') ||
                  nodeData.type

                // Recursively clear preview flag from all children
                const clearPreviewRecursive = (node: any): any => {
                  const clearedNode = { ...node }
                  if (clearedNode.editor?.preview) {
                    clearedNode.editor = { ...clearedNode.editor, preview: false }
                  }
                  if (Array.isArray(clearedNode.children)) {
                    clearedNode.children = clearedNode.children.map(clearPreviewRecursive)
                  }
                  return clearedNode
                }

                const newNodeData = {
                  ...nodeData,
                  ...updates,
                  name: cleanName,
                }

                // Handle children cleanup if needed
                if (Array.isArray(children)) {
                  newNodeData.children = children.map(clearPreviewRecursive)
                } else {
                  newNodeData.children = []
                }

                const addCommand = new AddNodeCommand(newNodeData, parent)
                resultNodeId = addCommand.getNodeId()
                draft.commandManager.execute(addCommand, draft.scene.root, draft.nodeIndex)

                // Rebuild nodeIndex after committing preview to ensure all children are indexed
                draft.nodeIndex = buildDraftNodeIndex(draft.scene)
              } else {
                const command = new UpdateNodeCommand(nodeId, updates)
                if (fromNode.editor?.preview) {
                  command.execute(draft.scene.root, draft.nodeIndex)
                } else {
                  draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
                }
              }

              const node = draft.nodeIndex.get(resultNodeId)
              if (node) {
                const levelId = getLevelIdFromDraft(node, draft.nodeIndex)
                if (levelId) {
                  draft.spatialGrid.updateNode(resultNodeId, levelId, node, draft.nodeIndex)
                  processLevel(draft, levelId)
                }
              }
            }),
          )
          return resultNodeId
        },

        deleteNode: (nodeId) => {
          set(
            produce((draft) => {
              const node = draft.nodeIndex.get(nodeId)
              const levelId = node ? getLevelIdFromDraft(node, draft.nodeIndex) : null

              const command = new DeleteNodeCommand(nodeId)
              if ((node as any)?.preview) {
                command.execute(draft.scene.root, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.scene.root, draft.nodeIndex)
              }

              draft.spatialGrid.removeNode(nodeId)
              if (levelId) {
                processLevel(draft, levelId)
              }
            }),
          )
        },

        deletePreviewNodes: () => {
          const previewNodeIds = Array.from(get().nodeIndex.values())
            .filter((n) => n.editor?.preview === true)
            .map((n) => n.id)
          set(
            produce((draft) => {
              for (const nodeId of previewNodeIds) {
                const command = new DeleteNodeCommand(nodeId)
                command.execute(draft.scene.root, draft.nodeIndex)
              }
              rebuildSpatialGrid(draft.spatialGrid, draft.nodeIndex, draft.scene.root)
            }),
          )

          return previewNodeIds.length > 0
        },

        setPointerPosition: (position: [number, number] | null) =>
          set({ pointerPosition: position }),
      }
    },
    {
      name: 'editor-storage',
      version: 3, // Increment version to 3 for schema migration
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => {
        const filterPreviewNodes = (node: SceneNode): SceneNode => {
          const n = { ...node } as any

          // Generic traversal
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

        return {
          scene: {
            ...state.scene,
            root: filterPreviewNodes(state.scene.root) as RootNode,
          },
          selectedElements: state.selectedElements,
          selectedImageIds: state.selectedImageIds,
          selectedScanIds: state.selectedScanIds,
          debug: state.debug,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
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
                value.forEach(ensureNodeMarkers)
              } else if (typeof value === 'object' && value !== null) {
                ensureNodeMarkers(value)
              }
            }
          }

          // Data Migration logic for v3
          if (state.scene?.root) {
            const root = state.scene.root as any
            // Migrate children -> buildings
            if (root.children && !root.buildings) {
              root.buildings = root.children
              delete root.children
            }
            // Migrate buildings -> children (legacy reverse check just in case)
            // if (root.buildings && !root.children) ... NO, we want buildings.

            // Migrate BuildingNode levels -> children
            if (root.buildings && Array.isArray(root.buildings)) {
              root.buildings.forEach((building: any) => {
                if (building.levels && !building.children) {
                  building.children = building.levels
                  delete building.levels
                }
              })
            }

            // Ensure all nodes have object: 'node' marker for indexing
            ensureNodeMarkers(root)
          } else {
            // Fallback initialization
            state.scene = initScene()
          }

          state.nodeIndex = buildDraftNodeIndex(state.scene)
          state.commandManager = new CommandManager()
          state.spatialGrid = new SpatialGrid(1)
          rebuildSpatialGrid(state.spatialGrid, state.nodeIndex, state.scene.root)

          const levels = getLevels(state.scene.root)
          if (!state.selectedFloorId && levels.length > 0) {
            state.selectedFloorId = levels[0].id
            state.currentLevel = 0
            state.viewMode = 'level'
          }

          if (state.selectedFloorId === null) {
            state.viewMode = 'full'
          } else if (state.viewMode === undefined) {
            state.viewMode = 'level'
          }

          if (!state.selectedScanIds) state.selectedScanIds = []
        }
      },
    },
  ),
)

export const useEditor = useStore
