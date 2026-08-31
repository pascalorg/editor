import type * as THREE from 'three'

export type ItemClipEntry = {
  /** The catalog clip to re-emit (e.g. a fan's "On" spin). */
  clip: THREE.AnimationClip
  /** Plays looping in the baked viewer (ambient motion) vs once. */
  loop: boolean
}

/**
 * Catalog-item animation clips the bake needs to re-emit. A catalog GLB ships
 * its own clips (the live item renderer loads + plays them), but those clips
 * are not part of the editor scene graph, so the GLB export can't see them on
 * its own. The item renderer registers the resolved clip per node id while the
 * scene is live; `glb-export` reads this and retargets the clip onto the baked
 * item subtree. Door/window motion is synthesized separately and never goes
 * here. Keyed by node id; cleared with the rest of the scene refs on unload.
 */
export const itemClipRegistry = new Map<string, ItemClipEntry>()
