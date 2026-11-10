import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../../schema/base'
import type { AnyNode } from '../../schema/types'
import { registerNode } from '../registry'
import type { AnyNodeDefinition, RoofsCapability } from '../types'

const Pt = z.tuple([z.number(), z.number()])

/**
 * A plugin's solved roof plane, as an architect's roof holds it (`capabilities.roofs`): an outline
 * in its roof's plan, rising from a baseline at a pitch (rise per 12 of run).
 */
export const RoofPlane = BaseNode.extend({
  id: objectId('roofplane'),
  type: nodeType('test:roof-plane'),
  polygon: z.array(Pt),
  baseline: z.tuple([Pt, Pt]),
  baseHeight: z.number(),
  pitch: z.number(),
})
export type RoofPlane = z.infer<typeof RoofPlane>

/** The plane's surface over its roof's origin at a plan point: its eave, plus the rise of the run off it. */
export function roofPlaneHeightAt(plane: RoofPlane, x: number, z: number): number {
  const [[ax, az], [bx, bz]] = plane.baseline
  const run = Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / Math.hypot(bx - ax, bz - az)
  return plane.baseHeight + (run * plane.pitch) / 12
}

const roofs: RoofsCapability = {
  outline: (node) => (node as unknown as RoofPlane).polygon,
  heightAt: (node, x, z) => roofPlaneHeightAt(node as unknown as RoofPlane, x, z),
}

/** Registers the planes' kind; the test setup restores the registry after each test. */
export function registerRoofPlanes(): void {
  registerNode({
    kind: 'test:roof-plane',
    schemaVersion: 1,
    schema: RoofPlane,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { roofs },
  } as unknown as AnyNodeDefinition)
}

/**
 * A plane over the plan rectangle [x0, z0] to [x1, z1] of its roof, its eave along z0 at `eave`,
 * rising toward z1 at `pitch` in 12.
 */
export function roofPlane(
  id: string,
  [x0, z0, x1, z1]: [number, number, number, number],
  eave: number,
  { pitch = 6, parentId = null }: { pitch?: number; parentId?: string | null } = {},
): AnyNode {
  return RoofPlane.parse({
    id,
    parentId,
    polygon: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    baseline: [
      [x0, z0],
      [x1, z0],
    ],
    baseHeight: eave,
    pitch,
  }) as unknown as AnyNode
}
