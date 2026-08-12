import { type CadUnderlay, fromUnderlayBuffer } from '@pascal-app/cad-import'
import { loadAssetUrl } from '@pascal-app/core'

/**
 * Loaded CAD underlays, keyed by asset URL.
 *
 * The registry's two builders — `def.floorplan` (2D) and `def.geometry` /
 * renderers (3D) — are synchronous, but an underlay's geometry lives in an
 * asset that has to be fetched. This module bridges the two: the load happens
 * once, off to the side, and both builders read the result synchronously.
 *
 * It also does the per-layer precomputation once at load rather than on every
 * rebuild. That is the difference between a floor-plan pass costing O(layers)
 * and costing O(segments) — a real drawing has tens of layers and hundreds of
 * thousands of segments.
 */
export type LoadedCadUnderlay = {
  underlay: CadUnderlay
  /** SVG path data per layer index, in recentred drawing units. */
  pathByLayer: string[]
  /** Line-segment vertex positions per layer index, as flat `x, y, z` triples. */
  positionsByLayer: Float32Array[]
  /** Segment count per layer index, for the import UI's layer list. */
  countByLayer: number[]
}

type CacheEntry =
  | { status: 'loading'; promise: Promise<LoadedCadUnderlay | null> }
  | { status: 'ready'; value: LoadedCadUnderlay }
  | { status: 'error'; error: Error }

const cache = new Map<string, CacheEntry>()
const listeners = new Set<() => void>()

/**
 * Bumped whenever a load settles. Views that build their geometry
 * synchronously from the cache subscribe to this so an underlay that arrives
 * after the first render still shows up — without it, reopening a saved scene
 * would leave the plan blank until some unrelated edit forced a rebuild.
 */
let revision = 0

function notify(): void {
  revision++
  for (const listener of listeners) listener()
}

export function getCadUnderlayRevision(): number {
  return revision
}

/**
 * Subscribe to load completions. The 3D renderer and the floor-plan panel use
 * this to re-read the cache once an underlay arrives — without it, geometry
 * imported into an already-open scene would not appear until some unrelated
 * change forced a rebuild.
 */
export function subscribeToCadUnderlays(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The loaded underlay, or null when it is still loading or failed. */
export function getCadUnderlay(url: string): LoadedCadUnderlay | null {
  const entry = cache.get(url)
  return entry?.status === 'ready' ? entry.value : null
}

export function getCadUnderlayError(url: string): Error | null {
  const entry = cache.get(url)
  return entry?.status === 'error' ? entry.error : null
}

/**
 * Start loading an underlay if it isn't already cached. Safe to call on every
 * render — concurrent calls share one in-flight request.
 */
export function loadCadUnderlay(url: string): Promise<LoadedCadUnderlay | null> {
  const entry = cache.get(url)
  if (entry?.status === 'ready') return Promise.resolve(entry.value)
  if (entry?.status === 'loading') return entry.promise
  if (entry?.status === 'error') return Promise.resolve(null)

  const promise = fetchUnderlay(url)
    .then((value) => {
      cache.set(url, { status: 'ready', value })
      notify()
      return value
    })
    .catch((error: unknown) => {
      cache.set(url, {
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      })
      notify()
      return null
    })

  cache.set(url, { status: 'loading', promise })
  return promise
}

/** Drop a cached underlay — used when its node is deleted or re-imported. */
export function releaseCadUnderlay(url: string): void {
  cache.delete(url)
}

/**
 * Publish an already-parsed underlay under its asset URL.
 *
 * The import flow parses the drawing in a worker and writes the asset, and
 * would otherwise have to read straight back through IndexedDB to draw what it
 * just produced. Seeding the cache instead means a freshly imported drawing is
 * on screen the moment its node exists.
 */
export function primeCadUnderlay(url: string, underlay: CadUnderlay): LoadedCadUnderlay {
  const value = buildLoadedUnderlay(underlay)
  cache.set(url, { status: 'ready', value })
  notify()
  return value
}

async function fetchUnderlay(url: string): Promise<LoadedCadUnderlay> {
  const resolved = await loadAssetUrl(url)
  if (!resolved) throw new Error(`CAD underlay asset not found: ${url}`)

  const response = await fetch(resolved)
  if (!response.ok) {
    throw new Error(`CAD underlay asset could not be read (${response.status}).`)
  }
  return buildLoadedUnderlay(fromUnderlayBuffer(await response.arrayBuffer()))
}

/**
 * Split the flat segment buffer into the per-layer forms the two views need.
 *
 * Exported for tests and for the import preview, which builds this from an
 * in-memory parse before any asset has been written.
 */
export function buildLoadedUnderlay(underlay: CadUnderlay): LoadedCadUnderlay {
  const layerCount = Math.max(underlay.layers.length, 1)
  const counts = new Array<number>(layerCount).fill(0)
  for (let i = 0; i < underlay.segmentLayers.length; i++) {
    const layer = underlay.segmentLayers[i]!
    if (layer < layerCount) counts[layer] = counts[layer]! + 1
  }

  const positionsByLayer = counts.map((count) => new Float32Array(count * 6))
  const paths = new Array<string[]>(layerCount)
  for (let i = 0; i < layerCount; i++) paths[i] = []
  const cursors = new Array<number>(layerCount).fill(0)

  for (let i = 0; i < underlay.segmentLayers.length; i++) {
    const layer = underlay.segmentLayers[i]!
    if (layer >= layerCount) continue

    const x1 = underlay.segments[i * 4]!
    const y1 = underlay.segments[i * 4 + 1]!
    const x2 = underlay.segments[i * 4 + 2]!
    const y2 = underlay.segments[i * 4 + 3]!

    // The plan is drawn on the XZ ground plane, so the drawing's Y becomes Z
    // and the elevation stays 0 — the underlay is flat on the level.
    const positions = positionsByLayer[layer]!
    const cursor = cursors[layer]!
    positions[cursor] = x1
    positions[cursor + 1] = 0
    positions[cursor + 2] = y1
    positions[cursor + 3] = x2
    positions[cursor + 4] = 0
    positions[cursor + 5] = y2
    cursors[layer] = cursor + 6

    paths[layer]!.push(`M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`)
  }

  return {
    underlay,
    pathByLayer: paths.map((commands) => commands.join('')),
    positionsByLayer,
    countByLayer: counts,
  }
}

/**
 * Drawing units are typically millimetres, so three decimals is a micron —
 * far past what anyone can see or snap to, and every digit past it is pure
 * string weight on a path that may hold hundreds of thousands of commands.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
