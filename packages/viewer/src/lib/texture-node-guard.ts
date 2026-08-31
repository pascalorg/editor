import type * as THREE from 'three/webgpu'
import { DataTexture, TextureNode } from 'three/webgpu'

let installed = false
let reported = 0
let fallbackTexture: THREE.Texture | null = null

function getFallbackTexture(): THREE.Texture {
  if (!fallbackTexture) {
    fallbackTexture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    fallbackTexture.needsUpdate = true
  }
  return fallbackTexture
}

/**
 * three's node system pulls texture uniforms from materials each frame via
 * reference nodes, and several override-material passes (shadow, depth/normal
 * prepasses) copy per-object texture slots onto shared materials whose cached
 * per-mesh node graphs can disagree about a slot's presence. When they do,
 * `TextureNode.update` dereferences a null texture and the exception kills the
 * whole render pass — the scene goes black. Substitute a 1×1 black fallback
 * instead (skipping is not enough: the null would still reach the backend's
 * texture-binding WeakMap). The slot renders black for a frame and recovers
 * as soon as the reference pulls a real value again.
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
        console.warn(`[viewer] TextureNode ${this.uuid} has no texture — using fallback`)
      }
      this.value = getFallbackTexture()
    }
    originalUpdate.call(this)
  }
}
