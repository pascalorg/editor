import { type AnyNode, type Interactive, useInteractive } from '@pascal-app/core'

type InteractiveState = ReturnType<typeof useInteractive.getState>

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

export function itemHasMechanisms(node: AnyNode | undefined): boolean {
  if (node?.type === 'procedural-item') return motionPartIds(node).length > 0
  if (node?.type === 'item' && node.asset.interactive)
    return catalogToggles(node.asset.interactive).mechanisms.length > 0
  return false
}

export function itemHasLights(node: AnyNode | undefined): boolean {
  if (node?.type === 'procedural-item') return node.recipe.parts.some((part) => part.light)
  if (node?.type === 'item' && node.asset.interactive)
    return catalogToggles(node.asset.interactive).light >= 0
  return false
}

export function itemMechanismsOn(node: AnyNode, state: InteractiveState): boolean {
  if (node.type === 'procedural-item')
    return motionPartIds(node).some((partId) => state.procedural[node.id]?.parts[partId])
  if (node.type === 'item' && node.asset.interactive) {
    const values = state.items[node.id]?.controlValues
    return catalogToggles(node.asset.interactive).mechanisms.some((index) =>
      Boolean(values?.[index]),
    )
  }
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

/** Any mechanism running → stop them all, else start them all. */
export function toggleItemMechanisms(node: AnyNode) {
  const state = useInteractive.getState()
  const on = !itemMechanismsOn(node, state)
  if (node.type === 'procedural-item') {
    state.setProceduralParts(node.id, motionPartIds(node), on)
    return
  }
  if (node.type !== 'item' || !node.asset.interactive) return
  state.initItem(node.id, node.asset.interactive)
  for (const index of catalogToggles(node.asset.interactive).mechanisms)
    state.setControlValue(node.id, index, on)
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
