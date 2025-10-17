'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as THREE from 'three'
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'
import { SetStateAction } from 'react'

export interface WallSegment {
  isHorizontal: boolean
  minFixed: number
  maxFixed: number
  startVarying: number
  endVarying: number
  id: string
}

export type ComponentData = {
  tiles: [number, number][]
  segments: WallSegment[]
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
  imageURL: string | null
  selectedWallIds: string[]
  isHelpOpen: boolean
  isJsonInspectorOpen: boolean
  wallsGroupRef: THREE.Group | null
  undoStack: string[][]
} & {
  setWalls: (walls: string[]) => void
  setImageURL: (url: string | null) => void
  setSelectedWallIds: (ids: string[]) => void
  setIsHelpOpen: (open: boolean) => void
  setIsJsonInspectorOpen: (open: boolean) => void
  setWallsGroupRef: (ref: THREE.Group | null) => void
  getWallsSet: () => Set<string>
  getSelectedWallIdsSet: () => Set<string>
  wallSegments: () => WallSegment[]
  handleExport: () => void
  handleUpload: (file: File) => void
  handleDeleteSelectedWalls: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (file: File) => void
  undo: () => void
}

const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      walls: [],
      imageURL: null,
      selectedWallIds: [],
      isHelpOpen: false,
      isJsonInspectorOpen: false,
      wallsGroupRef: null,
      undoStack: [],
      setWalls: (walls) => set(state => {
        const sortedNew = [...walls].sort()
        const sortedCurrent = [...state.walls].sort()
        if (sortedNew.length === sortedCurrent.length && sortedNew.every((v, i) => v === sortedCurrent[i])) {
          return state
        }
        return {
          undoStack: [...state.undoStack, state.walls].slice(-50),
          walls
        }
      }),
      setImageURL: (url) => set({ imageURL: url }),
      setSelectedWallIds: (ids) => set({ selectedWallIds: ids }),
      setIsHelpOpen: (open) => set({ isHelpOpen: open }),
      setIsJsonInspectorOpen: (open) => set({ isJsonInspectorOpen: open }),
      setWallsGroupRef: (ref) => set({ wallsGroupRef: ref }),
      getWallsSet: () => new Set(get().walls),
      getSelectedWallIdsSet: () => new Set(get().selectedWallIds),
      wallSegments: () => {
        const walls = get().getWallsSet()
        const allPositions: [number, number][] = Array.from(walls).map(key => key.split(',').map(Number) as [number, number]);

        const horiz = new Map<number, number[]>();
        const vert = new Map<number, number[]>();

        for (const [x, y] of allPositions) {
          if (!horiz.has(y)) horiz.set(y, []);
          horiz.get(y)!.push(x);
          if (!vert.has(x)) vert.set(x, []);
          vert.get(x)!.push(y);
        }

        const verticalLineSegments: WallSegment[] = [];
        const covered = new Set<string>();

        for (const [fixed, varying] of vert) {
          if (varying.length < 2) continue;
          varying.sort((a, b) => a - b);
          let i = 0;
          while (i < varying.length) {
            let j = i;
            while (j < varying.length - 1 && varying[j + 1] === varying[j] + 1) j++;
            const startV = varying[i];
            const endV = varying[j];
            const length = j - i + 1;
            if (length > 1) {
              const id = `v-${fixed}-${fixed}-${startV}-${endV}`;
              verticalLineSegments.push({ isHorizontal: false, minFixed: fixed, maxFixed: fixed, startVarying: startV, endVarying: endV, id });
              for (let k = i; k <= j; k++) {
                covered.add(`${fixed},${varying[k]}`);
              }
            }
            i = j + 1;
          }
        }

        const horizontalLineSegments: WallSegment[] = [];
        for (const [fixed, varying] of horiz) {
          const filtered = varying.filter(x => !covered.has(`${x},${fixed}`));
          if (filtered.length === 0) continue;
          filtered.sort((a, b) => a - b);
          let i = 0;
          while (i < filtered.length) {
            let j = i;
            while (j < filtered.length - 1 && filtered[j + 1] === filtered[j] + 1) j++;
            const startV = filtered[i];
            const endV = filtered[j];
            const id = `h-${fixed}-${fixed}-${startV}-${endV}`;
            horizontalLineSegments.push({ isHorizontal: true, minFixed: fixed, maxFixed: fixed, startVarying: startV, endVarying: endV, id });
            i = j + 1;
          }
        }

        const mergeSegments = (segs: WallSegment[], isHoriz: boolean) => {
          segs.sort((a, b) => a.minFixed - b.minFixed);
          const merged: WallSegment[] = [];
          let current: WallSegment | null = null;
          for (let seg of segs) {
            if (current === null) {
              current = { ...seg };
            } else if (
              seg.minFixed === current.maxFixed + 1 &&
              seg.startVarying === current.startVarying &&
              seg.endVarying === current.endVarying
            ) {
              current.maxFixed = seg.maxFixed;
              current.id = `${isHoriz ? 'h' : 'v'}-${current.minFixed}-${current.maxFixed}-${current.startVarying}-${current.endVarying}`;
            } else {
              merged.push(current);
              current = { ...seg };
            }
          }
          if (current) merged.push(current);
          return merged;
        };

        const mergedVertical = mergeSegments(verticalLineSegments, false);
        const mergedHorizontal = mergeSegments(horizontalLineSegments, true);

        return [...mergedVertical, ...mergedHorizontal];
      },
      handleExport: () => {
        const ref = get().wallsGroupRef
        if (!ref) return;

        const exporter = new GLTFExporter();

        exporter.parse(
          ref,
          (result: ArrayBuffer) => {
            const blob = new Blob([result], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'house_model.glb';
            link.click();
            URL.revokeObjectURL(url);
          },
          (error: Error) => {
            console.error('Export error:', error);
          },
          { binary: true }
        );
      },
      handleUpload: (file: File) => {
        if (file && (file.type === 'image/png' || file.type === 'image/jpeg')) {
          const reader = new FileReader()
          reader.onload = (event) => {
            set({ imageURL: event.target?.result as string })
          }
          reader.readAsDataURL(file)
        }
      },
      handleDeleteSelectedWalls: () => {
        set(state => {
          if (state.selectedWallIds.length === 0) return state
          const newWallsSet = new Set(state.walls)
          for (const segmentId of state.selectedWallIds) {
            const parts = segmentId.split('-')
            const type = parts[0]
            const minF = parseInt(parts[1])
            const maxF = parseInt(parts[2])
            const startV = parseInt(parts[3])
            const endV = parseInt(parts[4])
            if (type === 'h') {
              for (let y = minF; y <= maxF; y++) {
                for (let x = startV; x <= endV; x++) {
                  newWallsSet.delete(`${x},${y}`)
                }
              }
            } else {
              for (let x = minF; x <= maxF; x++) {
                for (let y = startV; y <= endV; y++) {
                  newWallsSet.delete(`${x},${y}`)
                }
              }
            }
          }
          const newWalls = Array.from(newWallsSet)
          // Since setWalls will handle undoStack, call it
          get().setWalls(newWalls)
          return { selectedWallIds: [] }
        })
      },
      serializeLayout: () => {
        const walls = get().walls
        const wallSegments = get().wallSegments()
        const tiles: [number, number][] = walls.map(key => {
          const [x, y] = key.split(',').map(Number)
          return [x, y]
        })

        return {
          version: '1.0',
          grid: { size: 200 },
          components: [{
            id: 'walls-default',
            type: 'wall',
            label: 'All Walls',
            group: null,
            data: {
              tiles,
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
        if (wallComponent && wallComponent.data.tiles) {
          const newWalls = wallComponent.data.tiles.map(([x, y]) => `${x},${y}`)
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
          selectedWallIds: []
        }
      }),
    }),
    {
      name: 'editor-storage',
      partialize: (state) => ({
        walls: state.walls,
        imageURL: state.imageURL,
        selectedWallIds: state.selectedWallIds,
      }),
    }
  )
)

export const useEditorContext = () => {
  const store = useStore()
  return {
    walls: store.getWallsSet(),
    setWalls: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getWallsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setWalls(Array.from(newSet))
    },
    imageURL: store.imageURL,
    setImageURL: store.setImageURL,
    selectedWallIds: store.getSelectedWallIdsSet(),
    setSelectedWallIds: (action: SetStateAction<Set<string>>) => {
      const currentSet = store.getSelectedWallIdsSet()
      const newSet = typeof action === 'function' ? action(currentSet) : action
      store.setSelectedWallIds(Array.from(newSet))
    },
    isHelpOpen: store.isHelpOpen,
    setIsHelpOpen: store.setIsHelpOpen,
    isJsonInspectorOpen: store.isJsonInspectorOpen,
    setIsJsonInspectorOpen: store.setIsJsonInspectorOpen,
    wallsGroupRef: store.wallsGroupRef,
    setWallsGroupRef: store.setWallsGroupRef,
    wallSegments: store.wallSegments(),
    handleExport: store.handleExport,
    handleUpload: store.handleUpload,
    handleDeleteSelectedWalls: store.handleDeleteSelectedWalls,
    serializeLayout: store.serializeLayout,
    loadLayout: store.loadLayout,
    handleSaveLayout: store.handleSaveLayout,
    handleLoadLayout: store.handleLoadLayout,
    undo: store.undo,
  }
}
