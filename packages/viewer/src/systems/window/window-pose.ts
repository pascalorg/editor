import { openingExteriorFace, openingHostFacing, useScene, type WindowNode } from '@pascal-app/core'
import type { Object3D } from 'three'

export const WINDOW_LEFT_SHUTTER_NAME = 'shutter-left'
export const WINDOW_RIGHT_SHUTTER_NAME = 'shutter-right'
export const WINDOW_SHUTTER_OUTER_NAME = 'shutter-outer'

export const CASEMENT_WINDOW_SASH_NAME = 'casement-window-sash'
export const FRENCH_CASEMENT_LEFT_SASH_NAME = 'french-casement-left-sash'
export const FRENCH_CASEMENT_RIGHT_SASH_NAME = 'french-casement-right-sash'
export const SLIDING_WINDOW_ACTIVE_PANEL_NAME = 'sliding-window-active-panel'
export const SINGLE_HUNG_ACTIVE_SASH_NAME = 'single-hung-active-sash'
export const DOUBLE_HUNG_TOP_SASH_NAME = 'double-hung-top-sash'
export const DOUBLE_HUNG_BOTTOM_SASH_NAME = 'double-hung-bottom-sash'
export const LOUVERED_WINDOW_SLATS_NAME = 'louvered-window-slats'
export const AWNING_WINDOW_SASH_NAME = 'awning-window-sash'
export const HOPPER_WINDOW_SASH_NAME = 'hopper-window-sash'

export const TILT_TURN_WINDOW_SASH_NAME = 'tilt-turn-window-sash'

/** Cached in the built subtree so detached export clones keep the host's exterior direction. */
export function windowExteriorSign(node: WindowNode, mesh?: Object3D): number {
  if (typeof mesh?.userData.windowExteriorSign === 'number') return mesh.userData.windowExteriorSign
  const face = openingExteriorFace(node, useScene.getState().nodes)
  return (face === 'a' ? 1 : -1) * openingHostFacing(node)
}

/** Leaves start along the wall in local X; bifolds stack perpendicular to it when open. */
export function poseWindowShutters(
  node: WindowNode,
  mesh: Object3D | undefined,
  value: number,
): boolean {
  const exterior = windowExteriorSign(node, mesh)
  let found = false
  for (const [name, side] of [
    [WINDOW_LEFT_SHUTTER_NAME, -1],
    [WINDOW_RIGHT_SHUTTER_NAME, 1],
  ] as const) {
    const leaf = mesh?.getObjectByName(name)
    if (!leaf) continue
    // Export clones can decompose a half-turn into nonzero X/Z Euler angles.
    const outer = leaf.getObjectByName(WINDOW_SHUTTER_OUTER_NAME)
    const swing = value * (outer ? Math.PI / 2 : Math.PI)
    leaf.rotation.set(0, -side * exterior * (Math.PI - swing), 0)
    if (outer) outer.rotation.set(0, -side * exterior * 2 * swing, 0)
    found = true
  }
  return found
}

/**
 * Pose a window's moving parts (sash/panel/slats) at `value` (0 = closed,
 * 1 = open) by mutating the named child groups under `mesh`. Returns true when
 * the window type has a direct pose path and the named parts were found.
 *
 * This is the single source of truth for window kinematics: the live animation
 * system poses the registered scene mesh, and the GLB exporter poses an export
 * clone to sample the open/close keyframes for a baked animation clip.
 */
export function poseWindowMovingParts(
  node: WindowNode,
  mesh: Object3D | undefined,
  value: number,
  shutterOpen: number = node.shutterOpen ?? 1,
): boolean {
  poseWindowShutters(node, mesh, shutterOpen)
  if (node.windowType === 'sliding') {
    const activePanel = mesh?.getObjectByName(SLIDING_WINDOW_ACTIVE_PANEL_NAME)
    if (!activePanel) return false

    const innerW = node.width - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerW * 0.12)
    const travel = Math.max(innerW / 2 - panelOverlap, 0) * value
    activePanel.position.x = -innerW / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'single-hung') {
    const activeSash = mesh?.getObjectByName(SINGLE_HUNG_ACTIVE_SASH_NAME)
    if (!activeSash) return false

    const innerH = node.height - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerH * 0.12)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * value
    activeSash.position.y = -innerH / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'double-hung') {
    const topSash = mesh?.getObjectByName(DOUBLE_HUNG_TOP_SASH_NAME)
    const bottomSash = mesh?.getObjectByName(DOUBLE_HUNG_BOTTOM_SASH_NAME)
    if (!(topSash && bottomSash)) return false

    const innerH = node.height - 2 * node.frameThickness
    const panelOverlap = Math.min(Math.max(node.frameThickness * 0.9, 0.04), innerH * 0.12)
    const travel = Math.max(innerH / 2 - panelOverlap, 0) * value
    topSash.position.y = innerH / 4 + panelOverlap / 4 - travel
    bottomSash.position.y = -innerH / 4 - panelOverlap / 4 + travel
    return true
  }

  if (node.windowType === 'louvered') {
    const slats = mesh?.getObjectByName(LOUVERED_WINDOW_SLATS_NAME)
    if (!slats) return false

    const slatAngle = -value * (Math.PI / 3)
    for (const slat of slats.children) {
      slat.rotation.x = slatAngle
    }
    return true
  }

  const exterior = windowExteriorSign(node, mesh)
  if (node.windowType === 'tilt-turn') {
    const sash = mesh?.getObjectByName(TILT_TURN_WINDOW_SASH_NAME)
    if (!sash) return false
    sash.rotation.set(0, 0, 0)
    if (node.tiltTurnMode === 'turn') {
      sash.rotation.y = ((node.hingesSide === 'right' ? -1 : 1) * exterior * value * Math.PI) / 2
    } else {
      sash.rotation.x = (-exterior * value * Math.PI) / 12
    }
    return true
  }
  const direction =
    node.openingDirection === undefined
      ? 1
      : exterior * (node.openingDirection === 'inward' ? -1 : 1)
  if (node.windowType === 'casement') {
    if ((node.casementStyle ?? 'single') === 'french') {
      const leftSash = mesh?.getObjectByName(FRENCH_CASEMENT_LEFT_SASH_NAME)
      const rightSash = mesh?.getObjectByName(FRENCH_CASEMENT_RIGHT_SASH_NAME)
      if (!(leftSash && rightSash)) return false

      leftSash.rotation.y = -direction * value * (Math.PI / 2)
      rightSash.rotation.y = direction * value * (Math.PI / 2)
      return true
    }

    const sash = mesh?.getObjectByName(CASEMENT_WINDOW_SASH_NAME)
    if (!sash) return false

    const hingeSign = (node.hingesSide ?? 'left') === 'left' ? -1 : 1
    sash.rotation.y = direction * hingeSign * value * (Math.PI / 2)
    return true
  }

  if (node.windowType === 'awning') {
    const sash = mesh?.getObjectByName(AWNING_WINDOW_SASH_NAME)
    if (!sash) return false

    sash.rotation.x =
      (node.openingDirection === undefined
        ? -1
        : (node.awningDirection === 'down' ? 1 : -1) * direction) *
      value *
      (Math.PI / 3)
    return true
  }

  if (node.windowType === 'hopper') {
    const sash =
      mesh?.getObjectByName(AWNING_WINDOW_SASH_NAME) ??
      mesh?.getObjectByName(HOPPER_WINDOW_SASH_NAME)
    if (!sash) return false

    sash.rotation.x = -exterior * value * (Math.PI / 3)
    return true
  }

  return false
}
