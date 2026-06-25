import type { NodePort } from '@pascal-app/core'
import { Euler, Vector3 } from 'three'
import type { DuctFittingNode } from './schema'

const INCHES_TO_METERS = 0.0254

/**
 * Collar stub length in meters — how far each port sticks out from the
 * fitting's junction center. Scales with the duct so big trunks get
 * proportionally longer collars, with a floor so 4" fittings stay
 * grabbable.
 */
export function fittingLegLength(diameterInches: number): number {
  const radius = (diameterInches * INCHES_TO_METERS) / 2
  return Math.max(0.14, radius * 2.5)
}

type LocalPort = { id: string; position: Vector3; direction: Vector3; diameter: number }

/**
 * Ports in the fitting's LOCAL frame (origin at the junction center,
 * before `position`/`rotation`). Shared by `def.ports` (which transforms
 * them to level-local) and the geometry builder (which draws a stub per
 * port).
 *
 * Conventions documented on the schema: elbow inlet -X / outlet turned
 * `angle`° in XZ; tee run along X with the branch at `branchAngle`° off
 * the +X outlet axis (90° → +Z square tee, 45° → downstream lateral,
 * 135° → upstream lateral); reducer -X → +X.
 */
export function localFittingPorts(node: DuctFittingNode): LocalPort[] {
  const main = fittingLegLength(node.diameter)
  if (node.fittingType === 'elbow') {
    const theta = (node.angle * Math.PI) / 180
    const outDir = new Vector3(Math.cos(theta), 0, Math.sin(theta))
    return [
      {
        id: 'inlet',
        position: new Vector3(-main, 0, 0),
        direction: new Vector3(-1, 0, 0),
        diameter: node.diameter,
      },
      {
        id: 'outlet',
        position: outDir.clone().multiplyScalar(main),
        direction: outDir,
        diameter: node.diameter,
      },
    ]
  }
  if (node.fittingType === 'tee') {
    const branch = fittingLegLength(node.diameter2)
    // Branch leans `branchAngle`° off the +X outlet axis in XZ: 90° is a
    // square tap (+Z), shallower angles sweep the branch downstream
    // toward the outlet so the lateral merges with the run's flow, and
    // angles past 90° lean it upstream toward the inlet (cos goes
    // negative, swinging the collar to -X).
    const phi = (node.branchAngle * Math.PI) / 180
    const branchDir = new Vector3(Math.cos(phi), 0, Math.sin(phi))
    return [
      {
        id: 'inlet',
        position: new Vector3(-main, 0, 0),
        direction: new Vector3(-1, 0, 0),
        diameter: node.diameter,
      },
      {
        id: 'outlet',
        position: new Vector3(main, 0, 0),
        direction: new Vector3(1, 0, 0),
        diameter: node.diameter,
      },
      {
        id: 'branch',
        position: branchDir.clone().multiplyScalar(branch),
        direction: branchDir,
        diameter: node.diameter2,
      },
    ]
  }
  if (node.fittingType === 'cross') {
    // Four-way junction: run inlet -X / outlet +X at the run profile,
    // two opposed branches square to the run along ±Z at the branch
    // profile. Both branches share `diameter2` (one drawn run passes
    // straight through, so its two halves are the same size).
    const branch = fittingLegLength(node.diameter2)
    return [
      {
        id: 'inlet',
        position: new Vector3(-main, 0, 0),
        direction: new Vector3(-1, 0, 0),
        diameter: node.diameter,
      },
      {
        id: 'outlet',
        position: new Vector3(main, 0, 0),
        direction: new Vector3(1, 0, 0),
        diameter: node.diameter,
      },
      {
        id: 'branch',
        position: new Vector3(0, 0, branch),
        direction: new Vector3(0, 0, 1),
        diameter: node.diameter2,
      },
      {
        id: 'branch2',
        position: new Vector3(0, 0, -branch),
        direction: new Vector3(0, 0, -1),
        diameter: node.diameter2,
      },
    ]
  }
  // reducer / transition: straight-through, inlet at `diameter` (the
  // transition's rect end advertises its area-equivalent round size),
  // outlet at `diameter2`.
  return [
    {
      id: 'inlet',
      position: new Vector3(-main, 0, 0),
      direction: new Vector3(-1, 0, 0),
      diameter: node.diameter,
    },
    {
      id: 'outlet',
      position: new Vector3(main, 0, 0),
      direction: new Vector3(1, 0, 0),
      diameter: node.diameter2,
    },
  ]
}

/** `def.ports` — local ports transformed into level-local space. */
export function getDuctFittingPorts(node: DuctFittingNode): NodePort[] {
  const euler = new Euler(node.rotation[0], node.rotation[1], node.rotation[2])
  const offset = new Vector3(node.position[0], node.position[1], node.position[2])
  return localFittingPorts(node).map((port) => {
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
