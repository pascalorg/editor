import { type AnyNode, type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import type { Node, TextureNode, WebGPURenderer } from 'three/webgpu'

/**
 * Reads the id set for a node kind from the scene registry.
 *
 * `sceneRegistry.byType` is a Proxy that lazily creates a `Set` on first
 * access, so a kind lookup never yields `undefined` at runtime. TypeScript's
 * `noUncheckedIndexedAccess` still widens the index-signature access to
 * `Set<string> | undefined`, so this helper resolves the branch in one place
 * instead of a `!` at every call site.
 */
export function nodesByType(kind: string): Set<string> {
  return sceneRegistry.byType[kind] ?? new Set<string>()
}

/**
 * Indexed read that asserts the element exists. Use only where the index is
 * known in-bounds (loop counters, fixed-length tuples) and an out-of-range
 * access would be a programmer error worth surfacing.
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index]
  if (value === undefined) {
    throw new RangeError(`Index ${index} is out of bounds (length ${items.length})`)
  }
  return value
}

/**
 * Narrows a nullable value to its non-null form, throwing when absent. Use
 * where a value is guaranteed present by construction but the type still
 * admits `null`/`undefined`.
 */
export function requireDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined')
  }
  return value
}

/**
 * R3F types its renderer as `THREE.WebGLRenderer`, but the viewer configures it
 * with a `WebGPURenderer`. The two classes share no structural overlap, so this
 * boundary cast is isolated here rather than repeated at each call site.
 */
export function asWebGPURenderer(renderer: unknown): WebGPURenderer {
  return renderer as WebGPURenderer
}

/**
 * `WebGPURenderer.isWebGPURenderer` stays `true` even when the renderer falls
 * back to the WebGL backend, so callers must inspect the live backend instead.
 * A WebGPU backend exposes a GPU `device` (or identifies itself by flag/name).
 */
export function isWebGPUBackend(backend: unknown): boolean {
  if (typeof backend !== 'object' || backend === null) return false
  const candidate = backend as {
    device?: unknown
    isWebGPUBackend?: unknown
    constructor?: { name?: string }
  }
  return (
    candidate.device != null ||
    candidate.isWebGPUBackend === true ||
    candidate.constructor?.name === 'WebGPUBackend'
  )
}

/**
 * `SSGINode` produces a texture at runtime via `getTextureNode()`, but
 * `@types/three` types `SSGINode` as a bare `TempNode` without that method.
 * This helper isolates the one call that reaches past the published surface.
 */
export function ssgiTextureNode(ssgiPass: unknown): TextureNode {
  return (ssgiPass as { getTextureNode(): TextureNode }).getTextureNode()
}

/**
 * The denoise pass exposes its result via the `.r` swizzle at runtime; the
 * published `DenoiseNode` type omits swizzle accessors. Isolated here so no
 * cast leaks into the pipeline construction.
 */
export function denoiseResultNode(denoisePass: unknown): Node<'float'> {
  return (denoisePass as { r: Node<'float'> }).r
}

/**
 * Reads a node's `children` id list. `AnyNode` is a discriminated union where
 * only some variants declare `children` (each with a differently-branded id
 * array), so this resolves the read in one place and returns a plain
 * `AnyNodeId[]` for traversal.
 */
export function getChildIds(node: AnyNode): AnyNodeId[] {
  if ('children' in node && Array.isArray(node.children)) {
    return node.children as AnyNodeId[]
  }
  return []
}

/**
 * Reads a dynamic field off a node by key. `AnyNode` has no string index
 * signature, so callers that enumerate keys (snapshot/diff loops) route the
 * lookup through here instead of casting the node to a record at each site.
 */
export function readNodeField(node: AnyNode, key: string): unknown {
  return (node as Record<string, unknown>)[key]
}

/** Narrows an unknown value to a `[number, number, number]` position tuple. */
export function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  )
}

/** Narrows an unknown value to a string-keyed record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns the first element, throwing when the collection is empty. */
export function first<T>(items: ArrayLike<T>): T {
  return at(items, 0)
}
