'use client'

import { createContext, useContext, useState, ReactNode, useRef, useMemo } from 'react'
import * as THREE from 'three'
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'

export interface WallSegment {
  isHorizontal: boolean
  fixed: number
  start: number
  end: number
  id: string
}

interface EditorContextType {
  walls: Set<string>
  setWalls: React.Dispatch<React.SetStateAction<Set<string>>>
  imageURL: string | null
  setImageURL: React.Dispatch<React.SetStateAction<string | null>>
  isHelpOpen: boolean
  setIsHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  wallsGroupRef: React.RefObject<THREE.Group<THREE.Object3DEventMap> | null>
  wallSegments: WallSegment[]
  selectedWallIds: Set<string>
  setSelectedWallIds: React.Dispatch<React.SetStateAction<Set<string>>>
  handleExport: () => void
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDeleteSelectedWalls: () => void
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

    const segments: WallSegment[] = [];
    const covered = new Set<string>();

    // Vertical segments (only for runs >1)
    for (const [fixed, varying] of vert) {
      if (varying.length < 2) continue;
      varying.sort((a, b) => a - b);
      let i = 0;
      while (i < varying.length) {
        let j = i;
        while (j < varying.length - 1 && varying[j + 1] === varying[j] + 1) j++;
        const start = varying[i];
        const end = varying[j];
        const length = j - i + 1;
        if (length > 1) {
          const id = `v-${fixed}-${start}-${end}`;
          segments.push({isHorizontal: false, fixed, start, end, id});
          for (let k = i; k <= j; k++) {
            covered.add(`${fixed},${varying[k]}`);
          }
        }
        i = j + 1;
      }
    }

    // Horizontal segments (for remaining tiles, including singles)
    for (const [fixed, varying] of horiz) {
      const filtered = varying.filter(x => !covered.has(`${x},${fixed}`));
      if (filtered.length === 0) continue;
      filtered.sort((a, b) => a - b);
      let i = 0;
      while (i < filtered.length) {
        let j = i;
        while (j < filtered.length - 1 && filtered[j + 1] === filtered[j] + 1) j++;
        const start = filtered[i];
        const end = filtered[j];
        const id = `h-${fixed}-${start}-${end}`;
        segments.push({isHorizontal: true, fixed, start, end, id});
        i = j + 1;
      }
    }

    return segments;
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
        // Parse segment ID to get the positions to remove
        const parts = segmentId.split('-')
        const isHorizontal = parts[0] === 'h'
        const fixed = parseInt(parts[1])
        const start = parseInt(parts[2])
        const end = parseInt(parts[3])

        // Remove all tiles in this segment
        if (isHorizontal) {
          // Horizontal segment: fixed row, varying columns
          for (let col = start; col <= end; col++) {
            newWalls.delete(`${col},${fixed}`)
          }
        } else {
          // Vertical segment: fixed column, varying rows
          for (let row = start; row <= end; row++) {
            newWalls.delete(`${fixed},${row}`)
          }
        }
      }

      return newWalls
    })

    // Clear selection after deletion
    setSelectedWallIds(new Set())
  }

  const value: EditorContextType = {
    walls,
    setWalls,
    imageURL,
    setImageURL,
    isHelpOpen,
    setIsHelpOpen,
    wallsGroupRef,
    wallSegments,
    selectedWallIds,
    setSelectedWallIds,
    handleExport,
    handleUpload,
    handleDeleteSelectedWalls,
  }

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  )
}
