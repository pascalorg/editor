import {
  getRoofSegmentDownSlopeYaw,
  getRoofSegmentSurfaceNormal,
} from '../../lib/roof-element-orientation'
import { resolveRidgeSnap } from '../../lib/roof-ridge-snap'
import { CUPOLA_LOUVERS_DEFAULT } from '../../node-slots/roof-accessories'
import { BoxVentNode } from './box-vent'
import { CHIMNEY_DEFAULT_MATERIAL, ChimneyNode } from './chimney'
import { CupolaNode } from './cupola'
import { EyebrowVentNode } from './eyebrow-vent'
import { RidgeVentNode } from './ridge-vent'
import type { RoofElementKind } from './roof-element-kinds'
import type { RoofSegmentNode } from './roof-segment'
import { SkylightNode } from './skylight'
import { SolarPanelNode } from './solar-panel'
import { TurbineVentNode } from './turbine-vent'

export type RoofElementNode =
  | ChimneyNode
  | SkylightNode
  | SolarPanelNode
  | CupolaNode
  | BoxVentNode
  | RidgeVentNode
  | TurbineVentNode
  | EyebrowVentNode

export type RoofElementOptions = {
  name?: string
  /** Solar array size; ignored for other kinds. */
  rows?: number
  columns?: number
}

const NAMES: Record<RoofElementKind, string> = {
  chimney: 'Chimney',
  skylight: 'Skylight',
  'solar-panel': 'Solar Panel',
  cupola: 'Cupola',
  'box-vent': 'Box Vent',
  'ridge-vent': 'Ridge Vent',
  'turbine-vent': 'Turbine Vent',
  'eyebrow-vent': 'Eyebrow Vent',
}

/** Construct at a supplied segment-local hit; the caller resolves physical support. */
export function buildRoofElementNode(
  kind: RoofElementKind,
  segment: RoofSegmentNode,
  position: [number, number, number],
  options: RoofElementOptions = {},
): RoofElementNode | null {
  const seat = {
    name: options.name ?? NAMES[kind],
    parentId: segment.id,
    roofSegmentId: segment.id,
    position,
    rotation: 0,
  }
  switch (kind) {
    case 'chimney':
      return ChimneyNode.parse({
        ...seat,
        material: CHIMNEY_DEFAULT_MATERIAL,
        topMaterial: CHIMNEY_DEFAULT_MATERIAL,
      })
    case 'skylight':
      return SkylightNode.parse(seat)
    case 'solar-panel':
      return SolarPanelNode.parse({
        ...seat,
        surfaceNormal: getRoofSegmentSurfaceNormal(segment, position[0], position[2]),
        ...(options.rows === undefined ? {} : { rows: options.rows }),
        ...(options.columns === undefined ? {} : { columns: options.columns }),
      })
    case 'cupola':
      return CupolaNode.parse({ ...seat, slots: { louvers: CUPOLA_LOUVERS_DEFAULT } })
    case 'box-vent':
      return BoxVentNode.parse({
        ...seat,
        rotation: getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
      })
    case 'ridge-vent': {
      const snap = resolveRidgeSnap(segment, position[0], position[2])
      if (!snap) return null
      return RidgeVentNode.parse({
        ...seat,
        position: [snap.localX, 0, snap.localZ],
        rotation: snap.rotation,
      })
    }
    case 'turbine-vent':
      return TurbineVentNode.parse({
        ...seat,
        rotation: getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
      })
    case 'eyebrow-vent':
      return EyebrowVentNode.parse({
        ...seat,
        rotation: getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
      })
  }
}
