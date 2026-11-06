import {
  type AnyNode,
  type AnyNodeId,
  type ControlValue,
  type InteractionSound,
  type Interactive,
  type InteractiveState,
  isScriptedNode,
  itemInteraction,
  type MessageDescriptor,
  nodeMechanism,
  nodeMechanismParts,
  scriptedInteractive,
  toggleMechanism,
  toggleMechanismPart,
  useInteractive,
} from '@pascal-app/core'
import { operableParts, type ProceduralItemNode } from '@pascal-app/core/procedural-items'
import type {
  CalloutAction,
  CalloutIcon,
  CalloutText,
} from '../../components/viewer/selection-callout'

/** Kinds that are the building itself: the breadcrumb names them, no callout does. */
const STRUCTURE = new Set([
  'site',
  'building',
  'level',
  'zone',
  'wall',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'fence',
])

export function hasCallout(type: string | undefined): boolean {
  return Boolean(type) && !STRUCTURE.has(type!)
}

const DOOR_DETAIL: Record<string, MessageDescriptor> = {
  hinged: /* i18n */ { id: 'viewer.callout.door.hinged', message: 'Hinged door' },
  double: /* i18n */ { id: 'viewer.callout.door.double', message: 'Double door' },
  french: /* i18n */ { id: 'viewer.callout.door.french', message: 'French door' },
  folding: /* i18n */ { id: 'viewer.callout.door.folding', message: 'Folding door' },
  pocket: /* i18n */ { id: 'viewer.callout.door.pocket', message: 'Pocket door' },
  barn: /* i18n */ { id: 'viewer.callout.door.barn', message: 'Barn door' },
  sliding: /* i18n */ { id: 'viewer.callout.door.sliding', message: 'Sliding door' },
  'garage-sectional': /* i18n */ {
    id: 'viewer.callout.door.garageSectional',
    message: 'Sectional garage door',
  },
  'garage-rollup': /* i18n */ {
    id: 'viewer.callout.door.garageRollup',
    message: 'Roll-up garage door',
  },
  'garage-tiltup': /* i18n */ {
    id: 'viewer.callout.door.garageTiltup',
    message: 'Tilt-up garage door',
  },
}

const WINDOW_DETAIL: Record<string, MessageDescriptor> = {
  fixed: /* i18n */ { id: 'viewer.callout.window.fixed', message: 'Fixed window' },
  sliding: /* i18n */ { id: 'viewer.callout.window.sliding', message: 'Sliding window' },
  casement: /* i18n */ { id: 'viewer.callout.window.casement', message: 'Casement window' },
  awning: /* i18n */ { id: 'viewer.callout.window.awning', message: 'Awning window' },
  hopper: /* i18n */ { id: 'viewer.callout.window.hopper', message: 'Hopper window' },
  'tilt-turn': /* i18n */ { id: 'viewer.callout.window.tiltTurn', message: 'Tilt-and-turn window' },
  'single-hung': /* i18n */ {
    id: 'viewer.callout.window.singleHung',
    message: 'Single-hung window',
  },
  'double-hung': /* i18n */ {
    id: 'viewer.callout.window.doubleHung',
    message: 'Double-hung window',
  },
  bay: /* i18n */ { id: 'viewer.callout.window.bay', message: 'Bay window' },
  bow: /* i18n */ { id: 'viewer.callout.window.bow', message: 'Bow window' },
  louvered: /* i18n */ { id: 'viewer.callout.window.louvered', message: 'Louvered window' },
}

const OPENING: MessageDescriptor = /* i18n */ { id: 'viewer.callout.opening', message: 'Opening' }
const DOOR: MessageDescriptor = /* i18n */ { id: 'viewer.callout.door', message: 'Door' }
const WINDOW: MessageDescriptor = /* i18n */ { id: 'viewer.callout.window', message: 'Window' }
export const SHUTTERS: MessageDescriptor = /* i18n */ {
  id: 'viewer.walkthrough.shutters',
  message: 'Shutters',
}

function sentence(word: string): string {
  const spaced = word.replaceAll(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The line under the callout's name: what kind of thing it is ("Single-hung
 * window", "Sliding door"), or the catalog name when a person renamed the item.
 */
export function calloutSubtitle(node: AnyNode | undefined, title: string): CalloutText | null {
  if (!node) return null
  const raw = node as {
    type: string
    doorType?: string
    windowType?: string
    openingKind?: string
    source?: unknown
    asset?: { name?: string; category?: string }
  }
  let detail: CalloutText | null = null
  if (raw.type === 'door' || raw.type === 'window') {
    const word = raw.type === 'door' ? DOOR : WINDOW
    if (raw.openingKind === 'opening') detail = OPENING
    else if (raw.source) detail = word
    else if (raw.type === 'door') detail = DOOR_DETAIL[raw.doorType ?? 'hinged'] ?? word
    else detail = WINDOW_DETAIL[raw.windowType ?? 'fixed'] ?? word
  } else if (raw.type === 'item') {
    detail =
      raw.asset?.name && raw.asset.name !== title
        ? raw.asset.name
        : raw.asset?.category
          ? sentence(raw.asset.category)
          : null
  } else if (raw.type !== 'procedural-item') {
    detail = sentence(raw.type)
  }
  return detail && detail !== title ? detail : null
}

export const OPEN_SOUNDS = {
  door: { on: 'door-open', off: 'door-close' },
  window: { on: 'window-open', off: 'window-close' },
  garage: { on: 'garage', off: 'garage' },
  shutters: { on: 'shutters-open', off: 'shutters-close' },
  switch: { on: 'switch-on', off: 'switch-off' },
} as const satisfies Record<string, { on: InteractionSound; off: InteractionSound }>

/** The node fields that choose an opening's icon and sound. */
export type CalloutActionInput = { type: string; doorType?: string }

export function openingSound(node: CalloutActionInput) {
  if (node.type === 'window') return OPEN_SOUNDS.window
  return node.doorType?.startsWith('garage-') ? OPEN_SOUNDS.garage : OPEN_SOUNDS.door
}

/** A pill that flips one thing; without its own text it shows its state word. */
export function calloutToggle(
  key: string,
  icon: CalloutIcon,
  on: boolean,
  name: string,
  sound: { on: InteractionSound; off: InteractionSound },
  run: () => void,
  text?: CalloutText,
): CalloutAction {
  return { kind: 'toggle', key, icon, on, name, text, sound, toggle: run }
}

/**
 * A catalog or scripted object's own controls: its light switch, its `open`
 * clip, any other named toggle, and its sliders.
 */
export function interactiveActions(
  name: string,
  interactive: Interactive,
  values: readonly ControlValue[] | undefined,
  setValue: (index: number, value: ControlValue) => void,
  opening: CalloutActionInput = { type: 'item' },
): CalloutAction[] {
  const toggles = interactive.controls.flatMap((control, index) =>
    control.kind === 'toggle' ? [index] : [],
  )
  const light = interactive.effects.some((effect) => effect.kind === 'light') ? toggles[0] : -1
  const interaction = itemInteraction(interactive)
  const openControl = interaction.kind === 'open' ? interaction.control : -1
  const openIcon: CalloutIcon = opening.type === 'window' ? 'window' : 'door'
  return interactive.controls.map((control, index): CalloutAction => {
    const value = values?.[index]
    if (control.kind === 'toggle') {
      const on = Boolean(value)
      const flip = () => setValue(index, !on)
      if (index === light)
        return calloutToggle(String(index), 'light', on, name, OPEN_SOUNDS.switch, flip)
      if (index === openControl)
        return calloutToggle(String(index), openIcon, on, name, openingSound(opening), flip)
      const label = control.label
      return calloutToggle(
        String(index),
        label && /fan/i.test(label) ? 'fan' : 'power',
        on,
        label ?? name,
        OPEN_SOUNDS.switch,
        flip,
        label,
      )
    }
    return {
      kind: 'range',
      key: String(index),
      label: control.label,
      value: typeof value === 'number' ? value : control.min,
      min: control.min,
      max: control.max,
      step: control.kind === 'slider' ? control.step : 1,
      unit: control.kind === 'temperature' ? `°${control.unit}` : control.unit,
      onChange: (next) => setValue(index, next),
    }
  })
}

/** A procedural item's moving parts, each by its own name, then its lights. */
export function proceduralActions(
  nodeId: AnyNodeId,
  name: string,
  recipe: Pick<ProceduralItemNode['recipe'], 'parts' | 'joints'>,
  state: InteractiveState,
): CalloutAction[] {
  const procedural = state.procedural[nodeId]
  const actions = operableParts(recipe).map((part) => {
    const on = procedural?.parts[part.id] ?? part.kind === 'spin'
    return calloutToggle(
      part.id,
      part.kind === 'spin' ? 'fan' : 'door',
      on,
      part.label,
      part.kind === 'spin' ? OPEN_SOUNDS.switch : OPEN_SOUNDS.door,
      () => useInteractive.getState().toggleProceduralPart(nodeId, part.id),
      part.label,
    )
  })
  if (recipe.parts.some((part) => part.light))
    actions.push(
      calloutToggle(
        'lights',
        'light',
        procedural?.lightsOn ?? state.lampDefault,
        name,
        OPEN_SOUNDS.switch,
        () => useInteractive.getState().toggleProceduralLights(nodeId),
      ),
    )
  return actions
}

/** A built-in door's or window's leaf, then its parts (a window's shutters). */
function mechanismActions(node: AnyNode, name: string, state: InteractiveState): CalloutAction[] {
  const actions: CalloutAction[] = []
  const mechanism = nodeMechanism(node)
  if (mechanism?.icon)
    actions.push(
      calloutToggle(
        'mechanism',
        mechanism.icon,
        mechanism.isOn(node, state),
        name,
        openingSound(node as CalloutActionInput),
        () => toggleMechanism(mechanism, node),
      ),
    )
  for (const part of nodeMechanismParts(node)) {
    const on = part.isOn(node, state)
    actions.push(
      calloutToggle(
        part.id,
        part.icon === 'shutters' ? 'shutters' : 'power',
        on,
        name,
        part.icon === 'shutters' ? OPEN_SOUNDS.shutters : OPEN_SOUNDS.switch,
        () => toggleMechanismPart(part, node),
        part.icon === 'shutters' ? SHUTTERS : part.label,
      ),
    )
  }
  return actions
}

/** Everything a live scene node can do, for the parametric viewer's callout. */
export function nodeCalloutActions(
  node: AnyNode,
  name: string,
  state: InteractiveState,
): CalloutAction[] {
  const setValue = (index: number, value: ControlValue) =>
    useInteractive.getState().setControlValue(node.id, index, value)
  if (isScriptedNode(node)) {
    const interactive = scriptedInteractive(node)
    return interactive
      ? interactiveActions(
          name,
          interactive,
          state.items[node.id]?.controlValues,
          setValue,
          node as { type: string },
        )
      : []
  }
  if (node.type === 'item' && node.asset.interactive)
    return interactiveActions(
      name,
      node.asset.interactive,
      state.items[node.id]?.controlValues,
      setValue,
    )
  if (node.type === 'procedural-item') return proceduralActions(node.id, name, node.recipe, state)
  return mechanismActions(node, name, state)
}
