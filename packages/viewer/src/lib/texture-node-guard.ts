import { TextureNode } from 'three/webgpu'

let installed = false
let reported = 0

/**
 * three's node system pulls texture uniforms from materials each frame via
 * reference nodes, and several override-material passes (shadow, depth/normal
 * prepasses) copy per-object texture slots onto shared materials whose cached
 * per-mesh node graphs can disagree about a slot's presence. When they do,
 * `TextureNode.update` dereferences a null texture and the exception kills the
 * whole render pass — the scene goes black. Skip the update instead: the slot
 * renders without its texture for a frame and recovers as soon as the
 * reference pulls a real value again.
 */
export function installTextureNodeNullGuard(): void {
  if (installed) return
  installed = true

  const prototype = TextureNode.prototype as { update: () => void }
  const originalUpdate = prototype.update

  prototype.update = function update(this: { value: unknown; uuid: string }) {
    if (this.value == null) {
      if (reported < 5) {
        reported += 1
        console.warn(`[viewer] TextureNode ${this.uuid} has no texture — skipping update`)
      }
      return
    }
    originalUpdate.call(this)
  }
}
