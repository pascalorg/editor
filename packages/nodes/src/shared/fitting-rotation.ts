import { type AnyNode, useScene } from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { Euler, Quaternion, Vector3 } from 'three'
import type { DuctFittingNode } from '../duct-fitting/schema'

/** R/T rotation step — 45°, matching the editor's default rotate. */
export const ROTATE_STEP_RAD = Math.PI / 4

export type RotationAxis = 'x' | 'y' | 'z'

export const AXIS_VECTORS: Record<RotationAxis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

// The active axis lives on `useEditor` (not a module store) so the
// floating action menu — which can't import this package — surfaces it
// in the pill above a selected fitting. Tool + keyboard actions share
// the same state, so Alt-cycling in either context drives both.
export const getRotationAxis = (): RotationAxis => useEditor.getState().rotationAxis
export const cycleRotationAxis = (): RotationAxis => useEditor.getState().cycleRotationAxis()

/**
 * Compose a world-frame rotation around `axis` onto an existing euler.
 * World-frame (premultiply) so the axes the user cycles through always
 * mean the screen-space X/Y/Z they expect, regardless of how the fitting
 * is already turned.
 */
export function rotateEulerWorld(
  rotation: readonly [number, number, number],
  axis: RotationAxis,
  steps: 1 | -1,
): [number, number, number] {
  const current = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2]))
  const turn = new Quaternion().setFromAxisAngle(AXIS_VECTORS[axis], steps * ROTATE_STEP_RAD)
  const euler = new Euler().setFromQuaternion(turn.multiply(current))
  return [euler.x, euler.y, euler.z]
}

/**
 * R / T keyboard action for a placed fitting — rotate ±45° around the
 * shared active axis (Alt cycles it; see `selection.tsx`).
 */
export function rotateFittingNode(node: AnyNode, steps: 1 | -1): void {
  const fitting = node as DuctFittingNode
  useScene.getState().updateNode(fitting.id, {
    rotation: rotateEulerWorld(fitting.rotation, getRotationAxis(), steps),
  })
  triggerSFX('sfx:item-rotate')
}
