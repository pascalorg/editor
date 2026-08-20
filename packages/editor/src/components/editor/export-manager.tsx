'use client'

import { emitter, useScene } from '@pascal-app/core'
import {
  type SceneExport,
  type SceneExportArtifact,
  snapLevelsToTruePositions,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { exportSceneToGlb, nextFrames, prepareSceneForExport } from '../../lib/glb-export'
import { exportSceneLevelsToPrintStl } from '../../lib/level-print-export'
import { filterPreparedSceneForPrintContent } from '../../lib/print-content-scope'
import { exportSceneToPrintStl, mergePrintExportDiagnostics } from '../../lib/print-export'
import { compileSemanticPrintShellWithManifold } from '../../lib/print-shell-compiler-manifold-worker'

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
    const exportFn: SceneExport = async (format = 'glb', options = {}) => {
      // Find the scene renderer group by name
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return null
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
          const buffer = await exportSceneToGlb(sceneGroup, useScene.getState().nodes, options)
          const blob = new Blob([buffer], { type: 'model/gltf-binary' })
          return finishArtifact(blob, `model_${date}.glb`, options.download)
        }

        // Hide editor affordances that live on the scene layer (selection handles,
        // ceiling/site brackets) and let wall-cutout reveal all walls — the same
        // synchronous capture path thumbnails use. We clone the scene inside the
        // window, so the export snapshots the clean building, then restore.
        emitter.emit('thumbnail:before-capture', undefined)
        const restoreLevels = snapLevelsToTruePositions()
        const nodes = useScene.getState().nodes
        let prepared: ReturnType<typeof prepareSceneForExport>
        try {
          prepared = prepareSceneForExport(sceneGroup, nodes, options)
        } finally {
          restoreLevels()
          emitter.emit('thumbnail:after-capture', undefined)
        }
        let { scene: exportScene } = prepared
        const printContent = options.printContent ?? 'structure'
        if (format === 'print-stl') {
          exportScene = filterPreparedSceneForPrintContent(exportScene, nodes, printContent)
        }
        ensurePositionAttributes(exportScene)

        if (format === 'print-stl') {
          const scale = options.printScale ?? 100
          const compileShells = printContent === 'structure'
          if (options.printScope === 'levels') {
            const plinth =
              options.printBase === 'plinth'
                ? {
                    marginMm: options.printPlinthMarginMm ?? 2,
                    thicknessMm: options.printPlinthThicknessMm ?? 2,
                  }
                : undefined
            const { archive, report } = await exportSceneLevelsToPrintStl(exportScene, nodes, {
              scale,
              plinth,
              compileShells,
              compileShell: compileShells ? compileSemanticPrintShellWithManifold : undefined,
            })
            const blob = new Blob([archive], { type: 'application/zip' })
            return finishArtifact(
              blob,
              `print_levels_1-${scale}_${date}.zip`,
              options.download,
              report,
            )
          }
          if (options.printBase === 'plinth') {
            throw new Error('Plinth generation is available only for per-level print packages.')
          }
          const compiled = compileShells
            ? await compileSemanticPrintShellWithManifold(exportScene, nodes)
            : null
          const printSource = compiled ? (compiled.scene ?? new THREE.Group()) : exportScene
          const output = exportSceneToPrintStl(printSource, {
            scale,
            compiled: compiled?.status === 'compiled',
            indexedTopology: compiled?.backend === 'manifold-3d',
          })
          const report = compiled
            ? mergePrintExportDiagnostics(
                output.report,
                compiled.diagnostics,
                new Set(['compiler_pending']),
              )
            : output.report
          const { buffer } = output
          const blob = new Blob([buffer], { type: 'model/stl' })
          return finishArtifact(
            blob,
            `print_model_1-${scale}_${date}.stl`,
            options.download,
            report,
          )
        }

        if (format === 'stl') {
          const exporter = new STLExporter()
          const result = exporter.parse(exportScene, { binary: true })
          const blob = new Blob([result], { type: 'model/stl' })
          return finishArtifact(blob, `model_${date}.stl`, options.download)
        }

        if (format === 'obj') {
          const exporter = new OBJExporter()
          const result = exporter.parse(exportScene)
          const blob = new Blob([result], { type: 'model/obj' })
          return finishArtifact(blob, `model_${date}.obj`, options.download)
        }

        return null
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

function finishArtifact(
  blob: Blob,
  filename: string,
  download: boolean | undefined,
  metadata?: unknown,
): SceneExportArtifact {
  if (download !== false) downloadBlob(blob, filename)
  return { blob, filename, metadata }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
