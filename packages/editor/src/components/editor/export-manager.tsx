'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { exportSceneToGlb, nextFrames, prepareSceneForExport } from '../../lib/glb-export'

// prepareSceneForExport neutralises container meshes (door/window hitbox roots,
// material-less renderables) with an attribute-less geometry — GLTFExporter
// emits those as plain transform nodes, but STL/OBJExporter read
// `position.count` unconditionally and crash. Swap in a geometry with an empty
// (count-0) position so they iterate zero vertices instead. Shared: the export
// scene is a throwaway clone, only its geometry *ref* is swapped.
const EMPTY_POSITION_GEOMETRY = new THREE.BufferGeometry()
EMPTY_POSITION_GEOMETRY.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(new Float32Array(0), 3),
)

function ensurePositionAttributes(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh & { isLine?: boolean; isPoints?: boolean }
    if (!(renderable.isMesh || renderable.isLine || renderable.isPoints)) return
    if (!renderable.geometry?.getAttribute('position')) {
      renderable.geometry = EMPTY_POSITION_GEOMETRY
    }
  })
}

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

      // Signal export so instanced kinds (trees/flowers/grass) swap their
      // invisible proxy for real, exportable geometry, then wait for the
      // commit before cloning the scene graph (same dance as BakeExporter —
      // without it every plant exports as its raycast collider, a white box).
      useViewer.getState().setExporting(true)
      try {
        await nextFrames()

        if (format === 'glb') {
          const buffer = await exportSceneToGlb(sceneGroup, useScene.getState().nodes)
          const blob = new Blob([buffer], { type: 'model/gltf-binary' })
          downloadBlob(blob, `model_${date}.glb`)
          return
        }

        // Hide editor affordances that live on the scene layer (selection handles,
        // ceiling/site brackets) and let wall-cutout reveal all walls — the same
        // synchronous capture path thumbnails use. We clone the scene inside the
        // window, so the export snapshots the clean building, then restore.
        emitter.emit('thumbnail:before-capture', undefined)
        let prepared: ReturnType<typeof prepareSceneForExport>
        try {
          prepared = prepareSceneForExport(sceneGroup, useScene.getState().nodes)
        } finally {
          emitter.emit('thumbnail:after-capture', undefined)
        }
        const { scene: exportScene } = prepared
        ensurePositionAttributes(exportScene)

        if (format === 'stl') {
          const exporter = new STLExporter()
          const result = exporter.parse(exportScene, { binary: true })
          const blob = new Blob([result], { type: 'model/stl' })
          downloadBlob(blob, `model_${date}.stl`)
          return
        }

        if (format === 'obj') {
          const exporter = new OBJExporter()
          const result = exporter.parse(exportScene)
          const blob = new Blob([result], { type: 'model/obj' })
          downloadBlob(blob, `model_${date}.obj`)
          return
        }
      } finally {
        useViewer.getState().setExporting(false)
      }
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
