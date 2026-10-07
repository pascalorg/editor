import type {
  ColumnNode,
  DoorNode,
  HandleDescriptor,
  LinearResizeHandle,
  WindowNode,
} from '@pascal-app/core'
import { rebuildAuthoredObject } from '@pascal-app/editor'

type Opening = WindowNode | DoorNode

/**
 * A window or door built from a script resizes only through the params its
 * script declares: a `width` param keeps the side arrows, a `height` param
 * the top arrow (the bottom stays on its sill or threshold), and nothing
 * else shows. The drag previews the box; release rebuilds the script with
 * the param moved by the dragged amount (trim around the opening included).
 */
export function scriptedOpeningHandles<N extends Opening>(
  node: N,
  width: (side: 'left' | 'right') => HandleDescriptor<N>,
  height: () => HandleDescriptor<N>,
): HandleDescriptor<N>[] {
  const declared = new Set(node.source?.manifest.params.map((spec) => spec.id))
  const handles: HandleDescriptor<N>[] = []
  if (declared.has('width')) {
    handles.push(byParam(width('left'), 'width'), byParam(width('right'), 'width'))
  }
  if (declared.has('height')) handles.push(byParam(height(), 'height'))
  return handles
}

function byParam<N extends Opening>(
  handle: HandleDescriptor<N>,
  param: 'width' | 'height',
): HandleDescriptor<N> {
  const linear = handle as LinearResizeHandle<N>
  return {
    ...linear,
    commit: (initial, patch) =>
      // A side arrow keeps the opposite edge: the rebuild takes the moved centre.
      rebuildScriptedSize(initial, patch, param === 'width' ? patch.position : undefined),
  }
}

const SIZE_PARAMS = new Set(['width', 'height', 'depth'])

/**
 * A scripted window, door or column resized by a handle: each size param its
 * script declares moves by the dragged amount, within the param's range, and
 * the script reruns once.
 */
export function rebuildScriptedSize<N extends Opening | ColumnNode>(
  initial: N,
  patch: Partial<N>,
  position?: N['position'],
): void {
  const source = initial.source
  if (!source) return
  const params = { ...source.params }
  let moved = false
  for (const spec of source.manifest.params) {
    const next = (patch as Record<string, unknown>)[spec.id]
    if (!SIZE_PARAMS.has(spec.id) || typeof next !== 'number') continue
    const before = (initial as unknown as Record<string, number>)[spec.id]!
    const current = Number(source.params[spec.id] ?? spec.default ?? before)
    params[spec.id] = clamp(current + (next - before), spec.min, spec.max)
    moved = true
  }
  if (!moved) return
  rebuildAuthoredObject(initial.id, params, position).catch((reason: unknown) =>
    console.error('[scripted] resize failed', reason),
  )
}

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value))
