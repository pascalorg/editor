'use client'

import type { SelectedElement } from '@/lib/building-elements'
import { buildNodeIndex } from '@/lib/nodes/indexes'
import {
  addReferenceImageToLevel,
  addScanToLevel,
  deleteNode,
  setNodeOpacity,
  setNodeVisibility,
} from '@/lib/nodes/operations'
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
// Node-based architecture imports
import type { BaseNode, LevelNode } from '@/lib/nodes/types'

// IndexedDB storage adapter for Zustand persist middleware
const indexedDBStorage: StateStorage = {
  getItem: async (name: string) => {
    const value = await idbGet<string>(name)
    return value ?? null
  },
  setItem: async (name: string, value: string) => {
    await idbSet(name, value)
  },
  removeItem: async (name: string) => {
    await idbDel(name)
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

type HistoryState = {
  levels: LevelNode[]
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
  undoStack: HistoryState[]
  redoStack: HistoryState[]
  activeTool: Tool | null
  controlMode: ControlMode
  cameraMode: CameraMode
  levelMode: LevelMode
  movingCamera: boolean
  isManipulatingImage: boolean // Flag to prevent undo stack during drag
  isManipulatingScan: boolean // Flag to prevent undo stack during scan manipulation
  handleClear: () => void
  cursorPosition: { x: number; y: number }
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
  getWallsSet: () => Set<string>
  getRoofsSet: () => Set<string>
  getSelectedElementsSet: () => Set<SelectedElement>
  getSelectedImageIdsSet: () => Set<string>
  getSelectedScanIdsSet: () => Set<string>
  handleExport: () => void
  handleUpload: (file: File, level: number) => Promise<void>
  handleScanUpload: (file: File, level: number) => Promise<void>
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
  setCursorPosition: (position: { x: number; y: number }) => void
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      // Node-based state initialization with default base level
      levels: [
        {
          id: 'level_0',
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

            // Parse wall key: "x1,y1-x2,y2"
            const [start, end] = wallKey.split('-')
            const [x1, y1] = start.split(',').map(Number)
            const [x2, y2] = end.split(',').map(Number)

            // Calculate wall properties
            const dx = x2 - x1
            const dy = y2 - y1
            const length = Math.sqrt(dx * dx + dy * dy)
            const rotation = Math.atan2(dy, dx)

            // Create new WallNode
            return {
              id: wallKey, // Use wall key as ID for consistency
              type: 'wall',
              name: `Wall ${wallKey}`,
              position: [x1, y1] as [number, number],
              rotation,
              size: [length, 0.2] as [number, number], // 0.2m thickness
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
            undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
            redoStack: [],
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
            const rotation = Math.atan2(dy, dx)

            // Create new RoofNode
            return {
              id: roofKey,
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
            undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
            redoStack: [],
          }
        }),

      selectedFloorId: 'level_0',
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
      undoStack: [],
      redoStack: [],
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
      handleUpload: async (file: File, level: number) => {
        // Convert file to data URL (persists across reloads)
        const reader = new FileReader()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        set((state) => {
          // Find the level to add the image to
          const levelId = `level_${level}`

          const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

          // Create ReferenceImageNode
          const imageNode = {
            id: imageId,
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
            undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
            redoStack: [],
          }
        })
      },
      handleScanUpload: async (file: File, level: number) => {
        // Convert file to data URL (persists across reloads)
        const reader = new FileReader()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        set((state) => {
          // Find the level to add the scan to
          const levelId = `level_${level}`

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
            undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
            redoStack: [],
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
      handleDeleteSelectedElements: () =>
        set((state) => {
          if (state.selectedElements.length === 0) return state

          // Delete all selected building element nodes
          let updatedLevels = state.levels
          for (const element of state.selectedElements) {
            updatedLevels = deleteNode(updatedLevels, element.id)
          }

          return {
            levels: updatedLevels,
            nodeIndex: buildNodeIndex(updatedLevels),
            selectedElements: [],
            undoStack: [...state.undoStack, { levels: state.levels }].slice(-50),
            redoStack: [],
          }
        }),
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
            id: 'level_0',
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
          selectedFloorId: 'level_0',
          viewMode: 'level',
          selectedElements: [],
          selectedImageIds: [],
          selectedScanIds: [],
          undoStack: [],
          redoStack: [],
        })
      },
      undo: () =>
        set((state) => {
          if (state.undoStack.length === 0) return state
          const previous = state.undoStack[state.undoStack.length - 1]
          return {
            levels: previous.levels,
            nodeIndex: buildNodeIndex(previous.levels),
            undoStack: state.undoStack.slice(0, -1),
            redoStack: [...state.redoStack, { levels: state.levels }],
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          }
        }),
      redo: () =>
        set((state) => {
          if (state.redoStack.length === 0) return state
          const next = state.redoStack[state.redoStack.length - 1]
          return {
            levels: next.levels,
            nodeIndex: buildNodeIndex(next.levels),
            redoStack: state.redoStack.slice(0, -1),
            undoStack: [...state.undoStack, { levels: state.levels }],
            selectedElements: [],
            selectedImageIds: [],
            selectedScanIds: [],
          }
        }),
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
      cursorPosition: { x: 0, y: 0 },
      setCursorPosition: (position) => set({ cursorPosition: position }),
    }),
    {
      name: 'editor-storage',
      version: 1, // Increment this when storage format changes
      storage: createJSONStorage(() => indexedDBStorage),
      partialize: (state) => ({
        // Node-based state (single source of truth)
        levels: state.levels,
        // Note: nodeIndex is NOT persisted - it's rebuilt from levels on load

        // Selection state
        selectedElements: state.selectedElements,
        selectedImageIds: state.selectedImageIds,
        selectedScanIds: state.selectedScanIds,
      }),
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
                id: 'level_0',
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

          // Preselect base level if no level is selected
          if (!state.selectedFloorId) {
            state.selectedFloorId = 'level_0'
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
