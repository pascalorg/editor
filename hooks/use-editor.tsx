'use client'

import type { SetStateAction } from 'react'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  deleteElements,
  type SelectedElement,
  toggleElementVisibility,
} from '@/lib/building-elements'

export interface WallSegment {
  start: [number, number] // [x, y] intersection coordinates
  end: [number, number] // [x, y] intersection coordinates
  id: string
  isHorizontal: boolean
  visible?: boolean // Optional for backward compatibility
}

export interface RoofSegment {
  start: [number, number] // [x, y] ridge start coordinates
  end: [number, number] // [x, y] ridge end coordinates
  id: string
  height: number // Peak height above base
  leftWidth?: number // Distance from ridge to left edge (defaults to ROOF_WIDTH / 2)
  rightWidth?: number // Distance from ridge to right edge (defaults to ROOF_WIDTH / 2)
  visible?: boolean // Optional for backward compatibility
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
}

export type Tool =
  | 'wall'
  | 'room'
  | 'custom-room'
  | 'door'
  | 'window'
  | 'roof'
  | 'dummy1'
  | 'dummy2'

export type ControlMode = 'select' | 'delete' | 'building' | 'guide'

export type CameraMode = 'perspective' | 'orthographic'

export type LevelMode = 'stacked' | 'exploded'

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

export type ComponentGroup = {
  id: string
  name: string
  type: 'room' | 'floor' | 'outdoor'
  color: string
  level?: number
  visible?: boolean // Optional for backward compatibility
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
  isOverviewMode: boolean // True when viewing all levels, false when editing a specific level
  selectedElements: SelectedElement[] // Unified selection for building elements (walls, roofs)
  selectedImageIds: string[]
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
  handleClear: () => void
} & {
  setWalls: (walls: string[]) => void
  setRoofs: (roofs: string[]) => void
  addComponent: (component: Component) => void
  addGroup: (group: ComponentGroup) => void
  deleteGroup: (groupId: string) => void
  reorderGroups: (groups: ComponentGroup[]) => void
  selectFloor: (floorId: string | null) => void
  setImages: (images: ReferenceImage[], pushToUndo?: boolean) => void
  setSelectedElements: (elements: SelectedElement[]) => void
  setSelectedImageIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setWallsGroupRef: (ref: THREE.Group | null) => void
  setActiveTool: (tool: Tool | null) => void
  setControlMode: (mode: ControlMode) => void
  setCameraMode: (mode: CameraMode) => void
  toggleLevelMode: () => void
  setMovingCamera: (moving: boolean) => void
  setIsManipulatingImage: (manipulating: boolean) => void
  getWallsSet: () => Set<string>
  getRoofsSet: () => Set<string>
  getSelectedElementsSet: () => Set<SelectedElement>
  getSelectedImageIdsSet: () => Set<string>
  wallSegments: () => WallSegment[]
  roofSegments: () => RoofSegment[]
  handleExport: () => void
  handleUpload: (file: File, level: number) => void
  handleDeleteSelectedElements: () => void
  handleDeleteSelectedImages: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (file: File) => void
  handleResetToDefault: () => void
  undo: () => void
  redo: () => void
  toggleFloorVisibility: (floorId: string) => void
  toggleBuildingElementVisibility: (elementId: string, type: 'wall' | 'roof') => void
  toggleImageVisibility: (imageId: string) => void
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
          visible: true,
        },
      ],
      currentLevel: 0,
      addComponent: (component) =>
        set((state) => ({
          undoStack: [
            ...state.undoStack,
            { images: state.images, components: state.components },
          ].slice(-50),
          redoStack: [],
          components: [...state.components, component],
        })),
      addGroup: (group) => set((state) => ({ groups: [...state.groups, group] })),
      deleteGroup: (groupId) =>
        set((state) => ({
          groups: state.groups.filter((group) => group.id !== groupId),
          components: state.components.filter((comp) => comp.group !== groupId),
        })),
      reorderGroups: (groups) => set({ groups }),
      selectedFloorId: 'level_0',
      isOverviewMode: false, // Start in edit mode with base level selected
      selectedElements: [],
      selectFloor: (floorId) => {
        const state = get()

        if (!floorId) {
          // Switch to overview mode - viewing all levels without editing capability
          set({
            selectedFloorId: null,
            currentLevel: -1,
            isOverviewMode: true,
            controlMode: 'select',
            activeTool: null,
          })
          return
        }

        // Switch to edit mode - focusing on a specific level for editing
        // Find or create the component for this floor
        let component = state.components.find((c) => c.type === 'wall' && c.group === floorId)

        const group = state.groups.find((g) => g.id === floorId)

        if (component) {
          set({
            selectedFloorId: floorId,
            currentLevel: group?.level ?? 0,
            isOverviewMode: false,
          })
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
            isOverviewMode: false,
          })
        }
      },
      selectedImageIds: [],
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
          const currentWalls = currentComponent
            ? (currentComponent.data as WallComponentData).segments.map((seg) => seg.id)
            : []

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
              visible: true,
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
      setRoofs: (roofs) =>
        set((state) => {
          if (!state.selectedFloorId) {
            return state
          }

          // Get current roofs from component for comparison
          const currentComponent = state.components.find(
            (c) => c.type === 'roof' && c.group === state.selectedFloorId,
          )
          const currentRoofs = currentComponent
            ? (currentComponent.data as RoofComponentData).segments.map((seg) => seg.id)
            : []

          const sortedNew = [...roofs].sort()
          const sortedCurrent = [...currentRoofs].sort()
          if (
            sortedNew.length === sortedCurrent.length &&
            sortedNew.every((v, i) => v === sortedCurrent[i])
          ) {
            return state
          }

          // Convert roof keys to segments
          const segments: RoofSegment[] = []
          for (const roofKey of roofs) {
            if (!roofKey.includes('-')) continue

            // Parse roof key format: "x1,y1-x2,y2" or "x1,y1-x2,y2:leftWidth,rightWidth"
            const [coordPart, widthPart] = roofKey.split(':')
            const parts = coordPart.split('-')
            if (parts.length !== 2) continue

            const [start, end] = parts
            const [x1, y1] = start.split(',').map(Number)
            const [x2, y2] = end.split(',').map(Number)

            if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue

            // Parse optional widths
            let leftWidth: number | undefined
            let rightWidth: number | undefined
            if (widthPart) {
              const widths = widthPart.split(',').map(Number)
              if (widths.length === 2 && !isNaN(widths[0]) && !isNaN(widths[1])) {
                leftWidth = widths[0]
                rightWidth = widths[1]
              }
            }

            segments.push({
              start: [x1, y1],
              end: [x2, y2],
              id: roofKey,
              height: 2, // Default 2m peak height
              leftWidth,
              rightWidth,
              visible: true,
            })
          }

          // Update the component for the current floor
          let updatedComponents = state.components.map((comp) => {
            if (comp.type === 'roof' && comp.group === state.selectedFloorId) {
              return {
                ...comp,
                data: { segments },
              }
            }
            return comp
          })

          // If no component exists for this floor yet, create one
          if (
            !state.components.find((c) => c.type === 'roof' && c.group === state.selectedFloorId)
          ) {
            const newComponent = {
              id: `roofs-${state.selectedFloorId}`,
              type: 'roof' as const,
              label: `Roofs - ${state.groups.find((g) => g.id === state.selectedFloorId)?.name || state.selectedFloorId}`,
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
      setSelectedElements: (elements) => set({ selectedElements: elements }),
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
      setCameraMode: (mode) => set({ cameraMode: mode }),
      setMovingCamera: (moving) => set({ movingCamera: moving }),
      setIsManipulatingImage: (manipulating) => set({ isManipulatingImage: manipulating }),
      getWallsSet: () => {
        const state = get()
        if (!state.selectedFloorId) return new Set<string>()

        const component = state.components.find(
          (c) => c.type === 'wall' && c.group === state.selectedFloorId,
        )
        if (!component) return new Set<string>()

        return new Set((component.data as WallComponentData).segments.map((seg) => seg.id))
      },
      getRoofsSet: () => {
        const state = get()
        if (!state.selectedFloorId) return new Set<string>()

        const component = state.components.find(
          (c) => c.type === 'roof' && c.group === state.selectedFloorId,
        )
        if (!component) return new Set<string>()

        return new Set((component.data as RoofComponentData).segments.map((seg) => seg.id))
      },
      getSelectedElementsSet: () => new Set(get().selectedElements),
      getSelectedImageIdsSet: () => new Set(get().selectedImageIds),
      wallSegments: () => {
        const state = get()
        if (!state.selectedFloorId) return []

        const component = state.components.find(
          (c) => c.type === 'wall' && c.group === state.selectedFloorId,
        )
        if (!component) return []

        return (component.data as WallComponentData).segments as WallSegment[]
      },
      roofSegments: () => {
        const state = get()
        if (!state.selectedFloorId) return []

        const component = state.components.find(
          (c) => c.type === 'roof' && c.group === state.selectedFloorId,
        )
        if (!component) return []

        return (component.data as RoofComponentData).segments as RoofSegment[]
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
              visible: true,
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
      handleDeleteSelectedElements: () => {
        const state = get()
        if (state.selectedElements.length === 0 || !state.selectedFloorId) return

        const updatedComponents = deleteElements(
          state.components,
          state.selectedElements,
          state.selectedFloorId,
        )

        set({
          undoStack: [
            ...state.undoStack,
            { images: state.images, components: state.components },
          ].slice(-50),
          redoStack: [],
          components: updatedComponents,
          selectedElements: [],
        })
      },
      handleClear: () => {
        get().setWalls([])
        set({ selectedElements: [] })
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
        set({
          selectedElements: [],
          selectedImageIds: [],
          selectedFloorId: null,
          isOverviewMode: true, // Start in overview mode when loading a layout
          controlMode: 'select',
          activeTool: null,
        })

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
              visible: true,
            },
          ],
          currentLevel: 0,
          selectedFloorId: 'level_0',
          isOverviewMode: false,
          selectedElements: [],
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
            selectedElements: [],
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
            selectedElements: [],
            selectedImageIds: [],
          }
        }),
      toggleFloorVisibility: (floorId) =>
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === floorId ? { ...g, visible: !(g.visible ?? true) } : g,
          ),
        })),
      toggleBuildingElementVisibility: (elementId, type) =>
        set((state) => {
          if (!state.selectedFloorId) return state
          return {
            components: toggleElementVisibility(
              state.components,
              elementId,
              type,
              state.selectedFloorId,
            ),
          }
        }),
      toggleImageVisibility: (imageId) =>
        set((state) => ({
          images: state.images.map((img) =>
            img.id === imageId ? { ...img, visible: !(img.visible ?? true) } : img,
          ),
        })),
    }),
    {
      name: 'editor-storage',
      partialize: (state) => ({
        components: state.components,
        groups: state.groups,
        images: state.images,
        selectedElements: state.selectedElements,
        selectedImageIds: state.selectedImageIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate: Add missing position, rotation, scale, level, visible to existing images
          if (state.images && state.images.length > 0) {
            state.images = state.images.map((img: any) => ({
              ...img,
              position: img.position ?? [0, 0],
              rotation: img.rotation ?? 0,
              scale: img.scale ?? 1,
              level: img.level ?? 0, // Default to base level
              visible: img.visible ?? true, // Default to visible
            }))
          }

          // Ensure components and groups are initialized
          if (!state.components) {
            state.components = []
          }
          // Migrate: Add missing visible to existing components
          if (state.components && state.components.length > 0) {
            state.components = state.components.map((comp: any) => ({
              ...comp,
              data: {
                ...comp.data,
                segments:
                  comp.data.segments?.map((seg: any) => ({
                    ...seg,
                    visible: seg.visible ?? true,
                  })) ?? [],
              },
            }))
          }
          if (!state.groups) {
            state.groups = [
              {
                id: 'level_0',
                name: 'base level',
                type: 'floor',
                color: '#ffffff',
                level: 0,
                visible: true,
              },
            ]
          }
          // Migrate: Add missing visible to existing groups
          if (state.groups && state.groups.length > 0) {
            state.groups = state.groups.map((group: any) => ({
              ...group,
              visible: group.visible ?? true,
            }))
          }

          // Preselect base level if no level is selected
          if (!state.selectedFloorId) {
            state.selectedFloorId = 'level_0'
            state.currentLevel = 0
            state.isOverviewMode = false
          }

          // Ensure isOverviewMode is set correctly based on selectedFloorId
          if (state.selectedFloorId === null) {
            state.isOverviewMode = true
          } else if (state.isOverviewMode === undefined) {
            state.isOverviewMode = false
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
    roofs: store.getRoofsSet(),
    setRoofs: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getRoofsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setRoofs(Array.from(newSet))
    },
    images: store.images,
    setImages: store.setImages,
    selectedElements: store.selectedElements,
    setSelectedElements: store.setSelectedElements,
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
    cameraMode: store.cameraMode,
    setCameraMode: store.setCameraMode,
    movingCamera: store.movingCamera,
    setMovingCamera: store.setMovingCamera,
    isManipulatingImage: store.isManipulatingImage,
    setIsManipulatingImage: store.setIsManipulatingImage,
    wallSegments: store.wallSegments(),
    roofSegments: store.roofSegments(),
    handleExport: store.handleExport,
    handleUpload: store.handleUpload,
    handleDeleteSelectedElements: store.handleDeleteSelectedElements,
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
    isOverviewMode: store.isOverviewMode,
    selectFloor: store.selectFloor,
    addComponent: store.addComponent,
    addGroup: store.addGroup,
    deleteGroup: store.deleteGroup,
    reorderGroups: store.reorderGroups,
    toggleFloorVisibility: store.toggleFloorVisibility,
    toggleBuildingElementVisibility: store.toggleBuildingElementVisibility,
    toggleImageVisibility: store.toggleImageVisibility,
  }
}
