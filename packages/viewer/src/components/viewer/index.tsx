'use client'

import {
  CeilingSystem,
  DoorSystem,
  FenceSystem,
  ItemSystem,
  RoofSystem,
  SlabSystem,
  StairSystem,
  WallSystem,
  WindowSystem,
} from '@pascal-app/core'
import { Bvh } from '@react-three/drei'
import { Canvas, extend, type ThreeToJSXElements, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { GuideSystem } from '../../systems/guide/guide-system'
import { ItemLightSystem } from '../../systems/item-light/item-light-system'
import { ItemMeshMetadataSystem } from '../../systems/item-mesh-metadata/item-mesh-metadata-system'
import { LevelSystem } from '../../systems/level/level-system'
import { ScanSystem } from '../../systems/scan/scan-system'
import { WallCutout } from '../../systems/wall/wall-cutout'
import { ZoneSystem } from '../../systems/zone/zone-system'
import { ErrorBoundary } from '../error-boundary'
import { SceneRenderer } from '../renderers/scene-renderer'
import FrameLimiter from './frame-limiter'
import { Lights } from './lights'
import { PerfMonitor } from './perf-monitor'
import PostProcessing, { DEFAULT_HOVER_STYLES, type HoverStyles } from './post-processing'
import { SelectionManager } from './selection-manager'
import { ViewerCamera } from './viewer-camera'

function AnimatedBackground({ isDark }: { isDark: boolean }) {
  const targetColor = useMemo(() => new THREE.Color(), [])
  const initialized = useRef(false)

  useFrame(({ scene }, delta) => {
    const dt = Math.min(delta, 0.1) * 4
    const targetHex = isDark ? '#1f2433' : '#ffffff'

    if (!(scene.background && scene.background instanceof THREE.Color)) {
      scene.background = new THREE.Color(targetHex)
      initialized.current = true
      return
    }

    if (!initialized.current) {
      scene.background.set(targetHex)
      initialized.current = true
      return
    }

    targetColor.set(targetHex)
    scene.background.lerp(targetColor, dt)
  })

  return null
}

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
 * Monitors the WebGPU device for loss events and logs them.
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
      features: device.features ? Array.from(device.features) : [],
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

interface ViewerProps {
  children?: React.ReactNode
  hoverStyles?: HoverStyles
  selectionManager?: 'default' | 'custom'
  perf?: boolean
}

const Viewer: React.FC<ViewerProps> = ({
  children,
  hoverStyles = DEFAULT_HOVER_STYLES,
  selectionManager = 'default',
  perf = false,
}) => {
  const theme = useViewer((state) => state.theme)
  return (
    <Canvas
      camera={{ position: [50, 50, 50], fov: 50 }}
      className={`transition-colors duration-700 ${theme === 'dark' ? 'bg-[#1f2433]' : 'bg-[#fafafa]'}`}
      dpr={[1, 1.5]}
      frameloop="never"
      gl={
        ((props: { canvas?: HTMLCanvasElement }) => {
          const canvas = props.canvas
          const cached = canvas ? WEBGPU_RENDERER_CACHE.get(canvas) : undefined
          if (cached) return cached
          // Surface the env we're about to ask WebGPU for — catches "no
          // navigator.gpu" / "adapter request failed" silently failing in
          // mobile WebViews where WebGPU is gated behind flags.
          const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
          console.log('[viewer] Creating WebGPURenderer', {
            hasNavigatorGPU: hasGpu,
            ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
          })
          const promise = (async () => {
            try {
              const renderer = new THREE.WebGPURenderer(props as any)
              renderer.toneMapping = THREE.ACESFilmicToneMapping
              renderer.toneMappingExposure = 0.9
              await renderer.init()
              console.log('[viewer] WebGPURenderer ready', {
                backend: (renderer as any).backend?.constructor?.name,
                isWebGPU: (renderer as any).isWebGPURenderer === true,
              })
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
      {/* <AnimatedBackground isDark={theme === 'dark'} /> */}
      <ViewerCamera />
      <GPUDeviceWatcher />

      <ErrorBoundary fallback={null} scope="viewer-scene">
        {/* <directionalLight position={[10, 10, 5]} intensity={0.5} castShadow
          /> */}
        <Lights />
        <Bvh>
          <SceneRenderer />
        </Bvh>

        {/* Default Systems */}
        <LevelSystem />
        <GuideSystem />
        <ScanSystem />
        <WallCutout />
        {/* Core systems */}
        <CeilingSystem />
        <DoorSystem />
        <FenceSystem />
        <ItemSystem />
        <RoofSystem />
        <SlabSystem />
        <StairSystem />
        <WallSystem />
        <WindowSystem />
        <ZoneSystem />
        <PostProcessing hoverStyles={hoverStyles} />
        {/* <DebugRenderer /> */}

        <ItemLightSystem />
        <ItemMeshMetadataSystem />
        {selectionManager === 'default' && <SelectionManager />}
        {perf && <PerfMonitor />}
        {children}
      </ErrorBoundary>
    </Canvas>
  )
}

const DebugRenderer = () => {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)
  })
  return null
}

export default Viewer
