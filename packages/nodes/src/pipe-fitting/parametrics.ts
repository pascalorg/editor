import type { AnyNode, AnyNodeId, ParametricDescriptor, PipeSegmentNode } from '@pascal-app/core'
import { getPipeFittingPorts } from './ports'
import type { PipeFittingNode } from './schema'

/** A pipe endpoint sitting this close to a fitting hub counts as mated. */
const MATE_TOL_M = 0.05

type Point = [number, number, number]
type PipeMate = { pipe: PipeSegmentNode; endIndex: number }

function matedPipes(
  fitting: PipeFittingNode,
  nodes: Record<AnyNodeId, AnyNode>,
): Map<string, PipeMate> {
  const mates = new Map<string, PipeMate>()
  const ports = getPipeFittingPorts(fitting)
  for (const node of Object.values(nodes)) {
    if (node.type !== 'pipe-segment') continue
    const pipe = node as PipeSegmentNode
    for (const endIndex of [0, pipe.path.length - 1]) {
      const p = pipe.path[endIndex]
      if (!p) continue
      for (const port of ports) {
        if (mates.has(port.id)) continue
        const dx = p[0] - port.position[0]
        const dy = p[1] - port.position[1]
        const dz = p[2] - port.position[2]
        if (dx * dx + dy * dy + dz * dz <= MATE_TOL_M * MATE_TOL_M) {
          mates.set(port.id, { pipe, endIndex })
        }
      }
    }
  }
  return mates
}

export const pipeFittingParametrics: ParametricDescriptor<PipeFittingNode> = {
  // Deleting an auto-inserted DWV bend restores the corner it replaced.
  // The connected pipe endpoints were pulled back onto the bend collars;
  // send those endpoints back to the junction so the L-shape regains its
  // original length.
  onDelete: (fitting, nodes) => {
    if (fitting.fittingType !== 'elbow') return []
    const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
    for (const mate of matedPipes(fitting, nodes).values()) {
      const end = mate.pipe.path[mate.endIndex]
      if (!end) continue
      const target = fitting.position
      const dx = end[0] - target[0]
      const dy = end[1] - target[1]
      const dz = end[2] - target[2]
      if (dx * dx + dy * dy + dz * dz < 1e-12) continue
      const path = mate.pipe.path.map((p) => [...p] as Point)
      path[mate.endIndex] = [...target]
      updates.push({ id: mate.pipe.id, data: { path } as Partial<PipeSegmentNode> })
    }
    return updates
  },

  groups: [
    {
      label: 'Fitting',
      fields: [
        {
          key: 'fittingType',
          kind: 'enum',
          options: ['elbow', 'wye', 'sanitary-tee', 'cross'],
          display: 'segmented',
        },
        {
          key: 'angle',
          kind: 'number',
          unit: '°',
          min: 0,
          max: 90,
          step: 7.5,
          visibleIf: (n) => n.fittingType === 'elbow',
        },
        {
          key: 'system',
          kind: 'enum',
          options: ['waste', 'vent'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Connections',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'in', min: 1.25, max: 6, step: 0.25 },
        {
          key: 'diameter2',
          kind: 'number',
          unit: 'in',
          min: 1.25,
          max: 6,
          step: 0.25,
          visibleIf: (n) => n.fittingType !== 'elbow',
        },
        { key: 'pipeMaterial', kind: 'enum', options: ['pvc', 'abs', 'cast-iron'] },
      ],
    },
    {
      label: 'Placement',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],
}
