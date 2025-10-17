'use client'

import { createContext, useContext, useState, ReactNode, useRef } from 'react'
import * as THREE from 'three'
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'

interface EditorContextType {
  walls: Set<string>
  setWalls: React.Dispatch<React.SetStateAction<Set<string>>>
  imageURL: string | null
  setImageURL: React.Dispatch<React.SetStateAction<string | null>>
  isHelpOpen: boolean
  setIsHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  wallsGroupRef: React.RefObject<THREE.Group<THREE.Object3DEventMap> | null>
  handleExport: () => void
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
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
  const wallsGroupRef = useRef<THREE.Group<THREE.Object3DEventMap>>(null)

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

  const value: EditorContextType = {
    walls,
    setWalls,
    imageURL,
    setImageURL,
    isHelpOpen,
    setIsHelpOpen,
    wallsGroupRef,
    handleExport,
    handleUpload,
  }

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  )
}
