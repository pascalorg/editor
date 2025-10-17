'use client'

import { createContext, useContext, useState, ReactNode, useRef, useMemo } from 'react'
import * as THREE from 'three'
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'

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

interface EditorContextType {
  walls: Set<string>
  setWalls: React.Dispatch<React.SetStateAction<Set<string>>>
  imageURL: string | null
  setImageURL: React.Dispatch<React.SetStateAction<string | null>>
  isHelpOpen: boolean
  setIsHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  isJsonInspectorOpen: boolean
  setIsJsonInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>
  wallsGroupRef: React.RefObject<THREE.Group<THREE.Object3DEventMap> | null>
  wallSegments: WallSegment[]
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  handleExport: () => void
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDeleteSelectedWalls: () => void
  serializeLayout: () => LayoutJSON
  loadLayout: (json: LayoutJSON) => void
  handleSaveLayout: () => void
  handleLoadLayout: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const EditorContext = createContext<EditorContextType | undefined>(undefined)

export const useEditorContext = () => {
  const context = useContext(EditorContext)
  if (!context) {
    throw new Error('useEditorContext must be used within an EditorProvider')
  }
  return context
}

interface EditorProviderProps {
  children: ReactNode
}

export const EditorProvider = ({ children }: EditorProviderProps) => {
  const [walls, setWalls] = useState<Set<string>>(new Set())
  const [imageURL, setImageURL] = useState<string | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isJsonInspectorOpen, setIsJsonInspectorOpen] = useState(false)
  const [selectedWallIds, setSelectedWallIds] = useState<Set<string>>(new Set())
  const wallsGroupRef = useRef<THREE.Group<THREE.Object3DEventMap>>(null)

  const wallSegments = useMemo(() => {
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
  }, [walls])

  const handleExport = () => {
    if (!wallsGroupRef.current) return;

    const exporter = new GLTFExporter();

    exporter.parse(
      wallsGroupRef.current,
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
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setImageURL(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDeleteSelectedWalls = () => {
    if (selectedWallIds.size === 0) return

    setWalls(prevWalls => {
      const newWalls = new Set(prevWalls)

      for (const segmentId of selectedWallIds) {
        const parts = segmentId.split('-')
        const type = parts[0]
        const minF = parseInt(parts[1])
        const maxF = parseInt(parts[2])
        const startV = parseInt(parts[3])
        const endV = parseInt(parts[4])

        if (type === 'h') {
          for (let y = minF; y <= maxF; y++) {
            for (let x = startV; x <= endV; x++) {
              newWalls.delete(`${x},${y}`)
            }
          }
        } else {
          for (let x = minF; x <= maxF; x++) {
            for (let y = startV; y <= endV; y++) {
              newWalls.delete(`${x},${y}`)
            }
          }
        }
      }

      return newWalls
    })

    // Clear selection after deletion
    setSelectedWallIds(new Set())
  }

  const serializeLayout = (): LayoutJSON => {
    const tiles: [number, number][] = Array.from(walls).map(key => {
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
  }

  const loadLayout = (json: LayoutJSON) => {
    // Clear current selection
    setSelectedWallIds(new Set())

    // Find the wall component and restore tiles
    const wallComponent = json.components.find(c => c.type === 'wall')
    if (wallComponent && wallComponent.data.tiles) {
      const newWalls = new Set<string>()
      for (const [x, y] of wallComponent.data.tiles) {
        newWalls.add(`${x},${y}`)
      }
      setWalls(newWalls)
    }
  }

  const handleSaveLayout = () => {
    const layout = serializeLayout()
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `layout_${new Date().toISOString().split('T')[0]}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleLoadLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === 'application/json') {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string) as LayoutJSON
          loadLayout(json)
        } catch (error) {
          console.error('Failed to parse layout JSON:', error)
        }
      }
      reader.readAsText(file)
    }
  }

  const value: EditorContextType = {
    walls,
    setWalls,
    imageURL,
    setImageURL,
    isHelpOpen,
    setIsHelpOpen,
    isJsonInspectorOpen,
    setIsJsonInspectorOpen,
    wallsGroupRef,
    wallSegments,
    selectedWallIds,
    setSelectedWallIds,
    handleExport,
    handleUpload,
    handleDeleteSelectedWalls,
    serializeLayout,
    loadLayout,
    handleSaveLayout,
    handleLoadLayout,
  }

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  )
}
