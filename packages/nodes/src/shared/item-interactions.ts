import {
  type AnyNode,
  type Interactive,
  type InteractiveState,
  type MechanismCapability,
  useInteractive,
} from '@pascal-app/core'

// Catalog light and animation effects both read the first toggle, so on a lamp
// that toggle is the light switch and any further toggles are the mechanisms.
function catalogToggles(interactive: Interactive) {
  const toggles = interactive.controls.flatMap((control, index) =>
    control.kind === 'toggle' ? [index] : [],
  )
  const light = interactive.effects.some((effect) => effect.kind === 'light')
    ? (toggles[0] ?? -1)
    : -1
  const mechanisms = interactive.effects.some((effect) => effect.kind === 'animation')
    ? toggles.filter((index) => index !== light)
    : []
  return { light, mechanisms }
}

function motionPartIds(node: AnyNode) {
  return node.type === 'procedural-item'
    ? node.recipe.parts.filter((part) => part.motion).map((part) => part.id)
    : []
}

function mechanismToggles(node: AnyNode) {
  return node.type === 'item' && node.asset.interactive
    ? catalogToggles(node.asset.interactive).mechanisms
    : []
}

/** A catalog item's animation toggles: every toggle but the light switch. */
export const itemMechanism: MechanismCapability = {
  has: (node) => mechanismToggles(node).length > 0,
  isOn: (node, state) => {
    const values = state.items[node.id]?.controlValues
    return mechanismToggles(node).some((index) => Boolean(values?.[index]))
  },
  set: (node, on) => {
    if (node.type !== 'item' || !node.asset.interactive) return
    const state = useInteractive.getState()
    state.initItem(node.id, node.asset.interactive)
    for (const index of mechanismToggles(node)) state.setControlValue(node.id, index, on)
  },
}

/** A procedural item's moving parts, all driven through its motion timeline. */
export const proceduralMechanism: MechanismCapability = {
  has: (node) => motionPartIds(node).length > 0,
  isOn: (node, state) =>
    motionPartIds(node).some((partId) => state.procedural[node.id]?.parts[partId]),
  set: (node, on) => useInteractive.getState().setProceduralParts(node.id, motionPartIds(node), on),
}

export function itemHasLights(node: AnyNode | undefined): boolean {
  if (node?.type === 'procedural-item') return node.recipe.parts.some((part) => part.light)
  if (node?.type === 'item' && node.asset.interactive)
    return catalogToggles(node.asset.interactive).light >= 0
  return false
}

export function itemLightsOn(node: AnyNode, state: InteractiveState): boolean {
  if (node.type === 'procedural-item')
    return state.procedural[node.id]?.lightsOn ?? state.lampDefault
  if (node.type === 'item' && node.asset.interactive) {
    const { light } = catalogToggles(node.asset.interactive)
    return light >= 0 && Boolean(state.items[node.id]?.controlValues[light])
  }
  return false
}

export function toggleItemLights(node: AnyNode) {
  const state = useInteractive.getState()
  if (node.type === 'procedural-item') {
    state.toggleProceduralLights(node.id)
    return
  }
  if (node.type !== 'item' || !node.asset.interactive) return
  const { light } = catalogToggles(node.asset.interactive)
  if (light < 0) return
  state.initItem(node.id, node.asset.interactive)
  state.setControlValue(node.id, light, !itemLightsOn(node, useInteractive.getState()))
}
