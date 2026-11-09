import type { Object3D } from 'three'

/**
 * Baked nodes whose loop clips no other controller plays (a plugin kind's
 * mechanism, such as an articulated asset's joints), read from the GLB alone:
 * `pascalId` → its `: loop` clip names. `owned` holds the nodes procedural
 * playback or the scene graph's interactive items already drive; openables
 * keep their open/close path.
 */
export function bakedLoopMechanisms(
  identity: ReadonlyMap<string, Object3D>,
  owned: ReadonlySet<string>,
): Map<string, string[]> {
  const mechanisms = new Map<string, string[]>()
  for (const [id, object] of identity) {
    const { clips, openable } = object.userData as { clips?: unknown; openable?: unknown }
    if (openable || owned.has(id) || !Array.isArray(clips)) continue
    const loops = clips.filter(
      (clip): clip is string => typeof clip === 'string' && clip.endsWith(': loop'),
    )
    if (loops.length) mechanisms.set(id, loops)
  }
  return mechanisms
}
