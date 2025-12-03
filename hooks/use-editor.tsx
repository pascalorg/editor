'use client'

import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { enableMapSet, produce } from 'immer'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

// Enable Map/Set support in Immer
enableMapSet()

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

export type Tool =
  | 'slab'
  | 'ceiling'
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'roof'
  | 'column'
  | 'item'
  | 'stair'

// Catalog categories for the item tool
export type CatalogCategory = 'item' | 'window' | 'door'

export type ControlMode = 'select' | 'delete' | 'building' | 'guide'
export type CameraMode = 'perspective' | 'orthographic'
export type LevelMode = 'stacked' | 'exploded'
export type ViewMode = 'full' | 'level'
export type ViewerDisplayMode = 'scans' | 'objects'

export type StoreState = {
  // ============================================================================
  // SCENE GRAPH STATE
  // ============================================================================
  scene: Scene
  graph: SceneGraph
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
  selectedNodeIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  activeTool: Tool | null
  catalogCategory: CatalogCategory | null
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
    attachTo?: 'ceiling' | 'wall'
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
  setCameraMode: (mode: CameraMode) => void
  toggleLevelMode: () => void
  setViewerDisplayMode: (mode: ViewerDisplayMode) => void
  setMovingCamera: (moving: boolean) => void
  setIsManipulatingImage: (manipulating: boolean) => void
  setIsManipulatingScan: (manipulating: boolean) => void
  setDebug: (debug: boolean) => void
  setPointerPosition: (position: [number, number] | null) => void
  setSelectedItem: (item: any) => void

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
}

function recomputeAllLevels(state: {
  spatialGrid: SpatialGrid
  graph: SceneGraph
  verticalStackingProcessor: VerticalStackingProcessor
  levelHeightProcessor: LevelHeightProcessor
  levelElevationProcessor: LevelElevationProcessor
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

        // Always preserve the current store's environment - the graph doesn't manage environment,
        // it's managed directly via setState in updateEnvironment. The graph's scene copy
        // may have stale environment data.
        const sceneWithCurrentEnv = {
          ...nextScene,
          root: {
            ...nextScene.root,
            environment: currentScene.root.environment,
          },
        }
        set({ scene: sceneWithCurrentEnv })

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
        commandManager: new CommandManager(),

        verticalStackingProcessor: new VerticalStackingProcessor(),
        levelHeightProcessor: new LevelHeightProcessor(),
        levelElevationProcessor: new LevelElevationProcessor(),

        currentLevel: 0,
        selectedFloorId: null,
        viewMode: 'level',
        viewerDisplayMode: 'objects',
        selectedNodeIds: [],
        isHelpOpen: false,
        isJsonInspectorOpen: false,
        wallsGroupRef: null,
        activeTool: 'wall',
        catalogCategory: null,
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
            })
          }
        },
        handleNodeSelect: (nodeId, event) => {
          const currentSelection = get().selectedNodeIds
          const updatedSelection = handleSimpleClick(
            currentSelection as AnyNodeId[],
            nodeId as AnyNodeId,
            event,
          )
          set({ selectedNodeIds: updatedSelection })

          // Auto-switch control mode based on node type?
          // For now, if we select something, we might want to switch to appropriate mode
          // But simpler is: if not in 'select' mode, switch to 'building' (legacy logic)
          // Or maybe 'guide' for images?
          const state = get()
          const handle = state.graph.getNodeById(nodeId as AnyNodeId)
          const node = handle?.data()

          if (node?.type === 'image' || node?.type === 'scan') {
            set({ controlMode: 'guide' })
          } else if (state.controlMode !== 'select') {
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
                ? (get().catalogCategory ?? 'item')
                : null
          set({ activeTool: tool, catalogCategory: newCatalogCategory })
          if (tool !== null) {
            set({ controlMode: 'building' })
          } else {
            set({ controlMode: 'select' })
          }
        },
        setCatalogCategory: (category) => set({ catalogCategory: category }),
        setControlMode: (mode) => {
          if (mode !== 'building') {
            get().deletePreviewNodes()
          }
          set({ controlMode: mode })
          if (mode !== 'building') {
            set({ activeTool: null, catalogCategory: null })
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

        getSelectedElementsSet: () => {
          const state = get()
          const set = new Set<AnyNodeId>()
          state.selectedNodeIds.forEach((id) => {
            const node = state.graph.getNodeById(id as AnyNodeId)?.data()
            // Filter out images/scans to match legacy behavior of "elements"
            if (node && node.type !== 'image' && node.type !== 'scan') {
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
            if (node?.type === 'image') set.add(id)
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

          set({ selectedNodeIds: [] })
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

        serializeLayout: () => {
          const state = get()
          return {
            version: '3.0',
            grid: { size: 61 },
            root: state.scene.root,
          }
        },
        loadLayout: (json) => {
          console.log('[loadLayout] Starting layout load')
          console.log('[loadLayout] Input JSON keys:', Object.keys(json))
          console.log('[loadLayout] Input JSON:', JSON.stringify(json, null, 2).slice(0, 1000) + '...')

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

          console.log('[loadLayout] Resetting UI state')
          set({
            selectedNodeIds: [],
            selectedFloorId: null,
            viewMode: 'full',
            controlMode: 'select',
            activeTool: null,
          })

          if (json.root) {
            console.log('[loadLayout] Found json.root - processing root-based layout')
            const root = json.root as any
            console.log('[loadLayout] root.type:', root.type)
            console.log('[loadLayout] root has children:', !!root.children, 'count:', root.children?.length)
            console.log('[loadLayout] root has buildings:', !!root.buildings, 'count:', root.buildings?.length)

            const fixBuilding = (b: any) => {
              console.log('[loadLayout] fixBuilding called for:', b.id, '| has levels:', !!b.levels, '| has children:', !!b.children)
              console.log('[loadLayout] fixBuilding building keys:', Object.keys(b))
              if (b.levels && !b.children) {
                console.log('[loadLayout] fixBuilding: migrating levels to children for building:', b.id)
                b.children = b.levels
                delete b.levels
              }
            }

            if (root.buildings && !root.children) {
              console.log('[loadLayout] BRANCH: root.buildings exists but no root.children - migrating buildings to site')
              if (Array.isArray(root.buildings)) {
                root.buildings.forEach(fixBuilding)
                const site = {
                  id: 'site_default',
                  type: 'site',
                  object: 'node',
                  children: root.buildings,
                }
                root.children = [site]
                console.log('[loadLayout] Created site_default with buildings as children')
              }
              delete root.buildings
            } else if (root.children) {
              console.log('[loadLayout] BRANCH: root.children exists')
              console.log('[loadLayout] First child type:', root.children[0]?.type)
              if (root.children.length > 0 && root.children[0].type === 'building') {
                console.log('[loadLayout] SUB-BRANCH: First child is building - wrapping in site')
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
                console.log('[loadLayout] SUB-BRANCH: First child is NOT building (probably site) - processing nested buildings')
                root.children.forEach((site: any, i: number) => {
                  console.log(`[loadLayout] Processing site ${i}: type=${site.type}, children count=${site.children?.length}`)
                  if (site.children) {
                    site.children.forEach((c: any) => {
                      if (c.type === 'building') {
                        console.log('[loadLayout] Found building in site, fixing:', c.id)
                        fixBuilding(c)
                      }
                    })
                  }
                })
              }
            } else {
              console.log('[loadLayout] BRANCH: root has neither buildings nor children!')
            }

            console.log('[loadLayout] Ensuring node markers on root')
            ensureNodeMarkers(root)

            console.log('[loadLayout] Creating new Scene and SceneGraph')
            console.log('[loadLayout] Final root structure:', JSON.stringify(root, null, 2).slice(0, 2000))
            const newScene = { root } as unknown as Scene
            console.log('[loadLayout] newScene created, root.children count:', newScene.root?.children?.length)

            try {
              const newGraph = new SceneGraph(newScene, {
                onChange: (s) => handleGraphChange(s),
              })
              console.log('[loadLayout] SceneGraph created successfully')
              console.log('[loadLayout] Graph node count:', newGraph.index.byId.size)
              console.log('[loadLayout] Graph levels:', newGraph.nodes.find({ type: 'level' }).map(l => l.id))
              console.log('[loadLayout] Graph buildings:', newGraph.nodes.find({ type: 'building' }).map(b => b.id))
              console.log('[loadLayout] Graph sites:', newGraph.nodes.find({ type: 'site' }).map(s => s.id))

              console.log('[loadLayout] Setting new scene and graph in store')
              set({ scene: newScene, graph: newGraph })

              const stateAfterSet = get()
              console.log('[loadLayout] State after set - scene.root.children count:', stateAfterSet.scene.root?.children?.length)
              console.log('[loadLayout] State after set - graph node count:', stateAfterSet.graph.index.byId.size)

              console.log('[loadLayout] Rebuilding spatial grid')
              rebuildSpatialGrid(get().spatialGrid, newGraph)
              console.log('[loadLayout] Done with root-based layout')
            } catch (error) {
              console.error('[loadLayout] ERROR creating SceneGraph:', error)
              throw error
            }
          } else if (json.levels) {
            console.log('[loadLayout] BRANCH: No root but found json.levels - legacy format')
            console.log('[loadLayout] levels count:', json.levels?.length)
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

            const newScene = { root: migratedRoot } as unknown as Scene
            const newGraph = new SceneGraph(newScene, {
              onChange: (s) => handleGraphChange(s),
            })
            set({ scene: newScene, graph: newGraph })
            rebuildSpatialGrid(get().spatialGrid, newGraph)
            console.log('[loadLayout] Done with legacy levels-based layout')
          } else {
            console.log('[loadLayout] WARNING: No root and no levels found in JSON - nothing to load!')
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
          } else if (node.type === 'image' || node.type === 'scan') {
            // Ensure guide mode if selecting reference/scan?
            // Legacy behavior was specific:
            // set({ controlMode: 'guide' })
            // We can keep that if desired, but maybe let the user decide or handle in handleNodeSelect
          }
        },

        addNode: (nodeData, parentId) => {
          const { graph, commandManager } = get()
          const command = new AddNodeCommand(nodeData, parentId)

          if ((nodeData as any).editor?.preview) {
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
          if (skipUndo || (fromNode as any).editor?.preview) {
            command.execute(graph)
          } else {
            commandManager.execute(command, graph)
          }
          return nodeId
        },

        deleteNode: (nodeId) => {
          const { graph, commandManager } = get()
          const handle = graph.getNodeById(nodeId as AnyNodeId)

          const command = new DeleteNodeCommand(nodeId)
          if ((handle?.data() as any)?.editor?.preview) {
            command.execute(graph)
          } else {
            commandManager.execute(command, graph)
          }
        },

        deleteNodes: (nodeIds) => {
          const { graph, commandManager } = get()

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

          // Clear selection after deletion
          set({ selectedNodeIds: [] })
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

        const processedRoot = { ...state.scene.root } as RootNode
        if (processedRoot.children) {
          processedRoot.children = processedRoot.children.map(
            (site) => filterPreviewNodes(site) as SiteNode,
          )
        }

        return {
          scene: {
            ...state.scene,
            root: processedRoot,
          },
          selectedNodeIds: state.selectedNodeIds,
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

          const handleGraphChange = (nextScene: Scene) => {
            useStore.setState((s) => {
              const currentGraph = s.graph
              rebuildSpatialGrid(s.spatialGrid, currentGraph)
              recomputeAllLevels(s as any)

              // Always preserve the current store's environment - the graph doesn't manage environment,
              // it's managed directly via setState in updateEnvironment. The graph's scene copy
              // may have stale environment data.
              return {
                scene: {
                  ...nextScene,
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
