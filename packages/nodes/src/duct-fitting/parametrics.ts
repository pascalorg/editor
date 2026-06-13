import {
  type AnyNode,
  type AnyNodeId,
  type DuctSegmentNode,
  type ParametricDescriptor,
  useScene,
} from '@pascal-app/core'
import { Vector3 } from 'three'
import {
  ductPortDiameterIn,
  equivalentDiameterIn,
  ovalEquivalentDiameterIn,
  rollToContinueAcrossElbow,
} from '../duct-segment/geometry'
import { getDuctFittingPorts } from './ports'
import type { DuctFittingNode } from './schema'

/** Schema bounds for `diameter` / `diameter2`. */
const clampDiameter = (d: number) => Math.min(48, Math.max(2, d))

/** A duct endpoint sitting this close to a collar counts as mated. */
const MATE_TOL_M = 0.03

type DuctMate = { duct: DuctSegmentNode; endIndex: number }

/**
 * Ducts whose endpoint sits ON one of the fitting's collars, keyed by
 * port id. Auto-minted joints place duct ends exactly on the collar, so
 * a tight distance check is enough — no connectivity graph yet.
 */
function matedDucts(fitting: DuctFittingNode): Map<string, DuctMate> {
  const mates = new Map<string, DuctMate>()
  const ports = getDuctFittingPorts(fitting)
  for (const node of Object.values(useScene.getState().nodes)) {
    if (node.type !== 'duct-segment') continue
    const duct = node as DuctSegmentNode
    for (const endIndex of [0, duct.path.length - 1]) {
      const p = duct.path[endIndex]
      if (!p) continue
      for (const port of ports) {
        if (mates.has(port.id)) continue
        const dx = p[0] - port.position[0]
        const dy = p[1] - port.position[1]
        const dz = p[2] - port.position[2]
        if (dx * dx + dy * dy + dz * dz <= MATE_TOL_M * MATE_TOL_M) {
          mates.set(port.id, { duct, endIndex })
        }
      }
    }
  }
  return mates
}

export const ductFittingParametrics: ParametricDescriptor<DuctFittingNode> = {
  // Switching the run legs round↔rect flips the whole fitting and sizes
  // the new profile off the ducts actually mated to its collars, so the
  // fitting lands flush instead of at schema defaults. The tee branch
  // follows its own mated duct (or the run shape when nothing is mated);
  // `shape2` stays editable afterwards for mixed taps. Rect profiles
  // also write their area-equivalent round size back into `diameter` /
  // `diameter2`, which drive leg lengths + advertised ports — without
  // this the legs keep the stale round size.
  derive: (next, patch) => {
    const out: Partial<DuctFittingNode> = {}
    if ('shape' in patch && next.fittingType !== 'reducer') {
      // `next` still carries the pre-edit diameters, so its ports sit
      // where the mated ducts end — size off the actual neighbours.
      const mates = matedDucts(next)
      const run = (mates.get('inlet') ?? mates.get('outlet'))?.duct
      if (next.shape !== 'round' && run?.shape === next.shape) {
        out.width = run.width
        out.height = run.height
      } else if (next.shape === 'round' && run && run.shape !== 'rect') {
        // Oval runs present their area-equivalent round size.
        out.diameter = clampDiameter(ductPortDiameterIn(run))
      }
      if (next.fittingType === 'tee') {
        const branchDuct = mates.get('branch')?.duct
        out.shape2 = branchDuct?.shape ?? next.shape
        if (branchDuct && branchDuct.shape !== 'round') {
          out.width2 = branchDuct.width
          out.height2 = branchDuct.height
        } else if (branchDuct) {
          out.diameter2 = clampDiameter(ductPortDiameterIn(branchDuct))
        }
      }
    }
    // Non-round legs write their area-equivalent round size back into the
    // diameters (leg lengths + advertised ports). A transition's inlet is
    // always the rect end regardless of `shape`.
    const runShape = next.fittingType === 'transition' ? 'rect' : next.shape
    if (runShape !== 'round' && next.fittingType !== 'reducer') {
      const equivalent = runShape === 'oval' ? ovalEquivalentDiameterIn : equivalentDiameterIn
      out.diameter = clampDiameter(equivalent(out.width ?? next.width, out.height ?? next.height))
    }
    const shape2 = out.shape2 ?? next.shape2
    if (next.fittingType === 'tee' && shape2 !== 'round') {
      const equivalent2 = shape2 === 'oval' ? ovalEquivalentDiameterIn : equivalentDiameterIn
      out.diameter2 = clampDiameter(
        equivalent2(out.width2 ?? next.width2, out.height2 ?? next.height2),
      )
    }
    return out
  },

  // Resizing a fitting moves its collars (leg lengths follow the
  // diameters) — re-trim each mated duct's endpoint onto the collar's
  // new position so metal keeps meeting metal instead of overlapping
  // one neighbour and gapping off another.
  reconcile: (prev, next) => {
    const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
    const newPorts = new Map(getDuctFittingPorts(next).map((p) => [p.id, p]))
    const mates = matedDucts(prev)
    for (const [portId, mate] of mates) {
      const target = newPorts.get(portId)
      if (!target) continue
      const end = mate.duct.path[mate.endIndex]
      if (!end) continue
      const data: Partial<DuctSegmentNode> = {}
      const dx = end[0] - target.position[0]
      const dy = end[1] - target.position[1]
      const dz = end[2] - target.position[2]
      if (dx * dx + dy * dy + dz * dz >= 1e-12) {
        const path = mate.duct.path.map((p) => [...p] as [number, number, number])
        path[mate.endIndex] = [...target.position]
        data.path = path
      }
      // Steep rect / oval runs also re-derive their cross-section roll
      // so a riser's profile stays continuous through the fitting (same
      // continuity the draw tool computes; runs flipped to rect after
      // drawing never got it). Horizontal runs are left alone — their
      // roll-0 orientation is canonical and re-deriving it from a
      // possibly-stale riser roll would corrupt it.
      if (next.shape !== 'round' && mate.duct.shape !== 'round') {
        const away = mate.duct.path[mate.endIndex === 0 ? 1 : mate.duct.path.length - 2]
        const source = getDuctFittingPorts(next).find((p) => p.id !== portId && p.id !== 'branch')
        if (away && source) {
          const newDir = new Vector3(away[0] - end[0], away[1] - end[1], away[2] - end[2])
          if (newDir.lengthSq() >= 1e-10) {
            newDir.normalize()
            if (Math.abs(newDir.y) >= Math.SQRT1_2) {
              const srcMate = mates.get(source.id)
              const srcRoll = srcMate && srcMate.duct.shape !== 'round' ? srcMate.duct.roll : 0
              const srcDir = new Vector3(...source.direction)
              const roll = rollToContinueAcrossElbow(srcDir, srcRoll, srcDir, newDir)
              if (Math.abs(roll - mate.duct.roll) > 1e-6) data.roll = roll
            }
          }
        }
      }
      if (Object.keys(data).length > 0) updates.push({ id: mate.duct.id, data })
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
          options: ['elbow', 'tee', 'reducer', 'transition'],
          display: 'segmented',
        },
        {
          key: 'angle',
          kind: 'number',
          unit: '°',
          min: 15,
          max: 90,
          step: 15,
          visibleIf: (n) => n.fittingType === 'elbow',
        },
        {
          key: 'branchAngle',
          kind: 'number',
          unit: '°',
          min: 45,
          max: 135,
          step: 15,
          visibleIf: (n) => n.fittingType === 'tee',
        },
        {
          key: 'system',
          kind: 'enum',
          options: ['supply', 'return'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Connections',
      fields: [
        {
          key: 'shape',
          kind: 'enum',
          options: ['round', 'rect', 'oval'],
          display: 'segmented',
          // Reducers are always round; a transition's ends are fixed
          // (rect inlet, round outlet) so there's nothing to pick.
          visibleIf: (n) => n.fittingType !== 'reducer' && n.fittingType !== 'transition',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          // Hidden when the run legs are rect / oval (transition's inlet
          // always is) — `diameter` is then derived as the area equivalent.
          visibleIf: (n) =>
            n.fittingType === 'reducer' || (n.fittingType !== 'transition' && n.shape === 'round'),
        },
        {
          key: 'width',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 60,
          step: 1,
          visibleIf: (n) =>
            n.fittingType === 'transition' || (n.shape !== 'round' && n.fittingType !== 'reducer'),
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'in',
          min: 3,
          max: 40,
          step: 1,
          visibleIf: (n) =>
            n.fittingType === 'transition' || (n.shape !== 'round' && n.fittingType !== 'reducer'),
        },
        {
          key: 'shape2',
          kind: 'enum',
          options: ['round', 'rect', 'oval'],
          display: 'segmented',
          visibleIf: (n) => n.fittingType === 'tee',
        },
        {
          key: 'diameter2',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          visibleIf: (n) =>
            n.fittingType !== 'elbow' && (n.fittingType !== 'tee' || n.shape2 === 'round'),
        },
        {
          key: 'width2',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 60,
          step: 1,
          visibleIf: (n) => n.fittingType === 'tee' && n.shape2 !== 'round',
        },
        {
          key: 'height2',
          kind: 'number',
          unit: 'in',
          min: 3,
          max: 40,
          step: 1,
          visibleIf: (n) => n.fittingType === 'tee' && n.shape2 !== 'round',
        },
        {
          key: 'ductMaterial',
          kind: 'enum',
          options: ['sheet-metal', 'flex', 'duct-board'],
        },
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
