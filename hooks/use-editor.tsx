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
  getLevelId: (nodeId: string) => string | null
  getNode: (nodeId: string) => SceneNodeHandle | null

  // Generic node operations
  selectNode: (nodeId: string) => void
  addNode: (nodeData: Omit<AnyNode, 'id'>, parentId: string | null) => string
  updateNode: (nodeId: string, updates: Partial<AnyNode>, skipUndo?: boolean) => string
  deleteNode: (nodeId: string) => void
  deletePreviewNodes: () => void
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

    const results = state.verticalStackingProcessor.process(neighbors)
    const nodeResults = results.filter((r) => r.nodeId === nodeId)

    nodeResults.forEach(({ nodeId, updates }) => {
      // Direct update on graph (triggers onChange)
      state.graph.updateNode(nodeId as AnyNodeId, updates)
    })
  }

  // Step 2: Calculate level height
  const levelNode = levelHandle.data() as unknown as SchemaLevelNode
  const heightResults = state.levelHeightProcessor.process([levelNode])
  heightResults.forEach(({ nodeId, updates }) => {
    state.graph.updateNode(nodeId as AnyNodeId, updates)
  })

  // Step 3: Calculate elevation for all levels
  const building = state.graph.nodes.find({ type: 'building' })[0]
  if (building) {
    const allLevels = building.children().map((h) => h.data()) as unknown as SchemaLevelNode[]
    const elevationResults = state.levelElevationProcessor.process(allLevels)
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
        const state = get()
        set({ scene: nextScene })

        const currentGraph = get().graph
        rebuildSpatialGrid(state.spatialGrid, currentGraph)
        recomputeAllLevels(get())
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

          const batchCommand = new BatchDeleteCommand(elementIds)
          state.commandManager.execute(batchCommand, state.graph)

          // UI updates
          set({ selectedElements: [] })
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

            const newScene = { root } as unknown as Scene
            const newGraph = new SceneGraph(newScene, {
              onChange: (s) => handleGraphChange(s),
            })

            set({ scene: newScene, graph: newGraph })
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

            const newScene = { root: migratedRoot } as unknown as Scene
            const newGraph = new SceneGraph(newScene, {
              onChange: (s) => handleGraphChange(s),
            })
            set({ scene: newScene, graph: newGraph })
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
            currentLevel: 0,
            selectedFloorId: mainBuilding?.children?.[0]?.id ?? null,
            viewMode: 'level',
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          })
          get().commandManager.clear()
          rebuildSpatialGrid(get().spatialGrid, newGraph)
        },

        undo: () => {
          const { commandManager, graph } = get()
          const success = commandManager.undo(graph)
          if (success) {
            set({
              selectedElements: [],
              selectedImageIds: [],
              selectedScanIds: [],
            })
          }
        },
        redo: () => {
          const { commandManager, graph } = get()
          const success = commandManager.redo(graph)
          if (success) {
            set({
              selectedElements: [],
              selectedImageIds: [],
              selectedScanIds: [],
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
          const state = get()
          const handle = state.graph.getNodeById(nodeId as AnyNodeId)
          if (!handle) return

          const node = handle.data()

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
              get().handleElementSelect(node.id, {})
              break
            case 'image':
              set({ selectedImageIds: [node.id] })
              break
            case 'scan':
              set({ selectedScanIds: [node.id] })
              break
            default: {
              const parent = handle.parent()
              if (parent && parent.type === 'wall') {
                get().handleElementSelect(parent.id, {})
              }
              break
            }
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

        updateNode: (nodeId, updates, skipUndo = false) => {
          const { graph, commandManager } = get()

          const handle = graph.getNodeById(nodeId as AnyNodeId)
          if (!handle) return nodeId
          const fromNode = handle.data()

          const isCommittingPreview =
            (fromNode as any).editor?.preview === true && (updates as any).editor?.preview === false

          if (isCommittingPreview) {
            // First, update the parent node
            const command = new UpdateNodeCommand(nodeId, updates)
            commandManager.execute(command, graph)

            // Then recursively clear preview flag from all children
            const updatedHandle = graph.getNodeById(nodeId as AnyNodeId)
            if (updatedHandle) {
              const clearPreviewFromChildren = (handle: any) => {
                const children = handle.children()
                for (const childHandle of children) {
                  const child = childHandle.data()
                  if ((child as any).editor?.preview) {
                    const childCommand = new UpdateNodeCommand(child.id, {
                      editor: { ...(child as any).editor, preview: false },
                    })
                    commandManager.execute(childCommand, graph)
                  }
                  // Recurse into child's children
                  clearPreviewFromChildren(childHandle)
                }
              }
              clearPreviewFromChildren(updatedHandle)
            }

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

        deletePreviewNodes: () => {
          const { graph } = get()
          const previewIds = Array.from(graph.index.previewIds)

          previewIds.forEach((id) => {
            const command = new DeleteNodeCommand(id)
            command.execute(graph)
          })
        },

        setPointerPosition: (position: [number, number] | null) =>
          set({ pointerPosition: position }),
      }
    },
    {
      name: 'editor-storage',
      version: 4,
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
          selectedElements: state.selectedElements,
          selectedImageIds: state.selectedImageIds,
          selectedScanIds: state.selectedScanIds,
          debug: state.debug,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
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
              return { scene: nextScene }
            })
          }

          state.graph = new SceneGraph(state.scene, {
            onChange: handleGraphChange,
          })

          rebuildSpatialGrid(state.spatialGrid, state.graph)

          const levels = state.graph.nodes.find({ type: 'level' })
          if (!state.selectedFloorId && levels.length > 0) {
            state.selectedFloorId = levels[0].id
            state.currentLevel = (levels[0].data() as unknown as SchemaLevelNode).level
            state.viewMode = 'level'
          }

          if (state.selectedFloorId === null) {
            state.viewMode = 'full'
          } else if (state.viewMode === undefined) {
            state.viewMode = 'level'
          }

          if (!state.selectedScanIds) state.selectedScanIds = []

          state.verticalStackingProcessor = new VerticalStackingProcessor()
          state.levelHeightProcessor = new LevelHeightProcessor()
          state.levelElevationProcessor = new LevelElevationProcessor()
        }
      },
    },
  ),
)

export const useEditor = useStore
