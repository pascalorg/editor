'use client'

import type { FloorplanPalette } from '@pascal-app/core'
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

/**
 * Per-frame render context shared between the legacy `floorplan-panel.tsx`
 * and the registry-driven `<FloorplanRegistryLayer>`.
 *
 * The legacy panel is the authoritative owner of the floor-plan SVG —
 * it computes `unitsPerPixel` from the viewBox / surface size, mounts the
 * pan/zoom `<g>`, and knows the active theme. The registry layer is mounted
 * inside the same `<g>`, so anything it draws shares the same coordinate
 * system; this context plumbs through the bits it can't recompute on its
 * own without re-implementing the legacy's resize / theme logic.
 *
 * Once `floorplan-panel.tsx` is fully migrated (Phase 6), this provider
 * moves into a kind-agnostic 2D editor shell and the context loses the
 * "legacy bridge" connotation.
 */
export type FloorplanRenderContextValue = {
  /** SVG units per screen pixel — used to keep handle radii consistent at any zoom. */
  unitsPerPixel: number
  /** Themed palette mirroring the legacy `FloorplanPalette` accent slots. */
  palette: FloorplanPalette
  /** SVG `<pattern>` id mounted in `<defs>` by the legacy panel for selection hatch fills. */
  hatchPatternId: string
  /**
   * Rotation (degrees) applied to the registry layer's parent `<g>` by the
   * legacy panel — 90° by default, adjusted by building rotation. Renderers
   * that emit text labels use this to keep their final on-screen orientation
   * readable instead of mirroring whatever the parent rotation is.
   */
  sceneRotationDeg: number
}

export type FloorplanStaticRenderContextValue = Omit<
  FloorplanRenderContextValue,
  'sceneRotationDeg' | 'unitsPerPixel'
> & {
  getSceneRotationDeg: () => number
  getUnitsPerPixel: () => number
  subscribeUnitsPerPixel: (listener: () => void) => () => void
}

const FloorplanStaticRenderContext = createContext<FloorplanStaticRenderContextValue | null>(null)
const FloorplanSceneRotationContext = createContext(0)
const FloorplanUnitsPerPixelContext = createContext(1)

export type FloorplanRenderScaleReference = {
  read: () => number
  subscribe: (listener: () => void) => () => void
  update: (unitsPerPixel: number) => void
}

export function createFloorplanRenderScaleReference(
  initialUnitsPerPixel: number,
): FloorplanRenderScaleReference {
  let unitsPerPixel = initialUnitsPerPixel
  const listeners = new Set<() => void>()
  return {
    read: () => unitsPerPixel,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update: (nextUnitsPerPixel) => {
      if (Object.is(unitsPerPixel, nextUnitsPerPixel)) return
      unitsPerPixel = nextUnitsPerPixel
      for (const listener of listeners) listener()
    },
  }
}

export function FloorplanRenderProvider({
  children,
  unitsPerPixel,
  palette,
  hatchPatternId,
  sceneRotationDeg,
  getSceneRotationDeg,
}: FloorplanRenderContextValue & {
  children: ReactNode
  getSceneRotationDeg: () => number
}) {
  const renderScaleReference = useRef<FloorplanRenderScaleReference | null>(null)
  if (!renderScaleReference.current) {
    renderScaleReference.current = createFloorplanRenderScaleReference(unitsPerPixel)
  }
  const getUnitsPerPixel = renderScaleReference.current.read
  const subscribeUnitsPerPixel = renderScaleReference.current.subscribe
  useLayoutEffect(() => {
    renderScaleReference.current?.update(unitsPerPixel)
  }, [unitsPerPixel])
  const staticValue = useMemo<FloorplanStaticRenderContextValue>(
    () => ({
      palette,
      hatchPatternId,
      getSceneRotationDeg,
      getUnitsPerPixel,
      subscribeUnitsPerPixel,
    }),
    [palette, hatchPatternId, getSceneRotationDeg, getUnitsPerPixel, subscribeUnitsPerPixel],
  )
  return (
    <FloorplanStaticRenderContext.Provider value={staticValue}>
      <FloorplanUnitsPerPixelContext.Provider value={unitsPerPixel}>
        <FloorplanSceneRotationContext.Provider value={sceneRotationDeg}>
          {children}
        </FloorplanSceneRotationContext.Provider>
      </FloorplanUnitsPerPixelContext.Provider>
    </FloorplanStaticRenderContext.Provider>
  )
}

/**
 * Read the active render context. Returns `null` when called outside a
 * provider — the registry layer treats this as "render statically, skip
 * theme-aware chrome and interactive handles". This makes the layer
 * usable in isolation tests + future editor shells without bringing the
 * whole legacy panel along.
 */
export function useFloorplanRender(): FloorplanRenderContextValue | null {
  const staticValue = useContext(FloorplanStaticRenderContext)
  const sceneRotationDeg = useContext(FloorplanSceneRotationContext)
  const unitsPerPixel = useContext(FloorplanUnitsPerPixelContext)
  return useMemo(
    () =>
      staticValue
        ? {
            unitsPerPixel,
            palette: staticValue.palette,
            hatchPatternId: staticValue.hatchPatternId,
            sceneRotationDeg,
          }
        : null,
    [sceneRotationDeg, staticValue, unitsPerPixel],
  )
}

export function useFloorplanStaticRender(): FloorplanStaticRenderContextValue | null {
  return useContext(FloorplanStaticRenderContext)
}

const subscribeToNoFloorplanScale = () => () => {}
const readDefaultFloorplanScale = () => 1

export function useFloorplanStaticUnitsPerPixel(): number {
  const staticValue = useContext(FloorplanStaticRenderContext)
  return useSyncExternalStore(
    staticValue?.subscribeUnitsPerPixel ?? subscribeToNoFloorplanScale,
    staticValue?.getUnitsPerPixel ?? readDefaultFloorplanScale,
    staticValue?.getUnitsPerPixel ?? readDefaultFloorplanScale,
  )
}

export function useFloorplanSceneRotation(): number {
  return useContext(FloorplanSceneRotationContext)
}
