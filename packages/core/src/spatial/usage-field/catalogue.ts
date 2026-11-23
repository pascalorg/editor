import type { GeometryShape } from '../../schema'
import { CATALOGUE_SHAPES } from './catalogue-shapes'

const CATALOGUE_MODEL = /\/items\/([^/]+\/[^/]+)\/model\.glb(?:\?.*)?$/

/** A library model's key (`system/toilet`) from the URL its item points at, whatever the host serves it from. */
export function catalogueKey(src: string): string | null {
  return CATALOGUE_MODEL.exec(src)?.[1] ?? null
}

/** What a library model occupies in plan, in its GLB's own frame, as baked by `bake-catalogue-shapes.ts`. */
export function catalogueShape(src: string): GeometryShape | undefined {
  const key = catalogueKey(src)
  return key ? CATALOGUE_SHAPES[key] : undefined
}
