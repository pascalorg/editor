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
import {
  AddNodeCommand,
  CommandManager,
  DeleteNodeCommand,
  UpdateNodeCommand,
} from '@/lib/commands'
import { buildNodeIndex } from '@/lib/nodes/indexes'
import {
  addReferenceImageToLevel,
  addScanToLevel,
  deleteNode,
  setNodeOpacity,
  setNodeVisibility,
} from '@/lib/nodes/operations'
// Node-based architecture imports
import type { AnyNode, BaseNode, LevelNode } from '@/lib/nodes/types'
import { mapTree } from '@/lib/nodes/utils'
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

// IndexedDB storage adapter for Zustand persist middleware (split keys)
const indexedDBStorage: StateStorage = {
  getItem: async (name: string) => {
    // Back-compat: migrate single key to split keys (one-time migration)
    const legacy = await idbGet<string>(name)
    if (legacy) {
      try {
        const env = JSON.parse(legacy) as PersistEnvelope
        if (env.state?.levels && Array.isArray(env.state.levels)) {
          const { levels, assets } = extractAssetsFromLevels(env.state.levels as LevelNode[])
          const structure = JSON.stringify({
            state: { ...env.state, levels },
            version: env.version,
          })
          const assetsJson = JSON.stringify({ assets })
          await idbSet(`${name}:structure`, structure)
          await idbSet(`${name}:assets`, assetsJson)
          await idbDel(name) // Remove old single-key entry
          // Return merged state for immediate use
          const merged = {
            ...env,
            state: {
              ...env.state,
              levels: injectAssetsIntoLevels(levels, assets),
            },
          }
          return JSON.stringify(merged)
        }
      } catch (error) {
        console.warn('[Storage] Migration failed, using legacy format:', error)
        // If migration fails, return as-is
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
      // Merge assets back into levels
      env.state = {
        ...env.state,
        levels: injectAssetsIntoLevels(env.state.levels as LevelNode[], assets),
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
      const hasValidLevels = env.state?.levels && Array.isArray(env.state.levels)
      if (!hasValidLevels) {
        // Fallback: store unmodified if structure is invalid
        await idbSet(name, value)
        return
      }

      // Extract assets from levels
      const { levels, assets } = extractAssetsFromLevels(env.state.levels as LevelNode[])

      // Save structure (lightweight, updates frequently)
      const structureToSave = JSON.stringify({
        state: { ...env.state, levels },
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
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'door'
  | 'window'
  | 'roof'
  | 'column'
  | 'dummy1'
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
  levels: LevelNode[]
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
  levels: LevelNode[] // Node tree hierarchy
  nodeIndex: Map<string, BaseNode> // Fast lookup by ID

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
  commandManager: CommandManager
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
} & {
  // Node-based operations
  updateLevels: (levels: LevelNode[], pushToUndo?: boolean) => void
  addLevel: (level: Omit<LevelNode, 'children'>) => void
  deleteLevel: (levelId: string) => void
  reorderLevels: (levels: LevelNode[]) => void
  selectFloor: (floorId: string | null) => void

  setWalls: (walls: string[]) => void
  setRoofs: (roofs: string[]) => void

  setSelectedElements: (elements: SelectedElement[]) => void
  setSelectedImageIds: (ids: string[]) => void
  setSelectedScanIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setWallsGroupRef: (ref: THREE.Group | null) => void
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
  toggleBuildingElementVisibility: (elementId: string, type: 'wall' | 'roof' | 'column') => void
  toggleImageVisibility: (imageId: string) => void
  toggleScanVisibility: (scanId: string) => void
  setFloorOpacity: (floorId: string, opacity: number) => void
  setBuildingElementOpacity: (
    elementId: string,
    type: 'wall' | 'roof' | 'column',
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

  // Preview wall placement methods
  startWallPreview: (startPoint: [number, number]) => void
  updateWallPreview: (endPoint: [number, number]) => void
  commitWallPreview: () => void
  cancelWallPreview: () => void
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      return {
        // Node-based state initialization with default base level
        levels: [
          {
            id: createId('level'),
            type: 'level',
            name: 'base level',
            level: 0,
            visible: true,
            children: [],
          },
        ],
        nodeIndex: new Map(), // Will be built from levels

        // UI state initialization
        currentLevel: 0,
        updateLevels: (levels, pushToUndo = true) =>
          set((state) => {
            const newIndex = buildNodeIndex(levels)
            if (pushToUndo) {
              return {
                levels,
                nodeIndex: newIndex,
                undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
                redoStack: [],
              }
            }
            return { levels, nodeIndex: newIndex }
          }),
        addLevel: (level) =>
          set((state) => {
            const newLevel: LevelNode = { ...level, children: [] }
            const updatedLevels = [...state.levels, newLevel]
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        deleteLevel: (levelId) =>
          set((state) => {
            const updatedLevels = state.levels.filter((l) => l.id !== levelId)
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        reorderLevels: (levels) =>
          set({
            levels,
            nodeIndex: buildNodeIndex(levels),
          }),

        // Building element operations
        setWalls: (wallKeys) =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) {
              console.warn('No floor selected, cannot set walls')
              return state
            }

            // Get existing walls to preserve their children (doors/windows)
            const level = state.levels.find((l) => l.id === selectedFloorId)
            if (!level) return state

            const existingWalls = level.children.filter((child) => child.type === 'wall') as any[]
            const existingWallsMap = new Map(existingWalls.map((w) => [w.id, w]))

            // Convert wall keys to WallNode objects
            const wallNodes: any[] = wallKeys.map((wallKey) => {
              // Check if this wall already exists
              const existingWall = existingWallsMap.get(wallKey)
              if (existingWall) {
                // Preserve existing wall with its children
                return existingWall
              }

              // Parse wall key: "x1,z1-x2,z2"
              const [start, end] = wallKey.split('-')
              const [x1, z1] = start.split(',').map(Number)
              const [x2, z2] = end.split(',').map(Number)

              // Calculate wall properties
              const dx = x2 - x1
              const dz = z2 - z1
              const length = Math.sqrt(dx * dx + dz * dz)
              const rotation = Math.atan2(-dz, dx) // Negate dz to match 3D z-axis direction

              // Create new WallNode
              return {
                id: createId('wall'),
                type: 'wall',
                name: `Wall ${wallKey}`,
                position: [x1, z1] as [number, number],
                rotation,
                size: [length, 0.2] as [number, number], // 0.2m thickness
                start: { x: x1, z: z1 }, // Start point in grid coordinates
                end: { x: x2, z: z2 }, // End point in grid coordinates
                visible: true,
                opacity: 100,
                children: [],
                parent: selectedFloorId,
              }
            })

            // Update the current level's walls
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                // Remove existing walls and add new/updated ones
                const nonWalls = level.children.filter((child) => child.type !== 'wall')
                return {
                  ...level,
                  children: [...nonWalls, ...wallNodes],
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        setRoofs: (roofKeys) =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) {
              console.warn('No floor selected, cannot set roofs')
              return state
            }

            // Get existing roofs to preserve their children (roof segments)
            const level = state.levels.find((l) => l.id === selectedFloorId)
            if (!level) return state

            const existingRoofs = level.children.filter((child) => child.type === 'roof') as any[]
            const existingRoofsMap = new Map(existingRoofs.map((r) => [r.id, r]))

            // Convert roof keys to RoofNode objects
            const roofNodes: any[] = roofKeys.map((roofKey) => {
              // Check if this roof already exists
              const existingRoof = existingRoofsMap.get(roofKey)
              if (existingRoof) {
                // Preserve existing roof with its children
                return existingRoof
              }

              // Parse roof key: "x1,y1-x2,y2" or "x1,y1-x2,y2:leftWidth,rightWidth"
              // First check if there are width parameters
              let coordsPart = roofKey
              let leftWidth = 3 // Default 3m
              let rightWidth = 3 // Default 3m

              if (roofKey.includes(':')) {
                const [coords, widths] = roofKey.split(':')
                coordsPart = coords
                const [left, right] = widths.split(',').map(Number)
                if (!isNaN(left)) leftWidth = left
                if (!isNaN(right)) rightWidth = right
              }

              // Parse coordinates
              const [start, end] = coordsPart.split('-')
              const [x1, y1] = start.split(',').map(Number)
              const [x2, y2] = end.split(',').map(Number)

              // Calculate roof properties
              const dx = x2 - x1
              const dy = y2 - y1
              const length = Math.sqrt(dx * dx + dy * dy)
              const rotation = Math.atan2(-dy, dx) // Negate dy to match 3D z-axis direction

              // Create new RoofNode
              return {
                id: createId('roof'),
                type: 'roof',
                name: `Roof ${roofKey}`,
                position: [x1, y1] as [number, number],
                rotation,
                size: [length, leftWidth + rightWidth] as [number, number],
                height: 2.5, // 2.5m peak height
                leftWidth,
                rightWidth,
                visible: true,
                opacity: 100,
                children: [],
                parent: selectedFloorId,
              }
            })

            // Update the current level's roofs
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                // Remove existing roofs and add new/updated ones
                const nonRoofs = level.children.filter((child) => child.type !== 'roof')
                return {
                  ...level,
                  children: [...nonRoofs, ...roofNodes],
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),

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
          const level = state.levels.find((l) => l.id === floorId)

          if (level) {
            set({
              selectedFloorId: floorId,
              currentLevel: level.level,
              viewMode: 'level',
            })
          }
        },
        selectedImageIds: [],
        selectedScanIds: [],
        isHelpOpen: false,
        isJsonInspectorOpen: false,
        wallsGroupRef: null,
        commandManager: new CommandManager(),
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
        setSelectedElements: (elements) => set({ selectedElements: elements }),
        setSelectedImageIds: (ids) => set({ selectedImageIds: ids }),
        setSelectedScanIds: (ids) => set({ selectedScanIds: ids }),
        setIsHelpOpen: (open) => set({ isHelpOpen: open }),
        setIsJsonInspectorOpen: (open) => set({ isJsonInspectorOpen: open }),
        setWallsGroupRef: (ref) => set({ wallsGroupRef: ref }),
        setActiveTool: (tool) => {
          set({ activeTool: tool })
          // Automatically switch to building mode when a building tool is selected
          if (tool !== null) {
            set({ controlMode: 'building' })
          } else {
            set({ controlMode: 'select' })
          }
        },
        setControlMode: (mode) => {
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

          const level = state.levels.find((l) => l.id === selectedFloorId)
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

          const level = state.levels.find((l) => l.id === selectedFloorId)
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
            const updatedLevels = addReferenceImageToLevel(state.levels, levelId, imageNode)

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
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
            const updatedLevels = addScanToLevel(state.levels, levelId, scanNode)

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          })
        },
        handleDeleteSelectedImages: () =>
          set((state) => {
            if (state.selectedImageIds.length === 0) return state

            // Delete all selected image nodes
            let updatedLevels = state.levels
            for (const imageId of state.selectedImageIds) {
              updatedLevels = deleteNode(updatedLevels, imageId)
            }

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
              selectedImageIds: [],
              undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
              redoStack: [],
            }
          }),
        handleDeleteSelectedScans: () =>
          set((state) => {
            if (state.selectedScanIds.length === 0) return state

            // Delete all selected scan nodes
            let updatedLevels = state.levels
            for (const scanId of state.selectedScanIds) {
              updatedLevels = deleteNode(updatedLevels, scanId)
            }

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
              selectedScanIds: [],
              undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
              redoStack: [],
            }
          }),
        handleDeleteSelectedElements: () => {
          const state = get()
          if (state.selectedElements.length === 0) return

          set(
            produce((draft) => {
              // Delete all selected elements using the command manager
              for (const element of state.selectedElements) {
                const command = new DeleteNodeCommand(element.id)
                draft.commandManager.execute(command, draft.levels, draft.nodeIndex)
              }

              // Clear selection
              draft.selectedElements = []
            }),
          )
        },
        handleClear: () => {
          get().setWalls([])
          set({ selectedElements: [] })
        },
        serializeLayout: () => {
          const state = get()

          // PHASE 3 MIGRATION: Serialize using node tree format
          return {
            version: '2.0', // Updated version for intersection-based walls
            grid: { size: 61 }, // 61 intersections (60 divisions + 1)
            levels: state.levels, // Use node tree as source of truth
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

          // Load from node tree format
          if (json.levels && Array.isArray(json.levels)) {
            set({
              levels: json.levels,
              nodeIndex: buildNodeIndex(json.levels),
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
          set({
            levels: defaultLevels,
            nodeIndex: buildNodeIndex(defaultLevels),
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
              const success = draft.commandManager.undo(draft.levels, draft.nodeIndex)
              if (success) {
                // Clear selections after undo
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []
              }
            }),
          ),
        redo: () =>
          set(
            produce((draft) => {
              const success = draft.commandManager.redo(draft.levels, draft.nodeIndex)
              if (success) {
                // Clear selections after redo
                draft.selectedElements = []
                draft.selectedImageIds = []
                draft.selectedScanIds = []
              }
            }),
          ),
        toggleFloorVisibility: (floorId) =>
          set((state) => {
            const updatedLevels = state.levels.map((level) =>
              level.id === floorId ? { ...level, visible: !(level.visible ?? true) } : level,
            )
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        toggleBuildingElementVisibility: (elementId, type) =>
          set((state) => {
            if (!state.selectedFloorId) return state

            // Find the node and toggle its visibility
            const node = state.nodeIndex.get(elementId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(state.levels, elementId, !currentVisibility)

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        toggleImageVisibility: (imageId) =>
          set((state) => {
            const node = state.nodeIndex.get(imageId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(state.levels, imageId, !currentVisibility)

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        toggleScanVisibility: (scanId) =>
          set((state) => {
            const node = state.nodeIndex.get(scanId)
            if (!node) return state

            const currentVisibility = node.visible ?? true
            const updatedLevels = setNodeVisibility(state.levels, scanId, !currentVisibility)

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        setFloorOpacity: (floorId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(state.levels, floorId, opacity)
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        setBuildingElementOpacity: (elementId, type, opacity) =>
          set((state) => {
            if (!state.selectedFloorId) return state

            const updatedLevels = setNodeOpacity(state.levels, elementId, opacity)
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        setImageOpacity: (imageId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(state.levels, imageId, opacity)
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        setScanOpacity: (scanId, opacity) =>
          set((state) => {
            const updatedLevels = setNodeOpacity(state.levels, scanId, opacity)
            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        pointerPosition: null,
        setPointerPosition: (position) => set({ pointerPosition: position }),
        getLevelId: (node) => {
          const state = get()

          // Create a Set of level IDs for fast lookup
          const levelIds = new Set(state.levels.map((l) => l.id))

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
                command.execute(draft.levels, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.levels, draft.nodeIndex)
              }
            }),
          )

          return nodeId
        },

        updateNode: (nodeId, updates) => {
          let resultNodeId = nodeId

          set(
            produce((draft) => {
              const node = draft.nodeIndex.get(nodeId)

              // Check if we're committing a preview node (preview: true -> false)
              const isCommittingPreview = node?.preview === true && updates.preview === false

              if (isCommittingPreview) {
                // Get full node data using current() to get plain object
                const previewNode = current(node)

                // Delete preview node (no undo)
                const deleteCommand = new DeleteNodeCommand(nodeId)
                deleteCommand.execute(draft.levels, draft.nodeIndex)

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
                    newNodeData.children = children.map((child: any) => {
                      const {
                        preview: childPreview,
                        id: childId,
                        parent: childParent,
                        ...childData
                      } = child
                      return {
                        ...childData,
                        name: childData.name.replace(' Preview', '').replace('Preview ', ''),
                      }
                    })
                  } else {
                    // Preserve empty children array
                    newNodeData.children = []
                  }
                }

                // Create new real node (with undo)
                const addCommand = new AddNodeCommand(newNodeData, parent)
                resultNodeId = addCommand.getNodeId()
                draft.commandManager.execute(addCommand, draft.levels, draft.nodeIndex)
              } else {
                // Normal update
                const command = new UpdateNodeCommand(nodeId, updates)

                // Check if we're updating a preview node
                const isPreviewNode = node?.preview === true

                if (!isPreviewNode) {
                  draft.commandManager.execute(command, draft.levels, draft.nodeIndex)
                } else {
                  // Preview node update - execute directly without undo tracking
                  command.execute(draft.levels, draft.nodeIndex)
                }
              }
            }),
          )

          return resultNodeId
        },

        deleteNode: (nodeId) => {
          set(
            produce((draft) => {
              const command = new DeleteNodeCommand(nodeId)

              // Check if we're deleting a preview node
              const node = draft.nodeIndex.get(nodeId)
              if (node?.preview) {
                // Preview node - execute directly without undo tracking
                command.execute(draft.levels, draft.nodeIndex)
              } else {
                draft.commandManager.execute(command, draft.levels, draft.nodeIndex)
              }
            }),
          )
        },

        // Preview wall placement methods
        startWallPreview: (startPoint) =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) return state

            // Create a preview wall node at the start point (zero length initially)
            const previewWallId = 'preview-wall'
            const [x, z] = startPoint
            const previewWall = {
              id: previewWallId,
              type: 'wall' as const,
              name: 'Wall Preview',
              position: startPoint,
              rotation: 0,
              size: [0, 0.2] as [number, number], // Zero length initially
              start: { x, z }, // Start point in grid coordinates
              end: { x, z }, // End point (same as start initially)
              visible: true,
              opacity: 100,
              preview: true, // Mark as preview
              children: [],
              parent: selectedFloorId,
            }

            // Add preview wall to the current level
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                // Remove any existing preview walls first
                const nonPreviewChildren = level.children.filter((child) => !child.preview)
                return {
                  ...level,
                  children: [...nonPreviewChildren, previewWall],
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        updateWallPreview: (endPoint) =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) return state

            // Find the preview wall and update its end point
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                const updatedChildren = level.children.map((child) => {
                  if (child.preview && child.type === 'wall') {
                    const wall = child as any
                    const [x1, z1] = wall.position
                    const [x2, z2] = endPoint

                    // Calculate new wall properties
                    const dx = x2 - x1
                    const dz = z2 - z1
                    const length = Math.sqrt(dx * dx + dz * dz)
                    const rotation = Math.atan2(-dz, dx) // Negate dz to match 3D z-axis direction

                    return {
                      ...wall,
                      rotation,
                      size: [length, 0.2] as [number, number],
                      end: { x: x2, z: z2 }, // Update end point in grid coordinates
                    }
                  }
                  return child
                })

                return {
                  ...level,
                  children: updatedChildren,
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        commitWallPreview: () =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) return state

            // Find the preview wall and convert it to a real wall
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                const updatedChildren = level.children.map((child) => {
                  if (child.preview && child.type === 'wall') {
                    const wall = child as any
                    // Only commit if wall has meaningful length
                    if (wall.size[0] >= 0.5) {
                      // 50cm minimum
                      return {
                        ...wall,
                        id: createId('wall'), // Generate new ID for committed wall
                        preview: false, // No longer a preview
                      }
                    }
                    // If too short, don't commit (will be filtered out below)
                    return null
                  }
                  return child
                })

                return {
                  ...level,
                  children: updatedChildren.filter((child) => child !== null) as any[],
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
        cancelWallPreview: () =>
          set((state) => {
            const selectedFloorId = state.selectedFloorId
            if (!selectedFloorId) return state

            // Remove all preview nodes from the current level
            const updatedLevels = state.levels.map((level) => {
              if (level.id === selectedFloorId) {
                return {
                  ...level,
                  children: level.children.filter((child) => !child.preview),
                }
              }
              return level
            })

            return {
              levels: updatedLevels,
              nodeIndex: buildNodeIndex(updatedLevels),
            }
          }),
      }
    },
    {
      name: 'editor-storage',
      version: 1, // Increment this when storage format changes
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => {
        // Filter out preview nodes before persisting
        const filterPreviewNodes = (nodes: BaseNode[]): BaseNode[] => {
          return nodes
            .filter((node) => !node.preview) // Remove preview nodes
            .map((node) => ({
              ...node,
              children:
                node.children && node.children.length > 0 ? filterPreviewNodes(node.children) : [],
            }))
        }

        const levelsWithoutPreviews = state.levels.map((level) => ({
          ...level,
          children: filterPreviewNodes(level.children) as LevelNode['children'],
        }))

        return {
          // Node-based state (single source of truth)
          levels: levelsWithoutPreviews,
          // Note: nodeIndex is NOT persisted - it's rebuilt from levels on load

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

          // Clean blob URLs from all levels
          if (state.levels && Array.isArray(state.levels)) {
            state.levels = state.levels.map((level) => ({
              ...level,
              children: cleanBlobUrls(level.children) as LevelNode['children'],
            }))
          }

          // Initialize levels array if not present
          if (!state.levels || state.levels.length === 0) {
            state.levels = [
              {
                id: createId('level'),
                type: 'level',
                name: 'base level',
                level: 0,
                visible: true,
                children: [],
              },
            ]
          }

          // Always rebuild node index from levels (Maps can't be persisted)
          state.nodeIndex = buildNodeIndex(state.levels)
          console.log('[Rehydration] Built node index:', {
            nodes: state.nodeIndex.size,
            levels: state.levels.length,
          })

          // Reinitialize command manager (can't be persisted)
          state.commandManager = new CommandManager()

          // Preselect base level if no level is selected
          if (!state.selectedFloorId) {
            state.selectedFloorId = state.levels[0].id
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
