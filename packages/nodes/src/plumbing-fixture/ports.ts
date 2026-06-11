import type { NodePort } from '@pascal-app/core'
import { Vector3 } from 'three'
import type { PlumbingFixtureNode } from './schema'
import { FIXTURE_SPECS } from './spec'

/**
 * `def.ports` — the fixture's single waste rough-in, level-local. The
 * direction points DOWN: drains leave a fixture through the floor, so a
 * run drawn from the port starts by dropping (or the planner mints a
 * bend when it turns horizontal).
 */
export function getPlumbingFixturePorts(node: PlumbingFixtureNode): NodePort[] {
  const spec = FIXTURE_SPECS[node.fixtureType]
  const local = new Vector3(...spec.drainLocal)
  const position = local
    .applyAxisAngle(new Vector3(0, 1, 0), node.rotation)
    .add(new Vector3(node.position[0], node.position[1], node.position[2]))
  return [
    {
      id: 'drain',
      position: [position.x, position.y, position.z] as const,
      direction: [0, -1, 0] as const,
      diameter: spec.drainIn,
      system: 'waste',
    },
  ]
}
