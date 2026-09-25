'use client'

import { sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { evaluateRecipe } from '@pascal-app/core/procedural-items'
import {
  computeHeroFraming,
  createSnapshotPipeline,
  GRID_LAYER,
  heroCameraPose,
  proceduralSlotMeshes,
  setProceduralEmission,
  temporarilyHideNodeTypes,
  useSceneAtmosphere,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Material, PerspectiveCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

export function BakeThumbnail({
  active,
  onComplete,
  onError,
}: {
  active: boolean
  onComplete: (blob: Blob, size: { w: number; h: number }) => void
  onError: (message: string) => void
}) {
  const renderer = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const atmosphere = useSceneAtmosphere()
  const doneRef = useRef(false)

  useEffect(() => {
    if (!(active && !doneRef.current)) return
    doneRef.current = true

    const run = async () => {
      const restoreNodeVisibility = temporarilyHideNodeTypes(['scan', 'guide', 'spawn'])
      const priorLights = new Map<string, boolean>()
      const restGroups = new Map<string, [number, number, number]>()
      for (const node of Object.values(useScene.getState().nodes)) {
        if (node.type !== 'procedural-item') continue
        const evaluation = evaluateRecipe(node.recipe, node.parameters)
        if (evaluation.lights.length) {
          priorLights.set(
            node.id,
            useInteractive.getState().procedural[node.id]?.lightsOn ??
              useInteractive.getState().lampDefault,
          )
          useInteractive.getState().setProceduralLights(node.id, true)
        }
        for (const motion of evaluation.motions)
          restGroups.set(`${node.id}:${motion.id}`, motion.pivot)
      }
      const transforms: Array<{
        object: import('three').Object3D
        position: import('three').Vector3
        rotation: import('three').Euler
      }> = []
      const emission = new Map<Material, number>()
      let pipeline: Awaited<ReturnType<typeof createSnapshotPipeline>> = null

      try {
        const framing = computeHeroFraming()
        if (!framing) {
          onError('scene has no framable content')
          return
        }

        const { width, height } = renderer.domElement
        const aspect = width / height
        const camera = new PerspectiveCamera(60, aspect, 0.1, 1000)
        camera.layers.disable(EDITOR_LAYER)
        camera.layers.disable(GRID_LAYER)
        const pose = heroCameraPose({
          boxes: framing.boxes,
          aim: framing.aim,
          azimuthRad: framing.azimuthRad,
          aspect,
        })
        camera.position.set(pose.position[0], pose.position[1], pose.position[2])
        camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
        camera.updateMatrixWorld()

        pipeline = await createSnapshotPipeline({
          renderer: renderer as unknown as WebGPURenderer,
          scene,
          camera,
          atmosphere,
        })
        if (!pipeline) {
          onError('thumbnail pipeline failed to build')
          return
        }

        pipeline.applyEnvironment({
          theme: useViewer.getState().sceneTheme,
          transparent: false,
          grade: true,
          edges: useViewer.getState().edges,
          camera,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        for (const node of Object.values(useScene.getState().nodes)) {
          if (node.type !== 'procedural-item') continue
          const slots = new Set(
            evaluateRecipe(node.recipe, node.parameters).lights.flatMap((light) =>
              light.emissiveSlot ? [light.emissiveSlot] : [],
            ),
          )
          const object = sceneRegistry.nodes.get(node.id)
          for (const mesh of object ? proceduralSlotMeshes(object, slots) : []) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const material of materials) {
              const current = material as Material & { emissiveIntensity?: number }
              if (typeof current.emissiveIntensity !== 'number') continue
              emission.set(material, current.emissiveIntensity)
              setProceduralEmission(material, true)
            }
          }
        }
        scene.traverse((object) => {
          const motion = object.userData.proceduralMotion as
            | { nodeId?: string; groupId?: string }
            | undefined
          if (!motion) return
          const pivot = restGroups.get(`${motion.nodeId}:${motion.groupId}`)
          if (!pivot) return
          transforms.push({
            object,
            position: object.position.clone(),
            rotation: object.rotation.clone(),
          })
          object.position.set(...pivot)
          object.rotation.set(0, 0, 0)
        })
        scene.updateMatrixWorld(true)
        const { blob, outW, outH } = await pipeline.capture({ captureMode: 'standard' })
        onComplete(blob, { w: outW, h: outH })
      } catch (error) {
        console.error(
          '[bake-thumbnail]',
          error instanceof Error ? (error.stack ?? error.message) : error,
        )
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        pipeline?.dispose()
        for (const [material, intensity] of emission)
          (material as Material & { emissiveIntensity: number }).emissiveIntensity = intensity
        for (const { object, position, rotation } of transforms) {
          object.position.copy(position)
          object.rotation.copy(rotation)
        }
        scene.updateMatrixWorld(true)
        for (const [id, on] of priorLights)
          useInteractive
            .getState()
            .setProceduralLights(id as import('@pascal-app/core').AnyNodeId, on)
        restoreNodeVisibility()
      }
    }

    void run()
  }, [active, atmosphere, onComplete, onError, renderer, scene])

  return null
}
