import type { AnyNode } from '../schema/types'

const fields = ['supportSurfaceId', 'landscapeSurfaceId'] as const

export function remapSurfaceSupportReferences(
  node: AnyNode,
  ids: ReadonlyMap<string, string>,
): void {
  const record = node as unknown as Record<string, unknown>
  for (const field of fields) {
    const id = record[field]
    if (typeof id === 'string') record[field] = ids.get(id) ?? id
  }
}

export function deletedSurfaceSupportPatch(
  node: AnyNode,
  deleted: ReadonlySet<string>,
): Partial<AnyNode> | null {
  const record = node as unknown as Record<string, unknown>
  const patch: Record<string, undefined> = {}
  for (const field of fields) {
    const id = record[field]
    if (typeof id === 'string' && deleted.has(id)) patch[field] = undefined
  }
  return Object.keys(patch).length ? (patch as Partial<AnyNode>) : null
}
