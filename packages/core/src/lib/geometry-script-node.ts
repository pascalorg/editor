import type { CompiledGeometryScript } from '../schema'
import type { DoorNode } from '../schema/nodes/door'
import type { ItemNode } from '../schema/nodes/item'
import type { WindowNode } from '../schema/nodes/window'

/** A node built from a three.js script: an authored item, or a window or door with a script source. */
export type ScriptedNode = (ItemNode | WindowNode | DoorNode) & {
  source: NonNullable<ItemNode['source']>
}

export const isScriptedNode = (
  node: { type: string; source?: unknown } | undefined,
): node is ScriptedNode =>
  Boolean(node?.source) &&
  (node!.type === 'item' || node!.type === 'window' || node!.type === 'door')

/** The `source` a compile produces, the same on every kind. */
export const scriptSource = (compiled: CompiledGeometryScript) => ({
  kind: 'script' as const,
  language: 'three' as const,
  script: compiled.script,
  params: compiled.params,
  artifact: compiled.sha256,
  manifest: compiled.manifest,
})

/** Width, height and depth of what the script built. */
export function scriptedSize(
  manifest: CompiledGeometryScript['manifest'],
): [number, number, number] {
  const { min, max } = manifest.bounds
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

/**
 * The item's controls from what the module emitted: a light switch for its
 * lights, an open/close toggle for an `open` clip (closing plays `close`, or
 * `open` reversed), a `loop` clip that runs throughout, and a play toggle per
 * other clip, labelled with its name.
 */
export function scriptInteractive(
  manifest: CompiledGeometryScript['manifest'],
): ItemNode['asset']['interactive'] {
  const controls: NonNullable<ItemNode['asset']['interactive']>['controls'] = []
  const effects: NonNullable<ItemNode['asset']['interactive']>['effects'] = []
  if (manifest.lights.length > 0) {
    controls.push({ kind: 'toggle', label: 'Lights', default: true })
    for (const light of manifest.lights) {
      effects.push({
        kind: 'light',
        color: light.color,
        intensityRange: [0, light.intensity],
        distance: light.distance,
        offset: light.position,
      })
    }
  }
  const clip = (name: string) => manifest.animations.some((animation) => animation.name === name)
  if (clip('open')) {
    effects.push({
      kind: 'animation',
      mode: 'open-close',
      control: controls.length,
      clips: { on: 'open', off: clip('close') ? 'close' : undefined },
    })
    controls.push({ kind: 'toggle', label: 'Open', default: false })
  }
  if (clip('loop')) effects.push({ kind: 'animation', mode: 'ambient', clips: { loop: 'loop' } })
  // Every other clip gets its own play toggle, labelled with its name.
  for (const { name } of manifest.animations) {
    if (name === 'open' || name === 'close' || name === 'loop') continue
    effects.push({
      kind: 'animation',
      mode: 'ambient',
      control: controls.length,
      clips: { on: name },
    })
    controls.push({ kind: 'toggle', label: name, default: false })
  }
  return effects.length > 0 ? { controls, effects } : undefined
}
