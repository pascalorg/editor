'use client'

import { createContext, useContext, ReactNode, useState, useRef, useEffect } from 'react'
import * as THREE from 'three'

interface EditorContextType {
  // State
  walls: Set<string>
  setWalls: React.Dispatch<React.SetStateAction<Set<string>>>
  isCameraEnabled: boolean
  setIsCameraEnabled: React.Dispatch<React.SetStateAction<boolean>>
  imageURL: string | null
  setImageURL: React.Dispatch<React.SetStateAction<string | null>>
  isHelpOpen: boolean
  setIsHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  hoveredWallIndex: number | null
  setHoveredWallIndex: React.Dispatch<React.SetStateAction<number | null>>

  // Refs
  wallsGroupRef: React.RefObject<THREE.Group<THREE.Object3DEventMap> | null>

  // Handlers
  handleTileInteract: (x: number, y: number, action: 'toggle' | 'add') => void
  handleExport: () => void
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void

  // Leva controls
  wallHeight: number
  tileSize: number
  showGrid: boolean
  gridOpacity: number
  cameraType: 'perspective' | 'orthographic'
  imageOpacity: number
  imageScale: number
  imagePosition: [number, number]
  imageRotation: number
}

const EditorContext = createContext<EditorContextType | null>(null)

export function useEditor() {
  const context = useContext(EditorContext)
  if (!context) {
    throw new Error('useEditor must be used within an EditorProvider')
  }
  return context
}

interface EditorProviderProps {
  children: ReactNode
}

export function EditorProvider({ children }: EditorProviderProps) {
  // State
  const [walls, setWalls] = useState<Set<string>>(new Set())
  const [isCameraEnabled, setIsCameraEnabled] = useState(false)
  const [imageURL, setImageURL] = useState<string | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [hoveredWallIndex, setHoveredWallIndex] = useState<number | null>(null)

  // Refs
  const wallsGroupRef = useRef<THREE.Group<THREE.Object3DEventMap> | null>(null)

  // Leva controls (these would be replaced with actual leva controls in the component)
  const [wallHeight, setWallHeight] = useState(2.5)
  const [tileSize, setTileSize] = useState(0.15)
  const [showGrid, setShowGrid] = useState(true)
  const [gridOpacity, setGridOpacity] = useState(0.3)
  const [cameraType, setCameraType] = useState<'perspective' | 'orthographic'>('perspective')
  const [imageOpacity, setImageOpacity] = useState(0.5)
  const [imageScale, setImageScale] = useState(1)
  const [imagePosition, setImagePosition] = useState<[number, number]>([0, 0])
  const [imageRotation, setImageRotation] = useState(0)

  // Handlers
  const handleTileInteract = (x: number, y: number, action: 'toggle' | 'add') => {
    const key = `${x},${y}`
    setWalls(prev => {
      const next = new Set(prev)
      if (action === 'toggle') {
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
      } else if (action === 'add' && !next.has(key)) {
        next.add(key)
      }
      return next
    })
  }

  const handleExport = () => {
    if (!wallsGroupRef.current) return;

    // @ts-ignore
    const exporter = new (require('three/examples/jsm/exporters/GLTFExporter').GLTFExporter)();

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

  // Camera controls keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsCameraEnabled(true)
        e.preventDefault()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsCameraEnabled(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const contextValue: EditorContextType = {
    // State
    walls,
    setWalls,
    isCameraEnabled,
    setIsCameraEnabled,
    imageURL,
    setImageURL,
    isHelpOpen,
    setIsHelpOpen,
    hoveredWallIndex,
    setHoveredWallIndex,

    // Refs
    wallsGroupRef,

    // Handlers
    handleTileInteract,
    handleExport,
    handleUpload,

    // Leva controls
    wallHeight,
    tileSize,
    showGrid,
    gridOpacity,
    cameraType,
    imageOpacity,
    imageScale,
    imagePosition,
    imageRotation,
  }

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  )
}
