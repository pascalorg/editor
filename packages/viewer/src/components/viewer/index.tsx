'use client'

import { StairOpeningSystem } from '@pascal-app/core'
import { Canvas, extend, type ThreeToJSXElements, useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three/webgpu'
import { PERF_OVERLAY_ENABLED, pushGpuSample } from '../../lib/gpu-perf'
import type { ColorPreset, RenderShading } from '../../lib/materials'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer, { type RenderContext } from '../../store/use-viewer'
import { FloorElevationSystem } from '../../systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../systems/geometry/geometry-system'
import { ErrorBoundary } from '../error-boundary'
import { SceneRenderer } from '../renderers/scene-renderer'
import FrameLimiter from './frame-limiter'
import { Lights } from './lights'
import { PerfMonitor } from './perf-monitor'
import PostProcessing, { DEFAULT_HOVER_STYLES, type HoverStyles } from './post-processing'
import { RegisteredSystems } from './registered-systems'
import { SceneBvh } from './scene-bvh'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any)

// R3F's <Canvas> useLayoutEffect has no deps, so any re-render (theme switch,
// parent re-render, StrictMode double-mount) re-invokes `configure()`. With a
// sync `gl` factory that's harmless — the renderer is created once and reused.
// With an async factory (WebGPURenderer needs `await init()`), two configure
// calls can race: both see `state.gl == null` and both create a renderer. The
// first to resolve gets `setSize`/`setDpr` called on it; the second overwrites
// `state.gl` but R3F's store already holds the new size/dpr, so the new
// renderer is never resized and stays at the canvas's 300×150 default.
//
// Caching by canvas guarantees both branches return the same instance, so
// "duplicate" configure calls become no-ops on an already-sized renderer.
// We cache the in-flight Promise (not just the resolved renderer) so two
// concurrent configure() calls await the same init instead of creating two
// renderers in parallel and only caching the second.
const WEBGPU_RENDERER_CACHE = new WeakMap<HTMLCanvasElement, Promise<THREE.WebGPURenderer>>()

/**
 * Monitors the WebGPU device for loss / uncaptured errors and logs them.
 * WebGPU device loss can happen when:
 *  - Tab is backgrounded and OS reclaims GPU
 *  - Driver crash or GPU reset
 *  - Browser security policy kills the context
 */
type WebGPUDeviceLossInfo = {
  reason?: string
  message?: string
}

type WebGPUDeviceLike = {
  lost: Promise<WebGPUDeviceLossInfo>
  label?: string
  features?: Set<string>
  addEventListener?: (type: string, listener: EventListener) => void
  removeEventListener?: (type: string, listener: EventListener) => void
}

function GPUDeviceWatcher() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const backend = (gl as any).backend
    const device = backend?.device as WebGPUDeviceLike | undefined

    if (!device) {
      console.warn('[viewer] No WebGPU device on backend — running on a fallback renderer.', {
        backend: backend?.constructor?.name ?? 'unknown',
        rendererType: (gl as any).constructor?.name ?? 'unknown',
      })
      return
    }

    console.log('[viewer] WebGPU device ready', {
      label: device.label,
      features: Array.from(device.features ?? []),
    })

    device.lost.then((info: WebGPUDeviceLossInfo) => {
      console.error(
        `[viewer] WebGPU device lost: reason="${info.reason ?? 'unknown'}", message="${info.message ?? ''}". ` +
          'The page must be reloaded to recover the GPU context.',
      )
    })

    // Uncaptured errors are normally silent (only console-warned by Chrome at
    // best). Pipe them to console.error so silent mobile crashes show up.
    const onUncapturedError = (event: any) => {
      console.error('[viewer] WebGPU uncaptured error:', event?.error?.message, event?.error)
    }
    device.addEventListener?.('uncapturederror', onUncapturedError)

    return () => {
      device.removeEventListener?.('uncapturederror', onUncapturedError)
    }
  }, [gl])

  return null
}

function ToneMappingExposure() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    gl.toneMappingExposure = getSceneTheme(sceneTheme).toneMappingExposure
    invalidate()
  }, [gl, invalidate, sceneTheme])

  return null
}

interface ViewerProps {
  children?: React.ReactNode
  hoverStyles?: HoverStyles
  selectionManager?: 'default' | 'custom'
  perf?: boolean
  useBvh?: boolean
  renderContext?: RenderContext
  defaultRender?: {
    shading?: RenderShading
    textures?: boolean
    colorPreset?: ColorPreset
  }
}

const Viewer: React.FC<ViewerProps> = ({
  children,
  hoverStyles = DEFAULT_HOVER_STYLES,
  selectionManager = 'default',
  perf = false,
  useBvh = true,
  renderContext = 'editor',
  defaultRender,
}) => {
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  useEffect(() => {
    const ctx = renderContext
    useViewer.getState().setRenderContext(ctx)
    const { shading, shadingByContext, setShading } = useViewer.getState()
    setShading(shadingByContext[ctx] ?? defaultRender?.shading ?? shading)

    if (!defaultRender || typeof window === 'undefined') return

    let persistedState: Record<string, unknown> = {}
    const rawPreferences = window.localStorage.getItem('viewer-preferences')
    if (rawPreferences) {
      try {
        const parsed = JSON.parse(rawPreferences)
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.state &&
          typeof parsed.state === 'object'
        ) {
          persistedState = parsed.state as Record<string, unknown>
        }
      } catch {}
    }

    if (defaultRender.textures !== undefined && !('textures' in persistedState)) {
      useViewer.getState().setTextures(defaultRender.textures)
    }
    if (defaultRender.colorPreset && !('colorPreset' in persistedState)) {
      useViewer.getState().setColorPreset(defaultRender.colorPreset)
    }
  }, [])

  // Coarse-pointer devices (phones/tablets) get a tighter DPR ceiling to keep
  // fragment-shader cost down — saves another ~30% over 1.5x on high-DPI mobile.
  // Desktops (fine pointer) keep the original 1.5 cap.
  const maxDpr =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5
  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${isDark ? 'bg-[#1f2433]' : 'bg-[#fafafa]'}`}
      dpr={[1, maxDpr]}
      frameloop="never"
      gl={
        ((props: { canvas?: HTMLCanvasElement }) => {
          const canvas = props.canvas
          const cached = canvas ? WEBGPU_RENDERER_CACHE.get(canvas) : undefined
          if (cached) return cached
          const promise = (async () => {
            try {
              const renderer = new THREE.WebGPURenderer(props as any)
              renderer.toneMapping = THREE.ACESFilmicToneMapping
              renderer.toneMappingExposure = getSceneTheme(
                useViewer.getState().sceneTheme,
              ).toneMappingExposure
              await renderer.init()
              return renderer
            } catch (err) {
              // Drop the failed promise from the cache so a future Canvas
              // mount on the same DOM can retry instead of inheriting the
              // rejection forever.
              if (canvas) WEBGPU_RENDERER_CACHE.delete(canvas)
              console.error('[viewer] WebGPURenderer init failed', err)
              throw err
            }
          })()
          if (canvas) WEBGPU_RENDERER_CACHE.set(canvas, promise)
          return promise
        }) as any
      }
      resize={{
        debounce: 100,
      }}
      shadows={{
        type: THREE.PCFShadowMap,
        enabled: true,
      }}
    >
      <FrameLimiter fps={50} />
      <ViewerCamera />
      <GPUDeviceWatcher />
      <ToneMappingExposure />

      <ErrorBoundary fallback={null} scope="viewer-scene">
        {/* <directionalLight position={[10, 10, 5]} intensity={0.5} castShadow
          /> */}
        <Lights />
        {useBvh ? (
          <SceneBvh>
            <SceneRenderer />
          </SceneBvh>
        ) : (
          <SceneRenderer />
        )}

        {/* Generic slab-elevation lift for any kind that declares
            `capabilities.floorPlaced`. Runs at frame priority 1 so it
            lands its mesh.position.y override before the priority-2
            systems below clear the dirty mark. */}
        <FloorElevationSystem />
        {/* Generic geometry rebuild loop for any registered kind that
            ships `def.geometry`. Reads dirtyNodes, calls the kind's pure
            builder, swaps the registered group's children. See
            wiki/architecture/node-definitions.md. */}
        <GeometrySystem />
        {/* Automated stair opening sync — updates slab/ceiling cutouts
            whenever stairs, slabs, or levels change. */}
        <StairOpeningSystem />
        {/* Mounts systems contributed by registry-backed kinds. Each
            kind's `def.system` is loaded via lazy() and rendered here,
            ordered by `system.priority`. */}
        <RegisteredSystems />
        <PostProcessing hoverStyles={hoverStyles} />
        {selectionManager === 'default' && <SelectionManager />}
        {(perf || PERF_OVERLAY_ENABLED) && <PerfMonitor />}
        {children}
      </ErrorBoundary>
    </Canvas>
  )
}

const DebugRenderer = () => {
  useFrame(({ gl, scene, camera }) => {
    const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
    gl.render(scene, camera)
    if (PERF_OVERLAY_ENABLED) {
      const queue = (gl as any).backend?.device?.queue as
        | { onSubmittedWorkDone?: () => Promise<void> }
        | undefined
      queue?.onSubmittedWorkDone?.().then(() => {
        pushGpuSample(performance.now() - submittedAt)
      })
    }
  })
  return null
}

export default Viewer
