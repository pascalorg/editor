'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/** Node types omitted from mesh export so rooms are not closed with a top cap. */
const EXPORT_OMIT_CAP_TYPES = ['ceiling', 'roof', 'roof-segment'] as const

export function ExportManager() {
  const scene = useThree((state) => state.scene)
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async (format: 'glb' | 'stl' | 'obj' = 'glb') => {
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return
      }

      const date = new Date().toISOString().split('T')[0]
      const hiddenCaps = hideCapGeometryForExport()

      try {
        if (format === 'stl') {
          const exporter = new STLExporter()
          const result = exporter.parse(sceneGroup, { binary: true })
          downloadBlob(new Blob([result], { type: 'model/stl' }), `model_${date}.stl`)
          return
        }

        if (format === 'obj') {
          const exporter = new OBJExporter()
          const result = exporter.parse(sceneGroup)
          downloadBlob(new Blob([result], { type: 'model/obj' }), `model_${date}.obj`)
          return
        }

        const exporter = new GLTFExporter()
        await new Promise<void>((resolve, reject) => {
          exporter.parse(
            sceneGroup,
            (gltf) => {
              downloadBlob(new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' }), `model_${date}.glb`)
              resolve()
            },
            (error) => {
              console.error('Export error:', error)
              reject(error)
            },
            { binary: true },
          )
        })
      } finally {
        restoreVisibility(hiddenCaps)
      }
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function hideCapGeometryForExport(): Array<{ obj: Object3D; visible: boolean }> {
  const hidden: Array<{ obj: Object3D; visible: boolean }> = []

  for (const type of EXPORT_OMIT_CAP_TYPES) {
    const ids = sceneRegistry.byType[type]
    if (!ids) continue
    for (const id of ids) {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) continue
      hidden.push({ obj, visible: obj.visible })
      obj.visible = false
    }
  }

  return hidden
}

function restoreVisibility(hidden: Array<{ obj: Object3D; visible: boolean }>) {
  for (const { obj, visible } of hidden) {
    obj.visible = visible
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
