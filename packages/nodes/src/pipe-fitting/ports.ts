import type { NodePort } from '@pascal-app/core'
import { Euler, Vector3 } from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import type { PipeFittingNode } from './schema'

/** Hub stub length in meters — pipe fittings are stubbier than duct
 *  fittings (a 2" wye hub is ~7 cm to the collar). */
export function pipeFittingLegLength(diameterInches: number): number {
  const radius = (diameterInches * INCHES_TO_METERS) / 2
  return Math.max(0.07, radius * 2.2)
}

/** Wye branch angle — DWV wyes enter at 45°. */
export const WYE_BRANCH_RAD = Math.PI / 4

type LocalPort = { id: string; position: Vector3; direction: Vector3; diameter: number }

/**
 * Ports in the fitting's LOCAL frame (origin at the junction, before
 * `position`/`rotation`). Conventions documented on the schema: elbow
 * inlet -X / outlet at `angle`° in XZ; wye run along X with the branch
 * at 45° between +X and +Z; sanitary tee run along X, branch +Z; cross
 * run along X, two opposed branches on ±Z.
 */
export function localPipeFittingPorts(node: PipeFittingNode): LocalPort[] {
  const run = pipeFittingLegLength(node.diameter)
  const inlet: LocalPort = {
    id: 'inlet',
    position: new Vector3(-run, 0, 0),
    direction: new Vector3(-1, 0, 0),
    diameter: node.diameter,
  }
  if (node.fittingType === 'elbow') {
    const theta = (node.angle * Math.PI) / 180
    const outDir = new Vector3(Math.cos(theta), 0, Math.sin(theta))
    return [
      inlet,
      {
        id: 'outlet',
        position: outDir.clone().multiplyScalar(run),
        direction: outDir,
        diameter: node.diameter,
      },
    ]
  }
  const outlet: LocalPort = {
    id: 'outlet',
    position: new Vector3(run, 0, 0),
    direction: new Vector3(1, 0, 0),
    diameter: node.diameter,
  }
  const branchLeg = pipeFittingLegLength(node.diameter2)
  if (node.fittingType === 'cross') {
    return [
      inlet,
      outlet,
      {
        id: 'branch',
        position: new Vector3(0, 0, branchLeg),
        direction: new Vector3(0, 0, 1),
        diameter: node.diameter2,
      },
      {
        id: 'branch2',
        position: new Vector3(0, 0, -branchLeg),
        direction: new Vector3(0, 0, -1),
        diameter: node.diameter2,
      },
    ]
  }
  const branchDir =
    node.fittingType === 'wye'
      ? new Vector3(Math.cos(WYE_BRANCH_RAD), 0, Math.sin(WYE_BRANCH_RAD))
      : new Vector3(0, 0, 1)
  return [
    inlet,
    outlet,
    {
      id: 'branch',
      position: branchDir.clone().multiplyScalar(branchLeg),
      direction: branchDir,
      diameter: node.diameter2,
    },
  ]
}

/** `def.ports` — local ports transformed into level-local space. */
export function getPipeFittingPorts(node: PipeFittingNode): NodePort[] {
  const euler = new Euler(node.rotation[0], node.rotation[1], node.rotation[2])
  const offset = new Vector3(node.position[0], node.position[1], node.position[2])
  return localPipeFittingPorts(node).map((port) => {
    const position = port.position.clone().applyEuler(euler).add(offset)
    const direction = port.direction.clone().applyEuler(euler).normalize()
    return {
      id: port.id,
      position: [position.x, position.y, position.z] as const,
      direction: [direction.x, direction.y, direction.z] as const,
      diameter: port.diameter,
      system: node.system,
    }
  })
}
