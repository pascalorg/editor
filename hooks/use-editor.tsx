'use client'

import * as THREE from 'three'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SetStateAction } from 'react'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

export interface WallSegment {
  start: [number, number] // [x, y] intersection coordinates
  end: [number, number]   // [x, y] intersection coordinates
  id: string
  isHorizontal: boolean
}

export interface ReferenceImage {
  id: string
  url: string
  name: string
  createdAt: string
}

export type Tool = 'wall' | 'room' | 'custom-room' | 'door' | 'window' | 'dummy1' | 'dummy2'

export type ControlMode = 'select' | 'delete' | 'building'

export type ComponentData = {
  segments: WallSegment[] // Line segments between intersections
}

export type Component = {
  id: string
  type: 'wall'
  label: string
  group: string | null
  data: ComponentData
  createdAt: string
}

export type ComponentGroup = {
  id: string
  name: string
  type: 'room' | 'floor' | 'outdoor'
  color: string
}

export type LayoutJSON = {
  version: string
  grid: {
    size: number
  }
  components: Component[]
  groups: ComponentGroup[]
}

type StoreState = {
  walls: string[]
  images: ReferenceImage[]
  selectedWallIds: string[]
  selectedImageIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  undoStack: string[][]
  redoStack: string[][]
  activeTool: Tool | null
  controlMode: ControlMode
  handleClear: () => void
} & {
  setWalls: (walls: string[]) => void
  setImages: (images: ReferenceImage[]) => void
  setSelectedWallIds: (ids: string[]) => void
  setSelectedImageIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setWallsGroupRef: (ref: THREE.Group | null) => void
  setActiveTool: (tool: Tool | null) => void
  setControlMode: (mode: ControlMode) => void
  getWallsSet: () => Set<string>
  getSelectedWallIdsSet: () => Set<string>
  getSelectedImageIdsSet: () => Set<string>
  wallSegments: () => WallSegment[]
  handleExport: () => void
  handleUpload: (file: File) => void
  handleDeleteSelectedWalls: () => void
  handleDeleteSelectedImages: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (file: File) => void
  undo: () => void
  redo: () => void
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      walls: [],
      images: [],
      selectedWallIds: [],
      selectedImageIds: [],
      isHelpOpen: false,
      isJsonInspectorOpen: false,
      wallsGroupRef: null,
      undoStack: [],
      redoStack: [],
      activeTool: 'wall',
      controlMode: 'building',
      setWalls: (walls) => set(state => {
        const sortedNew = [...walls].sort()
        const sortedCurrent = [...state.walls].sort()
        if (sortedNew.length === sortedCurrent.length && sortedNew.every((v, i) => v === sortedCurrent[i])) {
          return state
        }
        return {
          undoStack: [...state.undoStack, state.walls].slice(-50),
          redoStack: [],
          walls
        }
      }),
      setImages: (images) => set({ images }),
      setSelectedWallIds: (ids) => set({ selectedWallIds: ids }),
      setSelectedImageIds: (ids) => set({ selectedImageIds: ids }),
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
      setControlMode: (mode) => set({ controlMode: mode }),
      getWallsSet: () => new Set(get().walls),
      getSelectedWallIdsSet: () => new Set(get().selectedWallIds),
      getSelectedImageIdsSet: () => new Set(get().selectedImageIds),
      wallSegments: () => {
        const walls = get().getWallsSet()
        const segments: WallSegment[] = []
        
        for (const wallKey of walls) {
          // Check if this is the new format "x1,y1-x2,y2" or old format "x,y"
          if (!wallKey.includes('-')) {
            // Skip old format tiles - they're incompatible with the new system
            continue
          }
          
          // Parse "x1,y1-x2,y2" format
          const parts = wallKey.split('-')
          if (parts.length !== 2) continue // Invalid format
          
          const [start, end] = parts
          const [x1, y1] = start.split(',').map(Number)
          const [x2, y2] = end.split(',').map(Number)
          
          // Validate all coordinates are numbers
          if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue
          
          const isHorizontal = y1 === y2
          
          segments.push({
            start: [x1, y1],
            end: [x2, y2],
            id: wallKey,
            isHorizontal
          })
        }
        
        return segments
      },
      handleExport: () => {
        const ref = get().wallsGroupRef
        if (!ref) return;

        const exporter = new GLTFExporter();

        exporter.parse(
          ref,
          (result: ArrayBuffer | { [key: string]: unknown }) => {
            const blob = new Blob([result as ArrayBuffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'house_model.glb';
            link.click();
            URL.revokeObjectURL(url);
          },
          (error: ErrorEvent) => {
            console.error('Export error:', error);
          },
          { binary: true }
        );
      },
      handleUpload: (file: File) => {
        if (file && (file.type === 'image/png' || file.type === 'image/jpeg')) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const newImage: ReferenceImage = {
              id: `img-${Date.now()}`,
              url: event.target?.result as string,
              name: file.name,
              createdAt: new Date().toISOString()
            }
            set(state => ({ images: [...state.images, newImage] }))
          }
          reader.readAsDataURL(file)
        }
      },
      handleDeleteSelectedImages: () => {
        set(state => {
          if (state.selectedImageIds.length === 0) return state
          const idsToDelete = new Set(state.selectedImageIds)
          const newImages = state.images.filter(img => !idsToDelete.has(img.id))
          return {
            images: newImages,
            selectedImageIds: []
          }
        })
      },
      handleDeleteSelectedWalls: () => {
        set(state => {
          if (state.selectedWallIds.length === 0) return state
          const newWallsSet = new Set(state.walls)
          // segmentId is now the wall key in format "x1,y1-x2,y2"
          for (const wallKey of state.selectedWallIds) {
            newWallsSet.delete(wallKey)
          }
          const newWalls = Array.from(newWallsSet)
          // Since setWalls will handle undoStack, call it
          get().setWalls(newWalls)
          return { selectedWallIds: [] }
        })
      },
      handleClear: () => {
        get().setWalls([])
        set({ selectedWallIds: [] })
      },
      serializeLayout: () => {
        const wallSegments = get().wallSegments()

        return {
          version: '2.0', // Updated version for intersection-based walls
          grid: { size: 61 }, // 61 intersections (60 divisions + 1)
          components: [{
            id: 'walls-default',
            type: 'wall',
            label: 'All Walls',
            group: null,
            data: {
              segments: wallSegments
            },
            createdAt: new Date().toISOString()
          }],
          groups: []
        }
      },
      loadLayout: (json: LayoutJSON) => {
        set({ selectedWallIds: [] })
        const wallComponent = json.components.find(c => c.type === 'wall')
        if (wallComponent?.data.segments) {
          const newWalls = wallComponent.data.segments.map(seg => 
            `${seg.start[0]},${seg.start[1]}-${seg.end[0]},${seg.end[1]}`
          )
          get().setWalls(newWalls)
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
      undo: () => set(state => {
        if (state.undoStack.length === 0) return state
        const previous = state.undoStack[state.undoStack.length - 1]
        return {
          walls: previous,
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, state.walls],
          selectedWallIds: []
        }
      }),
      redo: () => set(state => {
        if (state.redoStack.length === 0) return state
        const next = state.redoStack[state.redoStack.length - 1]
        return {
          walls: next,
          redoStack: state.redoStack.slice(0, -1),
          undoStack: [...state.undoStack, state.walls],
          selectedWallIds: []
        }
      }),
    }),
    {
      name: 'editor-storage',
      partialize: (state) => ({
        walls: state.walls,
        images: state.images,
        selectedWallIds: state.selectedWallIds,
        selectedImageIds: state.selectedImageIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate: Remove old format walls (tile-based "x,y" format)
          // Keep only new format walls (line-based "x1,y1-x2,y2" format)
          const validWalls = state.walls.filter(wallKey => wallKey.includes('-'))
          if (validWalls.length !== state.walls.length) {
            console.log(`Migrated: Removed ${state.walls.length - validWalls.length} old format walls`)
            state.walls = validWalls
            state.selectedWallIds = []
          }
        }
      },
    }
  )
)

export const useEditor = useStore;

export const useEditorContext = () => {
  const store = useStore()
  return {
    walls: store.getWallsSet(),
    setWalls: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getWallsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setWalls(Array.from(newSet))
    },
    images: store.images,
    setImages: store.setImages,
    selectedWallIds: store.getSelectedWallIdsSet(),
    setSelectedWallIds: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getSelectedWallIdsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setSelectedWallIds(Array.from(newSet))
    },
    selectedImageIds: store.getSelectedImageIdsSet(),
    setSelectedImageIds: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getSelectedImageIdsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setSelectedImageIds(Array.from(newSet))
    },
    isHelpOpen: store.isHelpOpen,
    setIsHelpOpen: store.setIsHelpOpen,
    isJsonInspectorOpen: store.isJsonInspectorOpen,
    setIsJsonInspectorOpen: store.setIsJsonInspectorOpen,
    wallsGroupRef: store.wallsGroupRef,
    setWallsGroupRef: store.setWallsGroupRef,
    activeTool: store.activeTool,
    setActiveTool: store.setActiveTool,
    controlMode: store.controlMode,
    setControlMode: store.setControlMode,
    wallSegments: store.wallSegments(),
    handleExport: store.handleExport,
    handleUpload: store.handleUpload,
    handleDeleteSelectedWalls: store.handleDeleteSelectedWalls,
    handleDeleteSelectedImages: store.handleDeleteSelectedImages,
    serializeLayout: store.serializeLayout,
    loadLayout: store.loadLayout,
    handleSaveLayout: store.handleSaveLayout,
    handleLoadLayout: store.handleLoadLayout,
    undo: store.undo,
    redo: store.redo,
    handleClear: store.handleClear,
  }
}
