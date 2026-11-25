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
import { SKYLIGHT_TYPE_PRESETS, SkylightNode, type SkylightType } from './skylight'
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
  width?: number
  depth?: number
  height?: number
  rotation?: number
  materialPreset?: string
  topMaterialPreset?: string
  glassMaterialPreset?: string
  skylightType?: SkylightType
  curb?: boolean
  curbHeight?: number
  heightAboveRidge?: number
  bodyShape?: ChimneyNode['bodyShape']
  cap?: boolean
  capShape?: ChimneyNode['capShape']
  flueCount?: number
  flueShape?: ChimneyNode['flueShape']
  shoulderStyle?: ChimneyNode['shoulderStyle']
  bandStyle?: ChimneyNode['bandStyle']
  cricketStyle?: ChimneyNode['cricketStyle']
  panelStyle?: ChimneyNode['panelStyle']
  cornerBevel?: number
}

const defined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>

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
        ...(options.materialPreset
          ? { materialPreset: options.materialPreset }
          : { material: CHIMNEY_DEFAULT_MATERIAL }),
        ...(options.topMaterialPreset
          ? { topMaterialPreset: options.topMaterialPreset }
          : options.materialPreset
            ? {}
            : { topMaterial: CHIMNEY_DEFAULT_MATERIAL }),
        ...defined({
          rotation: options.rotation,
          width: options.width,
          depth: options.depth,
          heightAboveRidge: options.heightAboveRidge,
          bodyShape: options.bodyShape,
          cap: options.cap,
          capShape: options.capShape,
          flueCount: options.flueCount,
          flueShape: options.flueShape,
          shoulderStyle: options.shoulderStyle,
          bandStyle: options.bandStyle,
          cricketStyle: options.cricketStyle,
          panelStyle: options.panelStyle,
          cornerBevel: options.cornerBevel,
        }),
      })
    case 'skylight': {
      const preset = options.skylightType
        ? (({ label: _label, ...fields }) => fields)(SKYLIGHT_TYPE_PRESETS[options.skylightType])
        : {}
      return SkylightNode.parse({
        ...seat,
        ...preset,
        ...defined({
          rotation: options.rotation,
          skylightType: options.skylightType,
          width: options.width,
          height: options.height,
          curb: options.curb,
          curbHeight: options.curbHeight,
          materialPreset: options.materialPreset,
          glassMaterialPreset: options.glassMaterialPreset,
        }),
      })
    }
    case 'solar-panel':
      return SolarPanelNode.parse({
        ...seat,
        surfaceNormal: getRoofSegmentSurfaceNormal(segment, position[0], position[2]),
        ...defined({
          rotation: options.rotation,
          rows: options.rows,
          columns: options.columns,
          materialPreset: options.materialPreset,
        }),
      })
    case 'cupola':
      return CupolaNode.parse({
        ...seat,
        slots: { louvers: CUPOLA_LOUVERS_DEFAULT },
        ...defined({
          rotation: options.rotation,
          width: options.width,
          depth: options.depth,
          height: options.height,
          materialPreset: options.materialPreset,
        }),
      })
    case 'box-vent':
      return BoxVentNode.parse({
        ...seat,
        rotation: options.rotation ?? getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
        ...defined({
          width: options.width,
          depth: options.depth,
          height: options.height,
          cornerBevel: options.cornerBevel,
          materialPreset: options.materialPreset,
        }),
      })
    case 'ridge-vent': {
      const snap = resolveRidgeSnap(segment, position[0], position[2])
      if (!snap) return null
      return RidgeVentNode.parse({
        ...seat,
        position: [snap.localX, 0, snap.localZ],
        rotation: options.rotation ?? snap.rotation,
        ...defined({
          width: options.width,
          height: options.height,
          materialPreset: options.materialPreset,
        }),
      })
    }
    case 'turbine-vent':
      return TurbineVentNode.parse({
        ...seat,
        rotation: options.rotation ?? getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
        ...defined({
          height: options.height,
          materialPreset: options.materialPreset,
        }),
      })
    case 'eyebrow-vent':
      return EyebrowVentNode.parse({
        ...seat,
        rotation: options.rotation ?? getRoofSegmentDownSlopeYaw(segment, position[0], position[2]),
        ...defined({
          width: options.width,
          depth: options.depth,
          height: options.height,
          materialPreset: options.materialPreset,
        }),
      })
  }
}
