'use client'

import type { SetStateAction } from 'react'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WallSegment {
  start: [number, number] // [x, y] intersection coordinates
  end: [number, number] // [x, y] intersection coordinates
  id: string
  isHorizontal: boolean
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
}

export type Tool = 'wall' | 'room' | 'custom-room' | 'door' | 'window' | 'dummy1' | 'dummy2'

export type ControlMode = 'select' | 'delete' | 'building' | 'guide'

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
  level?: number
}

export type LayoutJSON = {
  version: string
  grid: {
    size: number
  }
  components: Component[]
  groups: ComponentGroup[]
  images?: ReferenceImage[] // Optional for backward compatibility
}

type HistoryState = {
  images: ReferenceImage[]
  components: Component[]
}

type StoreState = {
  images: ReferenceImage[]
  components: Component[]
  groups: ComponentGroup[]
  currentLevel: number
  selectedFloorId: string | null
  selectedWallIds: string[]
  selectedImageIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  undoStack: HistoryState[]
  redoStack: HistoryState[]
  activeTool: Tool | null
  controlMode: ControlMode
  movingCamera: boolean
  isManipulatingImage: boolean // Flag to prevent undo stack during drag
  handleClear: () => void
} & {
  setWalls: (walls: string[]) => void
  addGroup: (group: ComponentGroup) => void
  deleteGroup: (groupId: string) => void
  selectFloor: (floorId: string | null) => void
  setImages: (images: ReferenceImage[], pushToUndo?: boolean) => void
  setSelectedWallIds: (ids: string[]) => void
  setSelectedImageIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setWallsGroupRef: (ref: THREE.Group | null) => void
  setActiveTool: (tool: Tool | null) => void
  setControlMode: (mode: ControlMode) => void
  setMovingCamera: (moving: boolean) => void
  setIsManipulatingImage: (manipulating: boolean) => void
  getWallsSet: () => Set<string>
  getSelectedWallIdsSet: () => Set<string>
  getSelectedImageIdsSet: () => Set<string>
  wallSegments: () => WallSegment[]
  handleExport: () => void
  handleUpload: (file: File, level: number) => void
  handleDeleteSelectedWalls: () => void
  handleDeleteSelectedImages: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (file: File) => void
  handleResetToDefault: () => void
  undo: () => void
  redo: () => void
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      images: [],
      components: [],
      groups: [
        {
          id: 'level_0',
          name: 'base level',
          type: 'floor',
          color: '#ffffff',
          level: 0,
        },
      ],
      currentLevel: 0,
      addGroup: (group) => set((state) => ({ groups: [...state.groups, group] })),
      deleteGroup: (groupId) =>
        set((state) => ({
          groups: state.groups.filter((group) => group.id !== groupId),
          components: state.components.filter((comp) => comp.group !== groupId),
        })),
      selectedFloorId: 'level_0',
      selectFloor: (floorId) => {
        const state = get()

        if (!floorId) {
          set({ selectedFloorId: null, currentLevel: -1 })
          return
        }

        // Find or create the component for this floor
        let component = state.components.find((c) => c.type === 'wall' && c.group === floorId)

        const group = state.groups.find((g) => g.id === floorId)

        if (component) {
          set({ selectedFloorId: floorId, currentLevel: group?.level ?? 0 })
        } else {
          // Create a new wall component for this floor
          component = {
            id: `walls-${floorId}`,
            type: 'wall',
            label: `Walls - ${group?.name || floorId}`,
            group: floorId,
            data: { segments: [] },
            createdAt: new Date().toISOString(),
          }

          set({
            components: [...state.components, component],
            currentLevel: group?.level ?? 0,
            selectedFloorId: floorId,
          })
        }
      },
      selectedWallIds: [],
      selectedImageIds: [],
      isHelpOpen: false,
      isJsonInspectorOpen: false,
      wallsGroupRef: null,
      undoStack: [],
      redoStack: [],
      activeTool: 'wall',
      controlMode: 'building',
      movingCamera: false,
      isManipulatingImage: false,
      setWalls: (walls) =>
        set((state) => {
          if (!state.selectedFloorId) {
            return state
          }

          // Get current walls from component for comparison
          const currentComponent = state.components.find(
            (c) => c.type === 'wall' && c.group === state.selectedFloorId,
          )
          const currentWalls = currentComponent?.data.segments.map((seg) => seg.id) || []

          const sortedNew = [...walls].sort()
          const sortedCurrent = [...currentWalls].sort()
          if (
            sortedNew.length === sortedCurrent.length &&
            sortedNew.every((v, i) => v === sortedCurrent[i])
          ) {
            return state
          }

          // Convert wall keys to segments
          const segments: WallSegment[] = []
          for (const wallKey of walls) {
            if (!wallKey.includes('-')) continue
            const parts = wallKey.split('-')
            if (parts.length !== 2) continue

            const [start, end] = parts
            const [x1, y1] = start.split(',').map(Number)
            const [x2, y2] = end.split(',').map(Number)

            if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue

            const isHorizontal = y1 === y2

            segments.push({
              start: [x1, y1],
              end: [x2, y2],
              id: wallKey,
              isHorizontal,
            })
          }

          // Update the component for the current floor
          let updatedComponents = state.components.map((comp) => {
            if (comp.type === 'wall' && comp.group === state.selectedFloorId) {
              return {
                ...comp,
                data: { segments },
              }
            }
            return comp
          })

          // If no component exists for this floor yet, create one
          if (
            !state.components.find((c) => c.type === 'wall' && c.group === state.selectedFloorId)
          ) {
            const newComponent = {
              id: `walls-${state.selectedFloorId}`,
              type: 'wall' as const,
              label: `Walls - ${state.groups.find((g) => g.id === state.selectedFloorId)?.name || state.selectedFloorId}`,
              group: state.selectedFloorId,
              data: { segments },
              createdAt: new Date().toISOString(),
            }
            updatedComponents = [...state.components, newComponent]
          }

          return {
            undoStack: [
              ...state.undoStack,
              { images: state.images, components: state.components },
            ].slice(-50),
            redoStack: [],
            components: updatedComponents,
          }
        }),
      setImages: (images, pushToUndo = true) =>
        set((state) => {
          // Deep comparison to avoid unnecessary undo stack pushes
          const areEqual =
            state.images.length === images.length &&
            state.images.every((img, i) => {
              const newImg = images[i]
              return (
                img.id === newImg.id &&
                img.position[0] === newImg.position[0] &&
                img.position[1] === newImg.position[1] &&
                img.rotation === newImg.rotation &&
                img.scale === newImg.scale &&
                img.url === newImg.url
              )
            })

          if (areEqual) {
            return state
          }

          // Only push to undo stack if requested (used for final commit, not intermediate updates)
          if (pushToUndo) {
            return {
              undoStack: [
                ...state.undoStack,
                { images: state.images, components: state.components },
              ].slice(-50),
              redoStack: [],
              images,
            }
          }

          // Just update images without affecting undo stack (for intermediate drag updates)
          return { images }
        }),
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
      setControlMode: (mode) => {
        set({ controlMode: mode })
        // Clear activeTool when switching away from building mode to prevent mode leakage
        if (mode !== 'building') {
          set({ activeTool: null })
        }
      },
      setMovingCamera: (moving) => set({ movingCamera: moving }),
      setIsManipulatingImage: (manipulating) => set({ isManipulatingImage: manipulating }),
      getWallsSet: () => {
        const state = get()
        if (!state.selectedFloorId) return new Set<string>()

        const component = state.components.find(
          (c) => c.type === 'wall' && c.group === state.selectedFloorId,
        )
        if (!component) return new Set<string>()

        return new Set(component.data.segments.map((seg) => seg.id))
      },
      getSelectedWallIdsSet: () => new Set(get().selectedWallIds),
      getSelectedImageIdsSet: () => new Set(get().selectedImageIds),
      wallSegments: () => {
        const state = get()
        if (!state.selectedFloorId) return []

        const component = state.components.find(
          (c) => c.type === 'wall' && c.group === state.selectedFloorId,
        )
        if (!component) return []

        return component.data.segments
      },
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
      handleUpload: (file: File, level: number) => {
        if (file && (file.type === 'image/png' || file.type === 'image/jpeg')) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const newImage: ReferenceImage = {
              id: `img-${Date.now()}`,
              url: event.target?.result as string,
              name: file.name,
              createdAt: new Date().toISOString(),
              position: [0, 0],
              rotation: 0,
              scale: 1,
              level,
            }
            set((state) => ({ images: [...state.images, newImage] }))
          }
          reader.readAsDataURL(file)
        }
      },
      handleDeleteSelectedImages: () => {
        set((state) => {
          if (state.selectedImageIds.length === 0) return state
          const idsToDelete = new Set(state.selectedImageIds)
          const newImages = state.images.filter((img) => !idsToDelete.has(img.id))
          return {
            images: newImages,
            selectedImageIds: [],
          }
        })
      },
      handleDeleteSelectedWalls: () => {
        const state = get()
        if (state.selectedWallIds.length === 0) return

        const currentWalls = state.getWallsSet()
        const newWallsSet = new Set(currentWalls)

        // Remove selected walls
        for (const wallKey of state.selectedWallIds) {
          newWallsSet.delete(wallKey)
        }

        const newWalls = Array.from(newWallsSet)
        get().setWalls(newWalls)
        set({ selectedWallIds: [] })
      },
      handleClear: () => {
        get().setWalls([])
        set({ selectedWallIds: [] })
      },
      serializeLayout: () => {
        const state = get()
        const images = state.images

        // Walls are already saved in components, no need to update

        return {
          version: '2.0', // Updated version for intersection-based walls
          grid: { size: 61 }, // 61 intersections (60 divisions + 1)
          components: state.components,
          groups: state.groups,
          images, // Include reference images in the layout
        }
      },
      loadLayout: (json: LayoutJSON) => {
        set({ selectedWallIds: [], selectedImageIds: [], selectedFloorId: null })

        // Load groups (floors)
        if (json.groups && Array.isArray(json.groups)) {
          set({ groups: json.groups })
        }

        // Load all components
        if (json.components && Array.isArray(json.components)) {
          set({ components: json.components })
        }

        // Load reference images (if present in the JSON)
        if (json.images && Array.isArray(json.images)) {
          get().setImages(json.images, false) // Don't push to undo stack
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
        set({
          images: [],
          components: [],
          groups: [
            {
              id: 'level_0',
              name: 'base level',
              type: 'floor',
              color: '#ffffff',
              level: 0,
            },
          ],
          currentLevel: 0,
          selectedFloorId: 'level_0',
          selectedWallIds: [],
          selectedImageIds: [],
          undoStack: [],
          redoStack: [],
        })
      },
      undo: () =>
        set((state) => {
          if (state.undoStack.length === 0) return state
          const previous = state.undoStack[state.undoStack.length - 1]
          return {
            components: previous.components,
            images: previous.images,
            undoStack: state.undoStack.slice(0, -1),
            redoStack: [...state.redoStack, { components: state.components, images: state.images }],
            selectedWallIds: [],
            selectedImageIds: [],
          }
        }),
      redo: () =>
        set((state) => {
          if (state.redoStack.length === 0) return state
          const next = state.redoStack[state.redoStack.length - 1]
          return {
            components: next.components,
            images: next.images,
            redoStack: state.redoStack.slice(0, -1),
            undoStack: [...state.undoStack, { components: state.components, images: state.images }],
            selectedWallIds: [],
            selectedImageIds: [],
          }
        }),
    }),
    {
      name: 'editor-storage',
      partialize: (state) => ({
        components: state.components,
        groups: state.groups,
        images: state.images,
        selectedWallIds: state.selectedWallIds,
        selectedImageIds: state.selectedImageIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate: Add missing position, rotation, scale, level to existing images
          if (state.images && state.images.length > 0) {
            state.images = state.images.map((img: any) => ({
              ...img,
              position: img.position ?? [0, 0],
              rotation: img.rotation ?? 0,
              scale: img.scale ?? 1,
              level: img.level ?? 0, // Default to base level
            }))
          }

          // Ensure components and groups are initialized
          if (!state.components) {
            state.components = []
          }
          if (!state.groups) {
            state.groups = [
              {
                id: 'level_0',
                name: 'base level',
                type: 'floor',
                color: '#ffffff',
                level: 0,
              },
            ]
          }

          // Preselect base level if no level is selected
          if (!state.selectedFloorId) {
            state.selectedFloorId = 'level_0'
            state.currentLevel = 0
          }
        }
      },
    },
  ),
)

export const useEditor = useStore

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
    movingCamera: store.movingCamera,
    setMovingCamera: store.setMovingCamera,
    isManipulatingImage: store.isManipulatingImage,
    setIsManipulatingImage: store.setIsManipulatingImage,
    wallSegments: store.wallSegments(),
    handleExport: store.handleExport,
    handleUpload: store.handleUpload,
    handleDeleteSelectedWalls: store.handleDeleteSelectedWalls,
    handleDeleteSelectedImages: store.handleDeleteSelectedImages,
    serializeLayout: store.serializeLayout,
    loadLayout: store.loadLayout,
    handleSaveLayout: store.handleSaveLayout,
    handleLoadLayout: store.handleLoadLayout,
    handleResetToDefault: store.handleResetToDefault,
    undo: store.undo,
    redo: store.redo,
    handleClear: store.handleClear,
    groups: store.groups,
    selectedFloorId: store.selectedFloorId,
    selectFloor: store.selectFloor,
    addGroup: store.addGroup,
    deleteGroup: store.deleteGroup,
  }
}
