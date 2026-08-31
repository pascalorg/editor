import { Group, Mesh, SphereGeometry, Vector3 } from 'three'
import { buildSection, INCHES_TO_METERS } from '../duct-segment/geometry'
import { createPipeMaterial } from '../pipe-segment/geometry'
import { localPipeFittingPorts } from './ports'
import type { PipeFittingNode } from './schema'

const RADIAL_SEGMENTS = 20

/**
 * Pure geometry builder for a DWV fitting, in the node's LOCAL frame.
 * One cylinder stub per port from the junction outward, an oversized
 * hub sphere at the junction, and a smaller hub at each collar opening
 * (solvent-weld couplings). Wyes read correctly because their branch
 * stub leaves at 45° — the port layout does the work.
 */
export function buildPipeFittingGeometry(node: PipeFittingNode): Group {
  const group = new Group()
  const material = createPipeMaterial(node)
  const radiusRun = (node.diameter * INCHES_TO_METERS) / 2

  for (const port of localPipeFittingPorts(node)) {
    const radius = (port.diameter * INCHES_TO_METERS) / 2
    const stub = buildSection(
      new Vector3(0, 0, 0),
      port.position,
      radius,
      material,
      `pipe-fitting-stub-${port.id}`,
    )
    if (stub) group.add(stub)
    const hub = new Mesh(new SphereGeometry(radius * 1.18, RADIAL_SEGMENTS, 12), material)
    hub.name = `pipe-fitting-hub-${port.id}`
    hub.position.copy(port.position)
    group.add(hub)
  }

  const junction = new Mesh(new SphereGeometry(radiusRun * 1.18, RADIAL_SEGMENTS, 12), material)
  junction.name = 'pipe-fitting-junction'
  group.add(junction)

  return group
}
