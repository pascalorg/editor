/**
 * The viewer's own lines for a sheet: answers `camera-controls:extract-edges`
 * with the visible feature edges of the scene through an orthographic pose
 * — the same pose the thumbnail generator captures the picture from — as
 * world segments on a `pascal:edges` DOM event (lib/vector-edges.ts).
 *
 * Runs inside the Canvas next to the ThumbnailGenerator so it shares the
 * renderer and the scene; hides what the picture hides (scan / guide /
 * spawn, the caller's types, Bones' utility plant) for the length of the
 * extraction.
 */
import { emitter } from '@pascal-app/core'
import { GRID_LAYER, holdLiveFrame, temporarilyHideNodeTypes } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { EDITOR_LAYER } from '../../lib/constants'
import { extractVisibleEdges, type VisibleEdges } from '../../lib/vector-edges'
import { hideUtilityPlant } from './thumbnail-generator'

export type ExtractEdgesRequest = {
  /** Echoed on the `pascal:edges` event so a caller matches its own answer. */
  requestId: string
  ortho: { position: [number, number, number]; target: [number, number, number]; viewWidth: number }
  /** width / height of the picture the edges go over. */
  aspect: number
  hideTypes?: readonly string[]
  /** The depth pass' width in pixels (default 2048). */
  width?: number
  thresholdDeg?: number
}

export type ExtractEdgesResult = {
  requestId: string
  ok: boolean
  segments?: Float32Array
  count?: number
  tested?: number
  ms?: number
}

export function VectorEdgeExtractor() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const respond = (detail: ExtractEdgesResult) => {
      window.dispatchEvent(new CustomEvent('pascal:edges', { detail }))
    }
    const handle = async (event: ExtractEdgesRequest) => {
      if (!event || !event.ortho) return
      // a background tab never finishes the passes' readbacks (the WebGL
      // backend polls them on animation frames): say so at once
      if (document.visibilityState === 'hidden') {
        respond({ requestId: event.requestId, ok: false })
        return
      }
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000)
      camera.layers.disable(EDITOR_LAYER)
      camera.layers.disable(GRID_LAYER)
      const halfW = event.ortho.viewWidth / 2
      const halfH = halfW / Math.max(1e-6, event.aspect)
      camera.position.set(event.ortho.position[0], event.ortho.position[1], event.ortho.position[2])
      camera.up.set(0, 1, 0)
      camera.lookAt(event.ortho.target[0], event.ortho.target[1], event.ortho.target[2])
      camera.left = -halfW
      camera.right = halfW
      camera.top = halfH
      camera.bottom = -halfH
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      // the depth and normal passes put their override material on the shared
      // scene across each GPU readback: the viewport keeps its last frame
      // meanwhile, or it draws the house in them (black, then colours)
      const releaseLiveFrame = holdLiveFrame()
      const restoreTypes = temporarilyHideNodeTypes(['scan', 'guide', 'spawn', ...(event.hideTypes ?? [])])
      const restorePlant = hideUtilityPlant(scene)
      let result: VisibleEdges | null = null
      try {
        result = await extractVisibleEdges(gl as unknown as THREE.WebGLRenderer, scene, camera, {
          width: event.width,
          thresholdDeg: event.thresholdDeg,
        })
      } catch (error) {
        console.error('[vector-edges] extraction failed', error)
      } finally {
        restorePlant()
        restoreTypes()
        releaseLiveFrame()
      }
      if (process.env.NODE_ENV !== 'production') {
        ;(window as unknown as { __pascalLastEdges?: unknown }).__pascalLastEdges = result
      }
      respond(
        result
          ? {
              requestId: event.requestId,
              ok: true,
              segments: result.segments,
              count: result.count,
              tested: result.tested,
              ms: result.ms,
            }
          : { requestId: event.requestId, ok: false },
      )
    }
    const bus = emitter as unknown as {
      on: (name: string, handler: (event: ExtractEdgesRequest) => void) => void
      off: (name: string, handler: (event: ExtractEdgesRequest) => void) => void
    }
    bus.on('camera-controls:extract-edges', handle)
    return () => bus.off('camera-controls:extract-edges', handle)
  }, [gl, scene])

  return null
}
