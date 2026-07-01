'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Mesh, Object3D } from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { exportSceneToGlb } from '../../lib/glb-export'

export function ExportManager() {
  const scene = useThree((state) => state.scene)
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async (format: 'glb' | 'stl' | 'obj' = 'glb') => {
      // Find the scene renderer group by name
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return
      }

      const date = new Date().toISOString().split('T')[0]

      if (format === 'stl') {
        const exportScene = prepareSceneForExport(sceneGroup)
        const exporter = new STLExporter()
        const result = exporter.parse(exportScene, { binary: true })
        const blob = new Blob([result], { type: 'model/stl' })
        downloadBlob(blob, `model_${date}.stl`)
        return
      }

      if (format === 'obj') {
        const exportScene = prepareSceneForExport(sceneGroup)
        const exporter = new OBJExporter()
        const result = exporter.parse(exportScene)
        const blob = new Blob([result], { type: 'model/obj' })
        downloadBlob(blob, `model_${date}.obj`)
        return
      }

      const glb = await exportSceneToGlb(sceneGroup, useScene.getState().nodes)
      const blob = new Blob([glb], { type: 'model/gltf-binary' })
      downloadBlob(blob, `model_${date}.glb`)
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function isMeshWithInvalidGeometry(object: Object3D): object is Mesh {
  if (!('isMesh' in object) || !(object as Mesh).isMesh) return false
  const geometry = (object as Mesh).geometry
  const position = geometry?.getAttribute?.('position')
  return !position || position.count === 0
}

function prepareSceneForExport(sceneGroup: Object3D): Object3D {
  const exportScene = sceneGroup.clone(true)
  const invalidMeshes: Object3D[] = []

  exportScene.traverse((object) => {
    if (isMeshWithInvalidGeometry(object)) {
      invalidMeshes.push(object)
    }
  })

  for (const mesh of invalidMeshes) {
    mesh.parent?.remove(mesh)
  }

  return exportScene
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
