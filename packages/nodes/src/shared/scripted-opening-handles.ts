import type { DoorNode, HandleDescriptor, LinearResizeHandle, WindowNode } from '@pascal-app/core'
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
    commit: (initial, patch) => {
      const source = initial.source
      const next = patch[param]
      if (!source || typeof next !== 'number') return
      const spec = source.manifest.params.find((candidate) => candidate.id === param)
      const current = Number(source.params[param] ?? spec?.default ?? initial[param])
      const value = clamp(current + (next - initial[param]), spec?.min, spec?.max)
      // A side arrow keeps the opposite edge: the rebuild takes the moved centre.
      const position = param === 'width' ? (patch.position as N['position'] | undefined) : undefined
      rebuildAuthoredObject(initial.id, { ...source.params, [param]: value }, position).catch(
        (reason: unknown) => console.error('[scripted opening] resize failed', reason),
      )
    },
  }
}

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value))
