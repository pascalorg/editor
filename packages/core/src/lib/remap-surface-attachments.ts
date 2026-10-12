import type { AnyNode } from '../schema'

export function remapSurfaceAttachments(node: AnyNode, ids: ReadonlyMap<string, string>): void {
  if (!('attachments' in node) || !node.attachments) return
  node.attachments = Object.fromEntries(
    Object.entries(node.attachments).flatMap(([id, surface]) => {
      const fresh = ids.get(id)
      return fresh ? [[fresh, surface]] : []
    }),
  )
}
