import type { AnimationEffect, Interactive } from '../schema/nodes/item'
import type { AnyNodeId } from '../schema/types'
import { useInteractive } from './use-interactive'

/**
 * What E does on an item with toggles, in the editor walkthrough and the baked
 * viewer alike: open or close its `open` clip; play or pause its first named
 * clip when named clips are all it has; otherwise switch every toggle (a lamp,
 * a catalog fan).
 */
export type ItemInteraction =
  | { kind: 'open'; control: number }
  | { kind: 'play'; control: number; clip: string }
  | { kind: 'switch' }

export function itemInteraction(interactive: Interactive): ItemInteraction {
  const animations = interactive.effects.filter(
    (effect): effect is AnimationEffect => effect.kind === 'animation',
  )
  const open = animations.find((effect) => effect.mode === 'open-close')
  if (open?.control !== undefined) return { kind: 'open', control: open.control }
  const named = animations.find(
    (effect) => effect.mode === 'ambient' && effect.control !== undefined && effect.clips.on,
  )
  if (named && !interactive.effects.some((effect) => effect.kind === 'light'))
    return { kind: 'play', control: named.control!, clip: named.clips.on! }
  return { kind: 'switch' }
}

/** The walkthrough prompt for an item: "open Garage door", "play Princess twirl", "turn on Lamp". */
export function itemPrompt(
  itemId: AnyNodeId,
  name: string,
  interactive: Interactive,
): { label: string; verb: string; isOn: boolean } {
  const values = useInteractive.getState().items[itemId]?.controlValues
  const interaction = itemInteraction(interactive)
  if (interaction.kind === 'switch') {
    const isOn = interactive.controls.some(
      (control, index) => control.kind === 'toggle' && Boolean(values?.[index]),
    )
    return { label: name, verb: isOn ? 'turn off' : 'turn on', isOn }
  }
  const isOn = Boolean(values?.[interaction.control])
  return interaction.kind === 'open'
    ? { label: name, verb: isOn ? 'close' : 'open', isOn }
    : { label: interaction.clip, verb: isOn ? 'pause' : 'play', isOn }
}

/** E on an item, by the same rule as its prompt. */
export function operateItem(itemId: AnyNodeId, interactive: Interactive) {
  const state = useInteractive.getState()
  const interaction = itemInteraction(interactive)
  if (interaction.kind === 'switch') {
    state.toggleItemToggles(itemId, interactive)
    return
  }
  state.setControlValue(
    itemId,
    interaction.control,
    !state.items[itemId]?.controlValues[interaction.control],
  )
}
