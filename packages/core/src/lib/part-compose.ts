import type { FamilyId, LayoutFamilyId } from './family-registry'
import {
  angularStep,
  radialExtrudeRotationInHorizontalPlane,
  radialExtrudeRotationInLocalPlane,
} from './orientation-utils'
import type {
  PrimitiveGeometryBrief,
  PrimitiveMaterialInput,
  PrimitiveShapeInput,
  Vec3,
} from './primitive-compose'

type PartAxis = 'x' | 'y' | 'z'
type PartSide = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back'
type VehicleStyle = 'sedan' | 'suv' | 'sports' | 'van' | 'truck'

export type PartComposeKind =
  | 'circular_base'
  | 'vertical_pole'
  | 'motor_housing'
  | 'fan_blade'
  | 'radial_blades'
  | 'protective_grill'
  | 'pyramid'
  | 'wheel'
  | 'wheel_set'
  | 'window_panel'
  | 'window_strip'
  | 'body_shell'
  | 'tube_frame'
  | 'fork'
  | 'light_pair'
  | 'bar_pair'
  | 'support_bracket'
  | 'control_knob'
  | 'vent_slats'
  | 'vent_grill'
  | 'skid_base'
  | 'rounded_machine_body'
  | 'volute_casing'
  | 'impeller_blades'
  | 'propeller_blade_set'
  | 'mixer_blades'
  | 'pipe_port'
  | 'inlet_port'
  | 'outlet_port'
  | 'flange_ring'
  | 'flanged_nozzle'
  | 'manway_lid'
  | 'inspection_hatch'
  | 'sanitary_nozzle'
  | 'jacket_shell'
  | 'sight_glass'
  | 'sample_valve'
  | 'instrument_port'
  | 'stainless_highlight_panel'
  | 'bolt_pattern'
  | 'control_box'
  | 'ribbed_motor_body'
  | 'conveyor_frame'
  | 'roller_array'
  | 'belt_surface'
  | 'cylindrical_tank'
  | 'chimney_stack'
  | 'valve_body'
  | 'handwheel'
  | 'bicycle_wheels'
  | 'bicycle_frame'
  | 'bicycle_fork'
  | 'handlebar'
  | 'saddle'
  | 'chain_loop'
  | 'vehicle_body'
  | 'vehicle_wheels'
  | 'vehicle_windows'
  | 'headlights'
  | 'bumper'
  | 'gearbox_body'
  | 'filter_vessel'
  | 'heat_exchanger'
  | 'agitator_tank'
  | 'pipe_rack'
  | 'platform_ladder'
  | 'desk_top'
  | 'leg_set'
  | 'drawer_stack'
  | 'electrical_cabinet'
  | 'pipe_run'
  | 'pipe_elbow'
  | 'cable_tray'
  | 'nameplate'
  | 'warning_label'
  | 'seam_ring'
  | 'airfoil_blade'
  | 'ellipsoid_shell'
  | 'curved_lens_panel'
  | 'ergonomic_shell'
  | 'streamlined_body'
  | 'lofted_panel'
  | 'aircraft_fuselage'
  | 'aircraft_wing'
  | 'aircraft_engine'
  | 'aircraft_vertical_stabilizer'
  | 'aircraft_horizontal_stabilizer'
  | 'aircraft_landing_gear'
  | 'generic_body'
  | 'generic_base'
  | 'generic_panel'
  | 'generic_handle'
  | 'generic_spout'
  | 'generic_control_panel'
  | 'generic_display'
  | 'generic_foot_set'
  | 'generic_opening'
  | 'generic_detail_accent'
  | 'mobile_platform_chassis'
  | 'lidar_sensor'
  | 'emergency_stop_button'
  | 'status_light_strip'
  | 'operator_panel'
  | 'guard_fence'
  | 'pallet_table'
  | 'bearing_block'
  | 'support_roller_pair'
  | 'structural_tower_frame'
  | 'cyclone_separator_unit'
  | 'coupling_guard'
  | 'motor_gearbox_unit'
  | 'pipe_manifold'
  | 'hopper_body'
  | 'conical_hopper'
  | 'service_platform'
  | 'platform_with_ladder'
  | 'kiosk_body'
  | 'kiosk_roof'
  | 'kiosk_opening'
  | 'kiosk_counter'
  | 'kiosk_sign'
  | 'kiosk_awning'

export interface LoftedPanelSectionInput {
  width?: number
  height?: number
  length?: number
  x?: number
  y?: number
  z?: number
  topScale?: [number, number]
}

export type PartComposeDetail = 'low' | 'medium' | 'high'

export interface PartComposePartInput {
  kind?: PartComposeKind | string
  partType?: PartComposeKind | string
  type?: PartComposeKind | string
  id?: string
  name?: string
  partName?: string
  style?: string
  variant?: string
  detail?: PartComposeDetail | string
  detailLevel?: PartComposeDetail | string
  grillDetailLevel?: PartComposeDetail | string
  bottomStyle?: string
  legStyle?: string
  valveStyle?: string
  handleStyle?: string
  state?: string
  vehicleStyle?: VehicleStyle | string
  position?: Vec3
  rotation?: Vec3
  connectTo?: string | number
  attachToRole?: string
  connectPoint?: string
  childPoint?: string
  centeredOn?: string | number
  alignAbove?: string | number
  alignBeside?: string | number
  offsetFrom?: string | number
  offsetDirection?: PartSide | string
  offsetDistance?: number
  around?: string | number
  aroundIndex?: number
  aroundCount?: number
  aroundRadius?: number
  aroundAngle?: number
  aroundStartAngle?: number
  aroundAxis?: PartAxis | string
  cornerPattern?: boolean
  cornerInset?: number
  array?: { count?: number; axis?: PartAxis | string; spacing?: number }
  arrayAlong?: PartAxis | 'length' | 'width' | 'height' | string
  arrayAxis?: PartAxis | string
  arrayOffset?: number
  relationGap?: number
  anchor?: string
  childAnchor?: string
  axis?: PartAxis | string
  side?: PartSide | string
  offset?: Vec3 | number
  outletAngle?: number
  radius?: number
  diameter?: number
  radiusTop?: number
  radiusBottom?: number
  outletRadius?: number
  flangeRadius?: number
  flangeThickness?: number
  bendRadius?: number
  dimensions?: Record<string, unknown>
  params?: Record<string, unknown>
  height?: number
  width?: number
  depth?: number
  domeDepth?: number
  length?: number
  thickness?: number
  sizeScale?: number
  cornerRadius?: number
  cornerSegments?: number
  count?: number
  portCount?: number
  doorCount?: number
  legCount?: number
  ringCount?: number
  rungCount?: number
  rollerLength?: number
  radialSegments?: number
  levelCount?: number
  bayCount?: number
  stageCount?: number
  stairFlights?: number
  stairSide?: PartSide | string
  stairPlacement?: 'inside' | 'outside' | string
  externalStairs?: boolean
  includeDiagonalBraces?: boolean
  spokeCount?: number
  wireRadius?: number
  wheelRadius?: number
  wheelWidth?: number
  warningStripes?: boolean
  stripeCount?: number
  stripeHeight?: number
  frontX?: number
  rearX?: number
  frontZ?: number
  rearZ?: number
  overallHeight?: number
  bodyHeight?: number
  cabinHeight?: number
  roofCornerAngle?: number
  cabinTopScale?: number
  cabinTopLengthScale?: number
  cabinTopWidthScale?: number
  truncated?: boolean
  topScale?: number | [number, number]
  topLengthScale?: number
  topWidthScale?: number
  topRadius?: number
  topLength?: number
  topWidth?: number
  bladeRadius?: number
  hubRadius?: number
  bladeWidth?: number
  bladePitch?: number
  bladeSweep?: number
  bladeShape?: string
  rootWidth?: number
  tipWidth?: number
  twist?: number
  camber?: number
  verticalCurve?: number
  pitch?: number
  lensShape?: string
  curvature?: number
  shellThickness?: number
  openingRadius?: number
  cutBottom?: boolean
  noseSlope?: number
  tailSlope?: number
  sideTaper?: number
  noseRoundness?: number
  tailTaper?: number
  roofArc?: number
  sections?: LoftedPanelSectionInput[]
  slatCount?: number
  boltCount?: number
  includeBolts?: boolean
  includeSupportLegs?: boolean
  includeHub?: boolean
  material?: PrimitiveMaterialInput
  materialPreset?: string
  preset?: string
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  color?: string
  primaryColor?: string
  secondaryColor?: string
  metalColor?: string
  motorColor?: string
  rollerColor?: string
  darkColor?: string
  accentColor?: string
  opacity?: number
}

export interface PartComposeInput {
  name?: string
  partName?: string
  family?: string
  geometryBrief?: PrimitiveGeometryBrief
  position?: Vec3
  detail?: PartComposeDetail | string
  length?: number
  width?: number
  depth?: number
  height?: number
  diameter?: number
  radius?: number
  thickness?: number
  primaryColor?: string
  secondaryColor?: string
  metalColor?: string
  darkColor?: string
  accentColor?: string
  autoComplete?: boolean
  enhanceVisualDetails?: boolean
  registryPartPlan?: boolean
  __registryPartPlan?: boolean
  parts?: PartComposePartInput[]
}

export interface PartSpec {
  kind: PartComposeKind | string
  family?: string
  semanticRole?: string
  dimensions?: {
    length?: number
    width?: number
    depth?: number
    height?: number
    diameter?: number
    radius?: number
    thickness?: number
  }
  transform?: {
    position?: Vec3
    rotation?: Vec3
  }
  material?: PrimitiveMaterialInput
  color?: string
  attachTo?: string | number
  constraints?: Record<string, unknown>
}

export interface PartBlueprintAssessment {
  family:
    | 'fan'
    | 'pump'
    | 'conveyor'
    | 'bicycle'
    | 'vehicle'
    | 'valve'
    | 'desk'
    | 'pipe_system'
    | 'electrical'
    | 'aircraft'
    | 'unknown'
  required: PartComposeKind[]
  present: PartComposeKind[]
  missing: PartComposeKind[]
  optional: PartComposeKind[]
  recommendedDetails: PartComposeKind[]
  missingDetails: PartComposeKind[]
  score: number
  recommendations: string[]
}

export interface PartVisualAssessment {
  family: PartBlueprintAssessment['family']
  score: number
  presentDetails: PartComposeKind[]
  missingDetails: PartComposeKind[]
  recommendations: string[]
}

interface PartRequirementGroup {
  label: string
  anyOf: PartComposeKind[]
  defaultPart: PartComposePartInput
}

interface PartFamilySpec {
  family: PartBlueprintAssessment['family']
  required: PartRequirementGroup[]
  optional: PartComposeKind[]
  recommendedDetails: PartRequirementGroup[]
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
  )
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(value, fallback, min, max))
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]]
}

function partAxis(axis: unknown, fallback: PartAxis): PartAxis {
  return axis === 'x' || axis === 'y' || axis === 'z' ? axis : fallback
}

function partSide(side: unknown): PartSide | undefined {
  switch (side) {
    case 'left':
    case 'right':
    case 'top':
    case 'bottom':
    case 'front':
    case 'back':
      return side
    default:
      return undefined
  }
}

function axisForSide(side: PartSide, fallback: PartAxis): PartAxis {
  switch (side) {
    case 'left':
    case 'right':
      return 'x'
    case 'top':
    case 'bottom':
      return 'y'
    case 'front':
    case 'back':
      return 'z'
    default:
      return fallback
  }
}

function signForSide(side: PartSide | undefined, axis: PartAxis): -1 | 1 {
  if (side === 'left' || side === 'bottom' || side === 'back') return -1
  if (side === 'right' || side === 'top' || side === 'front') return 1
  return axis === 'z' ? 1 : 1
}

function offsetAlongAxis(center: Vec3, axis: PartAxis, distance: number): Vec3 {
  switch (axis) {
    case 'x':
      return [center[0] + distance, center[1], center[2]]
    case 'y':
      return [center[0], center[1] + distance, center[2]]
    default:
      return [center[0], center[1], center[2] + distance]
  }
}

function axisNormal(axis: PartAxis, sign: -1 | 1 = 1): Vec3 {
  switch (axis) {
    case 'x':
      return [sign, 0, 0]
    case 'y':
      return [0, sign, 0]
    default:
      return [0, 0, sign]
  }
}

function rotateVec(v: Vec3, euler: Vec3): Vec3 {
  let [x, y, z] = v

  const cz = Math.cos(euler[2])
  const sz = Math.sin(euler[2])
  ;[x, y] = [x * cz - y * sz, x * sz + y * cz]

  const cy = Math.cos(euler[1])
  const sy = Math.sin(euler[1])
  ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]

  const cx = Math.cos(euler[0])
  const sx = Math.sin(euler[0])
  ;[y, z] = [y * cx - z * sx, y * sx + z * cx]

  return [x, y, z]
}

function applyPartRotation(
  shapes: PrimitiveShapeInput[],
  pivot: Vec3,
  rotation: Vec3 | undefined,
): PrimitiveShapeInput[] {
  if (!rotation) return shapes
  return shapes.map((shape) => ({
    ...shape,
    position: shape.position
      ? add(pivot, rotateVec(sub(shape.position, pivot), rotation))
      : shape.position,
    rotation: add(shape.rotation ?? [0, 0, 0], rotation),
    cutouts: shape.cutouts?.map((cutout) => ({
      ...cutout,
      position: cutout.position
        ? add(pivot, rotateVec(sub(cutout.position, pivot), rotation))
        : cutout.position,
      normal: cutout.normal ? rotateVec(cutout.normal, rotation) : cutout.normal,
    })),
    ports: shape.ports?.map((port) => ({
      ...port,
      position: port.position
        ? add(pivot, rotateVec(sub(port.position, pivot), rotation))
        : port.position,
      normal: port.normal ? rotateVec(port.normal, rotation) : port.normal,
    })),
  }))
}

function radialPoint(center: Vec3, angle: number, radius: number, zOffset = 0): Vec3 {
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    center[2] + zOffset,
  ]
}

function tubeBetween(
  name: string,
  start: Vec3,
  end: Vec3,
  radius: number,
  mat: PrimitiveMaterialInput,
): PrimitiveShapeInput {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const length = Math.hypot(dx, dy, dz)
  const yaw = Math.atan2(dy, dx)
  const pitch = -Math.atan2(dz, Math.hypot(dx, dy))
  return {
    kind: 'cylinder',
    name,
    position: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
    rotation: [0, pitch, yaw],
    axis: 'x',
    radius,
    height: Math.max(length, 0.001),
    radialSegments: 12,
    material: mat,
  }
}

function radialPointOnAxis(center: Vec3, axis: PartAxis, angle: number, radius: number): Vec3 {
  const c = Math.cos(angle) * radius
  const s = Math.sin(angle) * radius
  switch (axis) {
    case 'x':
      return [center[0], center[1] + c, center[2] + s]
    case 'y':
      return [center[0] + c, center[1], center[2] + s]
    default:
      return [center[0] + c, center[1] + s, center[2]]
  }
}

function material(
  color: string,
  roughness = 0.55,
  metalness = 0.05,
  opacity = 1,
): PrimitiveMaterialInput {
  return {
    properties: {
      color,
      roughness,
      metalness,
      opacity,
      transparent: opacity < 1,
    },
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function partIntentText(input: PartComposeInput, part?: PartComposePartInput): string {
  return [
    input.name,
    input.geometryBrief,
    part?.name,
    part?.partName,
    part?.style,
    part?.variant,
    part?.valveStyle,
    part?.handleStyle,
    part?.state,
  ]
    .map(textOf)
    .join(' ')
}

function isBallValveIntent(input: PartComposeInput, part?: PartComposePartInput): boolean {
  return /(ball\s*valve|球阀|quarter[-\s]?turn|90\s*°|90\s*degree)/i.test(
    partIntentText(input, part),
  )
}

function partIdentityText(part: PartComposePartInput): string {
  return [
    part.kind,
    part.partType,
    part.type,
    part.id,
    part.name,
    part.partName,
    part.style,
    part.variant,
  ]
    .map(textOf)
    .join(' ')
}

function isMixerPartContext(input: PartComposeInput, parts: PartComposePartInput[]): boolean {
  const text = [input.name, input.partName, input.geometryBrief, ...parts.map(partIdentityText)]
    .map(textOf)
    .join(' ')
  const hasMixerLanguage = /mixer|agitator|impeller|mud|slurry|paddle|搅拌|泥浆|桨叶|叶轮/.test(
    text,
  )
  const hasPropellerSet = parts.some((part) => {
    const kind = normalizedPartKind(part)
    return kind === 'propeller_blade_set' || kind === 'mixer_blades'
  })
  const hasBladePart = parts.some((part) => {
    const kind = normalizedPartKind(part)
    return (
      kind === 'propeller_blade_set' ||
      kind === 'mixer_blades' ||
      kind === 'fan_blade' ||
      kind === 'radial_blades'
    )
  })
  const hasShaft = parts.some((part) => {
    const kind = normalizedPartKind(part)
    return kind === 'vertical_pole' || /shaft|rod|pole/.test(partIdentityText(part))
  })
  const hasHub = parts.some((part) => {
    const kind = normalizedPartKind(part)
    return kind === 'circular_base' || /hub|boss/.test(partIdentityText(part))
  })
  return (
    (hasMixerLanguage && hasPropellerSet && (hasShaft || hasHub)) ||
    (hasMixerLanguage && hasBladePart && hasShaft) ||
    (hasPropellerSet && hasShaft && hasHub)
  )
}

function applyMixerPartDefaults(
  parts: PartComposePartInput[],
  input: PartComposeInput,
): PartComposePartInput[] {
  if (!isMixerPartContext(input, parts)) return parts
  const shaft = parts.find((part) => normalizedPartKind(part) === 'vertical_pole')
  const hub = parts.find((part) => normalizedPartKind(part) === 'circular_base')
  const shaftHeight = clamp(shaft?.height, 1.4, 0.25, 3)
  const hubHeight = clamp(hub?.height, 0.1, 0.03, 0.35)
  const hubY = hubHeight / 2

  return parts.map((part) => {
    const kind = normalizedPartKind(part)
    const identity = partIdentityText(part)
    if (kind === 'vertical_pole' && (/shaft|rod|pole/.test(identity) || part === shaft)) {
      return {
        ...part,
        id: part.id ?? 'mixer_shaft',
        position: part.position ?? [0, hubHeight + shaftHeight / 2, 0],
        semanticRole: part.semanticRole ?? 'mixer_shaft',
        semanticGroup: part.semanticGroup ?? 'mixer_shaft',
        sourcePartKind: part.sourcePartKind ?? 'mixer_shaft',
      }
    }
    if (kind === 'circular_base' && (/hub|boss/.test(identity) || part === hub)) {
      return {
        ...part,
        id: part.id ?? 'mixer_hub',
        alignAbove: undefined,
        alignBeside: undefined,
        centeredOn: undefined,
        around: undefined,
        position: part.position ?? [0, hubY, 0],
        semanticRole: part.semanticRole ?? 'mixer_hub',
        semanticGroup: part.semanticGroup ?? 'mixer_hub',
        sourcePartKind: part.sourcePartKind ?? 'mixer_hub',
      }
    }
    if (
      kind === 'propeller_blade_set' ||
      kind === 'mixer_blades' ||
      kind === 'fan_blade' ||
      kind === 'radial_blades'
    ) {
      return {
        ...part,
        kind: 'mixer_blades',
        id: part.id ?? 'mixer_blades',
        around: undefined,
        aroundCount: undefined,
        aroundIndex: undefined,
        aroundAngle: undefined,
        position: part.position ?? [0, hubY + hubHeight * 0.25, 0],
        bladeShape: part.bladeShape ?? 'taiji_half',
        count: part.count ?? 3,
        semanticRole: part.semanticRole ?? 'mixer_blade',
        semanticGroup: part.semanticGroup ?? 'mixer_blades',
        sourcePartKind: part.sourcePartKind ?? 'mixer_blades',
      }
    }
    return part
  })
}

function partMaterial(
  part: PartComposePartInput,
  fallback: PrimitiveMaterialInput,
): PrimitiveMaterialInput {
  if (part.material) return part.material
  if (part.materialPreset) return { preset: part.materialPreset }
  if (part.color) return material(part.color)
  return fallback
}

function ringSegments(detail: PartComposeInput['detail']): number {
  switch (detail) {
    case 'high':
      return 64
    case 'low':
      return 32
    default:
      return 48
  }
}

function normalizePartKind(kind: unknown): PartComposeKind | null {
  const raw =
    typeof kind === 'string'
      ? kind
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
      : ''
  switch (raw) {
    case 'base':
    case 'round_base':
    case 'circular_base':
      return 'circular_base'
    case 'pole':
    case 'rod':
    case 'vertical_pole':
      return 'vertical_pole'
    case 'motor':
    case 'motor_housing':
    case 'head_housing':
      return 'motor_housing'
    case 'blades':
    case 'blade':
    case 'fan_blade':
    case 'fanblade':
    case 'impeller_fan_blade':
      return 'fan_blade'
    case 'fan_blades':
    case 'radial_blades':
      return 'radial_blades'
    case 'grill':
    case 'grille':
    case 'cage':
    case 'protective_grill':
    case 'protective_grille':
      return 'protective_grill'
    case 'pyramid':
    case 'square_pyramid':
    case 'four_sided_pyramid':
    case 'tetra_pyramid':
      return 'pyramid'
    case 'bracket':
    case 'yoke':
    case 'support_bracket':
      return 'support_bracket'
    case 'knob':
    case 'control_knob':
      return 'control_knob'
    case 'vents':
    case 'slats':
    case 'louvers':
    case 'louver':
    case 'louver_panel':
    case 'louvered_panel':
    case 'louvered_vents':
    case 'vent_slats':
      return 'vent_slats'
    case 'vent_grill':
    case 'vent_grille':
    case 'grille_panel':
    case 'air_grille':
    case 'louver_grill':
    case 'louvered_grill':
    case 'air_vent_grill':
      return 'vent_grill'
    case 'skid':
    case 'skid_base':
    case 'machine_base':
    case 'base_frame':
      return 'skid_base'
    case 'body':
    case 'machine_body':
    case 'rounded_body':
    case 'rounded_machine_body':
      return 'rounded_machine_body'
    case 'volute':
    case 'volute_casing':
    case 'pump_casing':
    case 'blower_casing':
    case 'scroll_casing':
      return 'volute_casing'
    case 'impeller':
    case 'impeller_blades':
    case 'pump_impeller':
    case 'turbine_blades':
      return 'impeller_blades'
    case 'propeller_blade_set':
    case 'propeller_blades':
    case 'propeller_set':
    case 'blade_set':
    case 'paddle_set':
    case 'agitator_blade_set':
    case 'taiji_propeller':
    case 'taiji_half_blades':
      return 'propeller_blade_set'
    case 'mixer_blades':
    case 'mixer_impeller':
    case 'mud_mixer_blades':
    case 'agitator_blades':
    case 'taiji_blades':
      return 'mixer_blades'
    case 'wheel':
    case 'single_wheel':
    case 'rubber_wheel':
    case 'landing_wheel':
    case 'bicycle_wheel':
    case 'bike_wheel':
    case 'cycle_wheel':
    case 'front_bicycle_wheel':
    case 'rear_bicycle_wheel':
      return 'wheel'
    case 'wheel_set':
    case 'wheels':
    case 'wheelset':
    case 'wheel_pair':
    case 'tire_set':
    case 'tire_pair':
      return 'wheel_set'
    case 'window_panel':
    case 'glass_panel':
    case 'rounded_window':
    case 'window':
      return 'window_panel'
    case 'window_strip':
    case 'glass_strip':
    case 'window_array':
    case 'cabin_windows':
      return 'window_strip'
    case 'body_shell':
    case 'shell_body':
    case 'vehicle_body':
    case 'car_body':
    case 'auto_body':
      return 'body_shell'
    case 'tube_frame':
    case 'frame_assembly':
    case 'bicycle_frame':
    case 'bike_frame':
    case 'bicycle':
    case 'bike':
    case 'complete_bicycle':
    case 'complete_bike':
      return 'tube_frame'
    case 'fork':
    case 'bicycle_fork':
    case 'front_fork':
    case 'bike_fork':
      return 'fork'
    case 'light_pair':
    case 'headlights':
    case 'head_lights':
    case 'lamps':
      return 'light_pair'
    case 'bar_pair':
    case 'bumper':
    case 'bumpers':
    case 'car_bumper':
      return 'bar_pair'
    case 'generic_body':
    case 'generic_main_body':
    case 'main_body':
    case 'equipment_body':
    case 'building_body':
    case 'furniture_body':
    case 'cabinet_body':
    case 'housing':
    case 'shell':
      return 'generic_body'
    case 'generic_base':
    case 'support_base':
    case 'platform_base':
    case 'base_slab':
    case 'cup_platform':
    case 'generic_platform':
      return 'generic_base'
    case 'generic_panel':
    case 'panel':
    case 'front_panel':
    case 'side_panel':
    case 'access_panel':
      return 'generic_panel'
    case 'generic_handle':
    case 'handle':
    case 'pull_handle':
    case 'door_handle':
      return 'generic_handle'
    case 'generic_spout':
    case 'spout':
    case 'nozzle_spout':
    case 'coffee_spout':
    case 'dispense_spout':
      return 'generic_spout'
    case 'generic_control_panel':
    case 'control_detail':
    case 'buttons':
    case 'button_panel':
      return 'generic_control_panel'
    case 'generic_display':
    case 'display':
    case 'screen':
    case 'readout':
      return 'generic_display'
    case 'generic_foot_set':
    case 'foot_set':
      return 'generic_foot_set'
    case 'generic_opening':
    case 'opening':
    case 'door_opening':
    case 'window_opening':
      return 'generic_opening'
    case 'generic_detail_accent':
    case 'detail_accent':
    case 'accent':
    case 'trim':
      return 'generic_detail_accent'
    case 'mobile_platform_chassis':
    case 'mobile_chassis':
    case 'agv_chassis':
    case 'amr_chassis':
    case 'robot_platform_chassis':
      return 'mobile_platform_chassis'
    case 'lidar_sensor':
    case 'laser_scanner':
    case 'navigation_sensor':
    case 'safety_scanner':
    case 'scanner':
      return 'lidar_sensor'
    case 'emergency_stop_button':
    case 'e_stop':
    case 'e_stop_button':
    case 'emergency_button':
    case 'stop_button':
      return 'emergency_stop_button'
    case 'status_light_strip':
    case 'light_strip':
    case 'led_strip':
    case 'signal_light_strip':
    case 'status_strip':
      return 'status_light_strip'
    case 'operator_panel':
    case 'hmi_panel':
    case 'control_pendant':
    case 'operator_console':
      return 'operator_panel'
    case 'guard_fence':
    case 'safety_fence':
    case 'safety_guard':
    case 'guard_rail':
    case 'barrier_fence':
      return 'guard_fence'
    case 'pallet_table':
    case 'pallet_station':
    case 'pallet_deck':
    case 'fixture_table':
      return 'pallet_table'
    case 'bearing_block':
    case 'pillow_block':
    case 'pillow_block_bearing':
    case 'bearing_housing':
    case 'mounted_bearing':
      return 'bearing_block'
    case 'coupling_guard':
    case 'shaft_guard':
    case 'coupling_cover':
    case 'rotating_shaft_guard':
      return 'coupling_guard'
    case 'motor_gearbox_unit':
    case 'motor_reducer_unit':
    case 'drive_unit':
    case 'gearmotor':
    case 'motor_gearbox':
      return 'motor_gearbox_unit'
    case 'pipe_manifold':
    case 'manifold':
    case 'header_pipe':
    case 'branch_manifold':
      return 'pipe_manifold'
    case 'hopper_body':
    case 'feed_hopper':
    case 'material_hopper':
    case 'inlet_hopper':
      return 'hopper_body'
    case 'conical_hopper':
    case 'cone_hopper':
    case 'cone_discharge_hopper':
      return 'conical_hopper'
    case 'service_platform':
    case 'maintenance_platform':
    case 'inspection_platform':
    case 'access_deck':
      return 'service_platform'
    case 'platform_with_ladder':
    case 'maintenance_platform_ladder':
    case 'access_platform_ladder':
      return 'platform_with_ladder'
    case 'kiosk_body':
    case 'booth_body':
    case 'small_building_body':
    case 'stall_body':
    case 'newsstand_body':
      return 'kiosk_body'
    case 'kiosk_roof':
    case 'booth_roof':
    case 'small_building_roof':
    case 'pavilion_roof':
    case 'shed_roof':
      return 'kiosk_roof'
    case 'kiosk_opening':
    case 'service_window':
    case 'serving_window':
    case 'ticket_window':
    case 'booth_window':
    case 'kiosk_door':
      return 'kiosk_opening'
    case 'kiosk_counter':
    case 'service_counter':
    case 'serving_counter':
    case 'sales_counter':
    case 'vendor_counter':
      return 'kiosk_counter'
    case 'kiosk_sign':
    case 'sign_panel':
    case 'shop_sign':
    case 'booth_sign':
    case 'name_sign':
      return 'kiosk_sign'
    case 'kiosk_awning':
    case 'awning':
    case 'canopy':
    case 'sunshade':
      return 'kiosk_awning'
    case 'airfoil_blade':
    case 'airfoil_blades':
    case 'propeller_blade':
    case 'turbine_blade':
    case 'curved_blade':
    case 'curved_blades':
      return 'airfoil_blade'
    case 'ellipsoid_shell':
    case 'ellipsoidal_shell':
    case 'elliptical_shell':
    case 'oval_shell':
    case 'dome_shell':
    case 'equipment_dome':
    case 'helmet_shell':
    case 'mouse_dome':
    case 'tank_head':
    case 'vessel_head':
      return 'ellipsoid_shell'
    case 'curved_lens':
    case 'curved_panel':
    case 'arc_panel':
    case 'bent_panel':
    case 'curved_lens_panel':
    case 'lens_panel':
    case 'sunglasses_lens':
    case 'goggles_lens':
    case 'visor':
      return 'curved_lens_panel'
    case 'ergonomic_shell':
    case 'mouse_shell':
    case 'smooth_shell':
    case 'organic_shell':
      return 'ergonomic_shell'
    case 'aircraft_fuselage':
    case 'fuselage':
    case 'fuselage_tube':
    case 'airliner_fuselage':
    case 'airplane_body':
      return 'aircraft_fuselage'
    case 'streamlined_body':
    case 'streamlined_shell':
    case 'aero_body':
    case 'aerodynamic_body':
    case 'train_nose':
    case 'bullet_train_nose':
      return 'streamlined_body'
    case 'lofted_panel':
    case 'loft_panel':
    case 'lofted_shell':
    case 'sectioned_panel':
    case 'transition_panel':
      return 'lofted_panel'
    case 'aircraft_wing':
    case 'main_wing':
    case 'main_wings':
    case 'wing':
    case 'wings':
    case 'low_mounted_wing':
    case 'low_mounted_wings':
    case 'swept_wing':
    case 'swept_wings':
      return 'aircraft_wing'
    case 'aircraft_engine':
    case 'jet_engine':
    case 'jet_engines':
    case 'engine_nacelle':
    case 'engine_nacelles':
    case 'nacelle':
    case 'nacelles':
    case 'aft_mounted_engine':
    case 'aft_mounted_engines':
      return 'aircraft_engine'
    case 'vertical_stabilizer':
    case 'vertical_stabiliser':
    case 'vertical_fin':
    case 'tail_fin':
    case 'aircraft_vertical_stabilizer':
      return 'aircraft_vertical_stabilizer'
    case 'horizontal_stabilizer':
    case 'horizontal_stabiliser':
    case 'horizontal_tail':
    case 't_tail':
    case 't_tail_stabilizer':
    case 'aircraft_horizontal_stabilizer':
      return 'aircraft_horizontal_stabilizer'
    case 'landing_gear':
    case 'aircraft_landing_gear':
    case 'nose_gear':
    case 'main_gear':
      return 'aircraft_landing_gear'
    case 'pipe':
    case 'pipe_stub':
    case 'pipe_port':
    case 'pipe_nozzle':
    case 'hose_port':
    case 'service_port':
    case 'connector_port':
    case 'nozzle':
      return 'pipe_port'
    case 'inlet':
    case 'inlet_port':
    case 'suction_port':
      return 'inlet_port'
    case 'outlet':
    case 'outlet_port':
    case 'discharge_port':
      return 'outlet_port'
    case 'flange':
    case 'flange_ring':
    case 'mounting_flange':
    case 'pipe_flange':
      return 'flange_ring'
    case 'flanged_nozzle':
    case 'flanged_pipe_nozzle':
    case 'nozzle_with_flange':
    case 'process_nozzle':
      return 'flanged_nozzle'
    case 'manway_lid':
    case 'manway_cover':
    case 'manway_hatch':
    case 'access_lid':
    case 'hatch_cover':
      return 'manway_lid'
    case 'inspection_hatch':
    case 'access_hatch':
    case 'round_hatch':
      return 'inspection_hatch'
    case 'sanitary_nozzle':
    case 'tri_clamp_nozzle':
    case 'hygienic_nozzle':
    case 'short_nozzle':
    case 'feed_stub':
      return 'sanitary_nozzle'
    case 'jacket_shell':
    case 'outer_jacket':
    case 'thermal_jacket':
    case 'cooling_jacket':
    case 'heating_jacket':
      return 'jacket_shell'
    case 'sight_glass':
    case 'sightglass':
    case 'inspection_glass':
    case 'view_glass':
    case 'viewing_glass':
      return 'sight_glass'
    case 'sample_valve':
    case 'sampling_valve':
    case 'sampling_port':
    case 'sample_cock':
      return 'sample_valve'
    case 'instrument_port':
    case 'gauge_port':
    case 'thermowell':
    case 'pressure_gauge':
    case 'temperature_probe':
    case 'sensor_port':
      return 'instrument_port'
    case 'stainless_highlight_panel':
    case 'metal_highlight_panel':
    case 'polished_highlight':
    case 'vertical_highlight':
    case 'stainless_reflection':
      return 'stainless_highlight_panel'
    case 'bolts':
    case 'bolt_pattern':
    case 'bolt_circle':
    case 'screw':
    case 'screws':
    case 'screw_pattern':
    case 'fasteners':
    case 'fastener_pattern':
      return 'bolt_pattern'
    case 'control_box':
    case 'control_panel':
    case 'electrical_box':
      return 'control_box'
    case 'ribbed_motor':
    case 'ribbed_motor_body':
    case 'electric_motor':
    case 'industrial_motor':
      return 'ribbed_motor_body'
    case 'conveyor':
    case 'conveyor_frame':
    case 'belt_conveyor':
      return 'conveyor_frame'
    case 'rollers':
    case 'roller_array':
    case 'conveyor_rollers':
      return 'roller_array'
    case 'support_roller_pair':
    case 'support_roller_station':
    case 'trunnion_roller_pair':
    case 'kiln_support_roller':
      return 'support_roller_pair'
    case 'structural_tower_frame':
    case 'tower_frame':
    case 'steel_tower_frame':
    case 'preheater_tower_frame':
    case 'multi_level_tower_frame':
      return 'structural_tower_frame'
    case 'cyclone_separator_unit':
    case 'cyclone_unit':
    case 'preheater_cyclone':
    case 'cyclone_stage':
    case 'cyclone_separator':
      return 'cyclone_separator_unit'
    case 'belt':
    case 'belt_surface':
    case 'conveyor_belt':
      return 'belt_surface'
    case 'tank':
    case 'vessel':
    case 'cylindrical_tank':
    case 'pressure_vessel':
      return 'cylindrical_tank'
    case 'chimney':
    case 'chimney_stack':
    case 'smokestack':
    case 'smoke_stack':
    case 'industrial_chimney':
    case 'flue_stack':
      return 'chimney_stack'
    case 'valve':
    case 'valve_body':
      return 'valve_body'
    case 'handwheel':
    case 'hand_wheel':
    case 'valve_wheel':
      return 'handwheel'
    case 'bicycle_wheels':
    case 'bike_wheels':
    case 'bike_wheelset':
    case 'bicycle_wheelset':
      return 'wheel_set'
    case 'handlebar':
    case 'handlebars':
    case 'bike_handlebar':
    case 'bicycle_handlebar':
    case 'bicycle_handlebars':
      return 'handlebar'
    case 'saddle':
    case 'seat':
    case 'bike_seat':
    case 'bicycle_seat':
      return 'saddle'
    case 'chain':
    case 'chain_loop':
    case 'bike_chain':
    case 'bicycle_chain':
    case 'bicycle_crank':
    case 'bike_crank':
    case 'bicycle_chainring':
    case 'bike_chainring':
    case 'bicycle_pedals':
    case 'bike_pedals':
      return 'chain_loop'
    case 'vehicle_wheels':
    case 'car_wheels':
      return 'wheel_set'
    case 'car_windows':
    case 'windows':
      return 'window_strip'
    case 'gearbox':
    case 'gearbox_body':
    case 'reducer':
    case 'speed_reducer':
      return 'gearbox_body'
    case 'filter':
    case 'filter_vessel':
    case 'pressure_filter':
      return 'filter_vessel'
    case 'heat_exchanger':
    case 'exchanger':
    case 'shell_and_tube':
      return 'heat_exchanger'
    case 'agitator':
    case 'agitator_tank':
    case 'mixing_tank':
    case 'mixer_tank':
      return 'agitator_tank'
    case 'pipe_rack':
    case 'pipe_bridge':
    case 'pipe_corridor':
      return 'pipe_rack'
    case 'platform':
    case 'ladder':
    case 'platform_ladder':
    case 'access_platform':
      return 'platform_ladder'
    case 'desk_top':
    case 'table_top':
    case 'desktop':
    case 'worktop':
      return 'desk_top'
    case 'legs':
    case 'feet':
    case 'support_feet':
    case 'mounting_feet':
    case 'rubber_feet':
    case 'leveling_feet':
    case 'leg_set':
    case 'table_legs':
    case 'desk_legs':
      return 'leg_set'
    case 'drawers':
    case 'drawer_stack':
    case 'drawer_unit':
    case 'drawer_cabinet':
      return 'drawer_stack'
    case 'electrical_cabinet':
    case 'electrical_panel':
    case 'control_cabinet':
    case 'power_cabinet':
    case 'switchgear':
      return 'electrical_cabinet'
    case 'pipe_run':
    case 'straight_pipe':
    case 'pipeline':
    case 'process_pipe':
      return 'pipe_run'
    case 'pipe_elbow':
    case 'elbow':
    case 'pipe_bend':
    case 'bend':
      return 'pipe_elbow'
    case 'cable_tray':
    case 'wire_tray':
    case 'tray':
    case 'cable_ladder':
      return 'cable_tray'
    case 'nameplate':
    case 'name_plate':
    case 'rating_plate':
    case 'serial_plate':
    case 'label_plate':
    case 'data_plate':
      return 'nameplate'
    case 'warning_label':
    case 'warning_sticker':
    case 'label':
      return 'warning_label'
    case 'seam_ring':
    case 'seam':
    case 'joint_ring':
      return 'seam_ring'
    default:
      return null
  }
}

function normalizedPartKind(part: PartComposePartInput): PartComposeKind | null {
  return normalizePartKind(part.kind ?? part.partType ?? part.type)
}

function normalizeVehicleStyle(value: unknown): VehicleStyle | undefined {
  const text = textOf(value).replace(/[\s_-]+/g, '')
  if (!text) return undefined
  if (/sport|supercar|coupe|race|racing|跑车|赛车/.test(text)) return 'sports'
  if (/suv|offroad|offroader|jeep/.test(text)) return 'suv'
  if (/van|minivan|mpv|bus/.test(text)) return 'van'
  if (/truck|pickup|ute|lorry|皮卡|卡车|货车/.test(text)) return 'truck'
  if (/sedan|saloon|car|auto/.test(text)) return 'sedan'
  return undefined
}

function vehicleStyleFor(input: PartComposeInput, part?: PartComposePartInput): VehicleStyle {
  return (
    normalizeVehicleStyle(part?.vehicleStyle) ??
    normalizeVehicleStyle(part?.style) ??
    normalizeVehicleStyle(part?.variant) ??
    normalizeVehicleStyle(partIntentText(input, part)) ??
    'sedan'
  )
}

function vehicleSizeScale(part: PartComposePartInput): number {
  return clamp(part.sizeScale, 1, 0.2, 2)
}

const VEHICLE_STYLE_DEFAULTS: Record<
  VehicleStyle,
  {
    length: number
    width: number
    heightRatio: number
    bodyHeightRatio: number
    cabinHeightRatio: number
    cabinLengthRatio: number
    cabinWidthRatio: number
    cabinXRatio: number
    cabinTopScale: number
    wheelRadiusRatio: number
    wheelbaseRatio: number
    trackRatio: number
    groundClearanceRatio: number
  }
> = {
  sedan: {
    length: 4.4,
    width: 1.8,
    heightRatio: 0.31,
    bodyHeightRatio: 0.36,
    cabinHeightRatio: 0.3,
    cabinLengthRatio: 0.42,
    cabinWidthRatio: 0.74,
    cabinXRatio: -0.05,
    cabinTopScale: 0.78,
    wheelRadiusRatio: 0.078,
    wheelbaseRatio: 0.72,
    trackRatio: 0.9,
    groundClearanceRatio: 0.15,
  },
  suv: {
    length: 4.65,
    width: 1.95,
    heightRatio: 0.38,
    bodyHeightRatio: 0.42,
    cabinHeightRatio: 0.44,
    cabinLengthRatio: 0.46,
    cabinWidthRatio: 0.82,
    cabinXRatio: -0.04,
    cabinTopScale: 0.9,
    wheelRadiusRatio: 0.088,
    wheelbaseRatio: 0.72,
    trackRatio: 0.92,
    groundClearanceRatio: 0.18,
  },
  sports: {
    length: 4.35,
    width: 1.9,
    heightRatio: 0.25,
    bodyHeightRatio: 0.34,
    cabinHeightRatio: 0.34,
    cabinLengthRatio: 0.32,
    cabinWidthRatio: 0.72,
    cabinXRatio: -0.12,
    cabinTopScale: 0.62,
    wheelRadiusRatio: 0.095,
    wheelbaseRatio: 0.76,
    trackRatio: 0.94,
    groundClearanceRatio: 0.11,
  },
  van: {
    length: 4.7,
    width: 1.9,
    heightRatio: 0.42,
    bodyHeightRatio: 0.48,
    cabinHeightRatio: 0.46,
    cabinLengthRatio: 0.62,
    cabinWidthRatio: 0.86,
    cabinXRatio: -0.04,
    cabinTopScale: 0.94,
    wheelRadiusRatio: 0.075,
    wheelbaseRatio: 0.7,
    trackRatio: 0.88,
    groundClearanceRatio: 0.14,
  },
  truck: {
    length: 5.2,
    width: 1.95,
    heightRatio: 0.36,
    bodyHeightRatio: 0.38,
    cabinHeightRatio: 0.42,
    cabinLengthRatio: 0.32,
    cabinWidthRatio: 0.8,
    cabinXRatio: 0.18,
    cabinTopScale: 0.86,
    wheelRadiusRatio: 0.087,
    wheelbaseRatio: 0.74,
    trackRatio: 0.92,
    groundClearanceRatio: 0.18,
  },
}

function normalizePartInput(part: PartComposePartInput): PartComposePartInput {
  const kind = normalizedPartKind(part)
  const rawKind = `${part.kind ?? part.partType ?? part.type ?? ''}`.toLowerCase()
  const rawParams =
    typeof part.params === 'object' && part.params !== null && !Array.isArray(part.params)
      ? part.params
      : {}
  const rawDimensions =
    typeof part.dimensions === 'object' &&
    part.dimensions !== null &&
    !Array.isArray(part.dimensions)
      ? part.dimensions
      : {}
  const dimensionDefaults: Partial<PartComposePartInput> = {}
  for (const key of [
    'length',
    'width',
    'depth',
    'height',
    'diameter',
    'radius',
    'thickness',
  ] as const) {
    const value = rawDimensions[key] ?? rawParams[key]
    if (part[key] == null && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      dimensionDefaults[key] = value
    }
  }
  const styleDefaults: Partial<PartComposePartInput> = {}
  for (const key of [
    'primaryColor',
    'metalColor',
    'darkColor',
    'accentColor',
    'color',
    'cornerRadius',
    'cornerSegments',
  ] as const) {
    const value = rawParams[key]
    if (part[key] == null && value != null) {
      const typedStyleDefaults = styleDefaults as Record<string, unknown>
      typedStyleDefaults[key] = value
    }
  }
  const semanticRole =
    part.semanticRole ??
    (kind === 'wheel_set' && /bicycle|bike/.test(rawKind)
      ? 'bicycle_tire'
      : kind === 'wheel_set' && /vehicle|car|auto/.test(rawKind)
        ? 'vehicle_tire'
        : kind === 'tube_frame' && /bicycle|bike/.test(rawKind)
          ? 'bicycle_frame'
          : kind === 'fork' && /bicycle|bike/.test(rawKind)
            ? 'bicycle_fork'
            : undefined)
  return {
    ...part,
    ...dimensionDefaults,
    ...styleDefaults,
    ...(kind ? { kind } : {}),
    ...(semanticRole ? { semanticRole } : {}),
    name: part.name ?? part.partName,
  }
}

const PART_DIMENSION_KEYS = [
  'length',
  'width',
  'depth',
  'height',
  'diameter',
  'radius',
  'thickness',
] as const

type PartDimensionKey = (typeof PART_DIMENSION_KEYS)[number]

function partInputDimensions(input: PartComposeInput): Partial<Record<PartDimensionKey, number>> {
  const expected = input.geometryBrief?.expectedDimensions ?? {}
  const dimensions: Partial<Record<PartDimensionKey, number>> = {}
  for (const key of PART_DIMENSION_KEYS) {
    const value = input[key] ?? expected[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) dimensions[key] = value
  }
  return dimensions
}

function primaryDimensionPartKinds(
  input: PartComposeInput,
  parts: PartComposePartInput[],
): PartComposeKind[] {
  const present = partKinds(parts)
  if (isAircraftIntent(input)) return ['aircraft_fuselage', 'streamlined_body']

  switch (familySpecForParts(present).family) {
    case 'vehicle':
      return ['body_shell']
    case 'desk':
      return ['desk_top']
    case 'conveyor':
      return ['conveyor_frame']
    case 'pipe_system':
      return ['pipe_run']
    case 'pump':
      return ['skid_base', 'rounded_machine_body']
    case 'electrical':
      return ['electrical_cabinet']
    case 'valve':
      return ['valve_body']
    case 'bicycle':
      return ['bicycle_frame', 'tube_frame']
    default:
      return []
  }
}

function applyPartDimensionDefaults(input: PartComposeInput): PartComposeInput {
  const dimensions = partInputDimensions(input)
  if (Object.keys(dimensions).length === 0 || !input.parts?.length) return input

  const primaryKinds = primaryDimensionPartKinds(input, input.parts)
  const primaryIndex =
    primaryKinds.length > 0
      ? input.parts.findIndex((part) => {
          const kind = normalizedPartKind(part)
          return kind != null && primaryKinds.includes(kind)
        })
      : 0
  if (primaryIndex < 0) return input

  const parts = input.parts.map((part, index) => {
    if (index !== primaryIndex) return part
    const next = { ...part }
    for (const key of PART_DIMENSION_KEYS) {
      if (next[key] == null && dimensions[key] != null) next[key] = dimensions[key]
    }
    return next
  })

  return { ...input, parts }
}

function normalizePartComposeInput(input: PartComposeInput): PartComposeInput {
  return applyPartDimensionDefaults({
    ...input,
    name: input.name ?? input.partName,
    parts: input.parts?.map(normalizePartInput),
  })
}

function isRegistryPartPlanInput(input: PartComposeInput): boolean {
  return input.registryPartPlan === true || input.__registryPartPlan === true
}

function vehicleLength(part: PartComposePartInput, style: VehicleStyle = 'sedan'): number {
  return clamp(
    part.length ?? part.depth,
    VEHICLE_STYLE_DEFAULTS[style].length * vehicleSizeScale(part),
    0.3,
    6,
  )
}

function vehicleWidth(part: PartComposePartInput, style: VehicleStyle = 'sedan'): number {
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const derivedFromLength =
    part.width == null && (part.length != null || part.depth != null)
      ? vehicleLength(part, style) * (defaults.width / defaults.length)
      : undefined
  return clamp(part.width, derivedFromLength ?? defaults.width * vehicleSizeScale(part), 0.12, 2.8)
}

function vehicleOverallHeight(
  part: PartComposePartInput,
  length = vehicleLength(part),
  width = vehicleWidth(part),
  style: VehicleStyle = 'sedan',
): number {
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const scale = vehicleSizeScale(part)
  const derivedFromLength =
    part.overallHeight == null && part.height == null && (part.length != null || part.depth != null)
      ? length * defaults.heightRatio
      : undefined
  return clamp(
    part.overallHeight ?? part.height,
    derivedFromLength ?? Math.max(width * 0.66, length * defaults.heightRatio, 0.46 * scale),
    0.22,
    2.4,
  )
}

function vehicleWheelRadius(
  part: PartComposePartInput,
  length: number,
  width: number,
  overallHeight: number,
  style: VehicleStyle = 'sedan',
): number {
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const scale = vehicleSizeScale(part)
  return clamp(
    part.radius ?? part.wheelRadius,
    Math.min(length * defaults.wheelRadiusRatio, width * 0.22, overallHeight * 0.28),
    0.04 * scale,
    0.6,
  )
}

function numericDimension(input: PartComposeInput, key: PartDimensionKey): number | undefined {
  const direct = input[key]
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct
  const value = input.geometryBrief?.expectedDimensions?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function isCompleteBicycleParts(parts: PartComposePartInput[]): boolean {
  const present = partKinds(parts)
  return familySpecForParts(present).family === 'bicycle'
}

function bicycleLayoutBase(part: PartComposePartInput): PartComposePartInput {
  const {
    position: _position,
    rotation: _rotation,
    connectTo: _connectTo,
    connectPoint: _connectPoint,
    childPoint: _childPoint,
    centeredOn: _centeredOn,
    alignAbove: _alignAbove,
    alignBeside: _alignBeside,
    offsetFrom: _offsetFrom,
    offsetDirection: _offsetDirection,
    offsetDistance: _offsetDistance,
    around: _around,
    aroundIndex: _aroundIndex,
    aroundCount: _aroundCount,
    aroundRadius: _aroundRadius,
    aroundAngle: _aroundAngle,
    aroundStartAngle: _aroundStartAngle,
    aroundAxis: _aroundAxis,
    array: _array,
    arrayAxis: _arrayAxis,
    arrayOffset: _arrayOffset,
    relationGap: _relationGap,
    anchor: _anchor,
    childAnchor: _childAnchor,
    side: _side,
    ...rest
  } = part
  return rest
}

function firstBicyclePart(
  parts: PartComposePartInput[],
  kinds: PartComposeKind[],
): PartComposePartInput | undefined {
  return parts.find((part) => {
    const kind = normalizedPartKind(part)
    return kind != null && kinds.includes(kind)
  })
}

const BICYCLE_FORK_AXLE_FORWARD_RATIO = 0.2
const BICYCLE_FORK_CROWN_RISE_RATIO = 0.35
const BICYCLE_FORK_AXLE_DROP_RATIO = 0.55
const BICYCLE_STEERER_FORWARD_RATIO = 0.08
const BICYCLE_STEERER_RISE_RATIO = 0.16
const BICYCLE_HANDLEBAR_STEM_REACH_RATIO = 0.08

function applyBicycleLayoutDefaults(
  parts: PartComposePartInput[],
  input: PartComposeInput,
): PartComposePartInput[] {
  if (!isCompleteBicycleParts(parts)) return parts

  const wheelPart = firstBicyclePart(parts, ['wheel_set', 'wheel'])
  const framePart = firstBicyclePart(parts, ['tube_frame'])
  const totalLength = numericDimension(input, 'length')
  const totalHeight = numericDimension(input, 'height')
  const totalWidth = numericDimension(input, 'width')
  const requestedRadius = wheelPart?.radius ?? wheelPart?.wheelRadius ?? input.radius
  const defaultWheelRadius =
    totalHeight != null
      ? Math.min(totalHeight * 0.3, totalLength != null ? totalLength * 0.18 : 0.3)
      : totalLength != null
        ? Math.min(totalLength * 0.17, 0.32)
        : 0.22
  const maxWheelRadius =
    totalHeight != null
      ? Math.min(totalHeight * 0.32, totalLength != null ? totalLength * 0.19 : 0.32)
      : totalLength != null
        ? Math.min(totalLength * 0.17, 0.32)
        : 0.32
  const wheelRadius = clamp(requestedRadius, defaultWheelRadius, 0.08, maxWheelRadius)
  const fallbackWheelbase =
    totalLength != null ? Math.max(totalLength - wheelRadius * 2, totalLength * 0.54) : 0.86
  const wheelbase = clamp(
    wheelPart?.length ?? (totalLength == null ? framePart?.length : undefined),
    fallbackWheelbase,
    Math.max(wheelRadius * 2.2, 0.35),
    3,
  )
  const frameHeight = clamp(
    totalHeight == null ? framePart?.height : undefined,
    totalHeight != null ? totalHeight * 0.68 : Math.max(0.42, wheelRadius * 1.9),
    0.18,
    1.2,
  )
  const forkHeight = clamp(undefined, Math.max(frameHeight * 0.95, wheelRadius * 1.25), 0.18, 1.2)
  const handlebarWidth = clamp(totalWidth, 0.42, 0.18, 1.2)
  const forkSpread = clamp(totalWidth != null ? totalWidth * 0.18 : undefined, 0.08, 0.03, 0.22)
  const wheelY = wheelRadius
  const frameCenterY = wheelY + frameHeight * 0.52
  const saddleY = wheelY + frameHeight * 1.08
  const forkCenter: Vec3 = [
    wheelbase / 2 - forkHeight * BICYCLE_FORK_AXLE_FORWARD_RATIO,
    wheelY + forkHeight * BICYCLE_FORK_AXLE_DROP_RATIO,
    0,
  ]
  const forkCrown: Vec3 = [
    forkCenter[0],
    forkCenter[1] + forkHeight * BICYCLE_FORK_CROWN_RISE_RATIO,
    0,
  ]
  const steererTop: Vec3 = [
    forkCrown[0] + forkHeight * BICYCLE_STEERER_FORWARD_RATIO,
    forkCrown[1] + forkHeight * BICYCLE_STEERER_RISE_RATIO,
    0,
  ]
  const handlebarStemDrop = clamp(undefined, forkHeight * 0.14, 0.055, 0.16)
  const handlebarY = steererTop[1] + handlebarStemDrop
  const handlebarX = steererTop[0] + handlebarWidth * BICYCLE_HANDLEBAR_STEM_REACH_RATIO
  const chainSpan = clamp(undefined, wheelbase * 0.52, 0.28, 1.4)
  const bottomBracketX = -wheelbase * 0.02

  const laidOut: PartComposePartInput[] = []
  let hasWheelSet = false
  for (const part of parts) {
    const kind = normalizedPartKind(part)
    if (!kind) {
      laidOut.push(part)
      continue
    }
    switch (kind) {
      case 'wheel_set':
      case 'wheel':
        if (hasWheelSet) continue
        hasWheelSet = true
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'wheel_set',
          count: 2,
          axis: 'z',
          length: wheelbase,
          radius: wheelRadius,
          semanticRole: 'bicycle_tire',
          sourcePartKind: 'bicycle_wheels',
          position: [0, wheelY, 0] as Vec3,
        })
        break
      case 'tube_frame':
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'tube_frame',
          length: wheelbase,
          height: frameHeight,
          semanticRole: 'bicycle_frame',
          position: [0, frameCenterY, 0] as Vec3,
        })
        break
      case 'fork':
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'fork',
          height: forkHeight,
          width: forkSpread,
          semanticRole: 'bicycle_fork',
          position: forkCenter,
        })
        break
      case 'handlebar':
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'handlebar',
          width: handlebarWidth,
          height: handlebarStemDrop,
          position: [handlebarX, handlebarY, 0] as Vec3,
        })
        break
      case 'saddle':
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'saddle',
          position: [-wheelbase * 0.14, saddleY, 0] as Vec3,
        })
        break
      case 'chain_loop':
        laidOut.push({
          ...bicycleLayoutBase(part),
          kind: 'chain_loop',
          length: chainSpan,
          radius: wheelRadius * 0.3,
          position: [bottomBracketX - chainSpan / 2, wheelY + frameHeight * 0.32, 0.018] as Vec3,
        })
        break
      default:
        laidOut.push(part)
        break
    }
  }
  return laidOut
}

function applyVehicleLayoutDefaults(
  parts: PartComposePartInput[],
  input: PartComposeInput,
): PartComposePartInput[] {
  const body = parts.find((part) => normalizedPartKind(part) === 'body_shell')
  if (!body) return parts

  const style = vehicleStyleFor(input, body)
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const bodyLength = vehicleLength(body, style)
  const bodyWidth = vehicleWidth(body, style)
  const overallHeight = vehicleOverallHeight(body, bodyLength, bodyWidth, style)
  const groundClearance = Math.min(overallHeight * defaults.groundClearanceRatio, bodyWidth * 0.22)
  const bodyCenter = body.position ?? [0, groundClearance + overallHeight * 0.5, 0]
  const baseY = bodyCenter[1] - overallHeight / 2
  const wheelRadius = vehicleWheelRadius(body, bodyLength, bodyWidth, overallHeight, style)

  return parts.map((part) => {
    const kind = normalizedPartKind(part)
    switch (kind) {
      case 'body_shell':
        return {
          ...part,
          vehicleStyle: style,
          length: bodyLength,
          width: bodyWidth,
          height: overallHeight,
          position: bodyCenter,
        }
      case 'wheel_set': {
        const longitudinal = Math.abs(
          Number(part.frontX ?? part.frontZ ?? bodyLength * 0.36) -
            Number(part.rearX ?? part.rearZ ?? -bodyLength * 0.36),
        )
        return {
          ...part,
          length:
            Number.isFinite(longitudinal) && longitudinal > 0
              ? longitudinal
              : bodyLength * defaults.wheelbaseRatio,
          width: part.width ?? bodyWidth * defaults.trackRatio,
          radius: part.radius ?? part.wheelRadius ?? wheelRadius,
          wheelWidth: part.wheelWidth ?? part.depth ?? wheelRadius * 0.55,
          semanticRole: part.semanticRole ?? 'vehicle_tire',
          position: [bodyCenter[0], baseY + wheelRadius, bodyCenter[2]] as Vec3,
        }
      }
      case 'window_strip':
        return {
          ...part,
          vehicleStyle: style,
          semanticRole: part.semanticRole ?? 'vehicle_window',
          variant: part.variant ?? 'vehicle_glasshouse',
          length: part.length ?? bodyLength * defaults.cabinLengthRatio,
          width: part.width ?? bodyWidth * defaults.cabinWidthRatio,
          height: part.height ?? overallHeight * 0.24,
          position: [
            bodyCenter[0] + bodyLength * defaults.cabinXRatio,
            baseY + overallHeight * 0.72,
            bodyCenter[2],
          ] as Vec3,
        }
      case 'light_pair':
        return {
          ...part,
          width: part.width ?? bodyWidth,
          semanticRole: part.semanticRole ?? 'headlight',
          radius: part.radius ?? Math.min(bodyWidth * 0.045, overallHeight * 0.055),
          position: [
            bodyCenter[0] + bodyLength * 0.49,
            baseY + overallHeight * 0.36,
            bodyCenter[2],
          ] as Vec3,
        }
      case 'bar_pair':
        return {
          ...part,
          width: part.width ?? part.length ?? bodyWidth * 0.96,
          height: part.height ?? overallHeight * 0.055,
          position: [
            bodyCenter[0] + bodyLength * 0.51,
            baseY + overallHeight * 0.26,
            bodyCenter[2],
          ] as Vec3,
        }
      default:
        return part
    }
  })
}

function hasExplicitPlacement(part: PartComposePartInput): boolean {
  return (
    part.position != null ||
    part.connectTo != null ||
    part.alignAbove != null ||
    part.alignBeside != null ||
    part.centeredOn != null ||
    part.around != null
  )
}

function hasExplicitSpatialPlacement(part: PartComposePartInput): boolean {
  return (
    part.position != null ||
    part.alignAbove != null ||
    part.alignBeside != null ||
    part.centeredOn != null ||
    part.around != null
  )
}

function partReference(part: PartComposePartInput, fallbackKind: PartComposeKind): string {
  return part.id ?? part.name ?? part.partName ?? fallbackKind
}

function applyContextualPartDefaults(
  parts: PartComposePartInput[],
  _input: PartComposeInput,
): PartComposePartInput[] {
  const firstByKind = (kind: PartComposeKind) =>
    parts.find((part) => normalizedPartKind(part) === kind)
  const fanBlades = firstByKind('radial_blades')
  const volute = firstByKind('volute_casing')
  const conveyorFrame = firstByKind('conveyor_frame')

  return parts.map((part) => {
    const kind = normalizedPartKind(part)
    if (!kind) return part

    if (kind === 'protective_grill' && fanBlades) {
      const bladeRadius = clamp(fanBlades.bladeRadius ?? fanBlades.radius, 0.28, 0.05, 1.4)
      return {
        ...part,
        radius: part.radius ?? bladeRadius * 1.18,
        depth: part.depth ?? Math.max(0.05, bladeRadius * 0.24),
        ...(hasExplicitPlacement(part)
          ? {}
          : { centeredOn: partReference(fanBlades, 'radial_blades') }),
      }
    }

    if (kind === 'inlet_port' && volute && !hasExplicitSpatialPlacement(part)) {
      return {
        ...part,
        connectTo: partReference(volute, 'volute_casing'),
        connectPoint: part.connectPoint ?? 'inlet',
        childPoint: part.childPoint ?? 'base',
        axis: part.axis ?? 'z',
      }
    }

    if (kind === 'outlet_port' && volute && !hasExplicitSpatialPlacement(part)) {
      return {
        ...part,
        connectTo: partReference(volute, 'volute_casing'),
        connectPoint: part.connectPoint ?? 'outlet',
        childPoint: part.childPoint ?? 'base',
        axis: part.axis ?? 'x',
      }
    }

    if ((kind === 'roller_array' || kind === 'belt_surface') && conveyorFrame) {
      return {
        ...part,
        length: part.length ?? conveyorFrame.length,
        width: part.width ?? conveyorFrame.width,
        ...(hasExplicitPlacement(part)
          ? {}
          : {
              alignAbove: partReference(conveyorFrame, 'conveyor_frame'),
              relationGap: part.relationGap ?? (kind === 'belt_surface' ? 0.04 : 0.015),
            }),
      }
    }

    return part
  })
}

function composeCircularBase(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  index: number,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.28, 0.05, 2)
  const height = clamp(part.height ?? part.depth, 0.08, 0.01, 0.4)
  const center = add(origin, part.position ?? [0, height / 2, 0])
  return [
    {
      kind: 'cylinder',
      name: part.name ?? `${input.name ?? 'object'} circular base ${index + 1}`,
      position: center,
      axis: 'y',
      radius,
      height,
      radialSegments: ringSegments(input.detail),
      material: partMaterial(part, material(input.darkColor ?? '#24262b', 0.72, 0.18)),
    },
  ]
}

function composeVerticalPole(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  index: number,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.025, 0.005, 2)
  const height = clamp(part.height ?? part.length, 1, 0.05, 50)
  const center = add(origin, part.position ?? [0, height / 2 + 0.08, 0])
  return [
    {
      kind: 'cylinder',
      name: part.name ?? `${input.name ?? 'object'} vertical pole ${index + 1}`,
      position: center,
      axis: 'y',
      radius,
      height,
      radialSegments: 24,
      material: partMaterial(part, material(input.metalColor ?? '#b9bec7', 0.32, 0.68)),
    },
  ]
}

function composeMotorHousing(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  index: number,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.11, 0.03, 0.5)
  const depth = clamp(part.depth ?? part.length ?? part.height, 0.16, 0.03, 0.8)
  const center = add(origin, part.position ?? [0, 1.18, -depth * 0.15])
  const body = partMaterial(part, material(input.darkColor ?? '#30343b', 0.56, 0.25))
  return [
    {
      kind: 'cylinder',
      name: part.name ?? `${input.name ?? 'object'} motor housing ${index + 1}`,
      position: center,
      axis: 'z',
      radius,
      height: depth,
      radialSegments: ringSegments(input.detail),
      material: body,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} rear motor dome`,
      position: [center[0], center[1], center[2] - depth * 0.48],
      radius: 1,
      scale: [radius * 0.95, radius * 0.95, depth * 0.32],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: body,
    },
  ]
}

function composeRadialBlades(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 1.18, 0.04])
  const count = clampInt(part.count, 3, 2, 8)
  const radius = clamp(part.bladeRadius ?? part.radius, 0.28, 0.05, 1.4)
  const bladeWidth = clamp(
    part.bladeWidth ?? part.width,
    radius * 0.26,
    radius * 0.08,
    radius * 0.55,
  )
  const pitch = clamp(part.bladePitch, 0.24, -0.65, 0.65)
  const sweep = clamp(part.bladeSweep, bladeWidth * 0.32, -bladeWidth, bladeWidth)
  const bladeLength = radius * 0.78
  const rootRadius = radius * 0.18
  const bladeCenterRadius = rootRadius + bladeLength / 2
  const bladeDepth = clamp(part.depth ?? part.height, 0.018, 0.004, 0.08)
  const rootWidth = bladeWidth * 0.42
  const bladeMat = partMaterial(part, material(input.accentColor ?? '#8ec5ff', 0.42, 0.02, 0.82))
  const rootMat = material(input.darkColor ?? '#25272c', 0.48, 0.35)
  const shapes: PrimitiveShapeInput[] = []
  const profile: [number, number][] = [
    [0, -rootWidth * 0.5],
    [bladeLength * 0.16, -bladeWidth * 0.42 + sweep * 0.12],
    [bladeLength * 0.52, -bladeWidth * 0.55 + sweep * 0.38],
    [bladeLength * 0.94, -bladeWidth * 0.25 + sweep],
    [bladeLength, bladeWidth * 0.08 + sweep * 0.92],
    [bladeLength * 0.72, bladeWidth * 0.44 + sweep * 0.46],
    [bladeLength * 0.26, bladeWidth * 0.36 + sweep * 0.14],
    [0, rootWidth * 0.5],
  ]

  for (let i = 0; i < count; i += 1) {
    const angle = angularStep(i, count, -Math.PI / 2)
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} blade ${i + 1}`,
      position: radialPoint(
        center,
        angle,
        bladeCenterRadius,
        Math.sin(i * 1.7) * bladeDepth * 0.25,
      ),
      rotation: radialExtrudeRotationInLocalPlane(angle, pitch),
      profile,
      depth: bladeDepth,
      bevelSize: bladeDepth * 0.16,
      bevelThickness: bladeDepth * 0.18,
      bevelSegments: 2,
      curveSegments: 10,
      material: bladeMat,
    })
    shapes.push({
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} blade root ${i + 1}`,
      position: radialPoint(center, angle, rootRadius * 0.82, -bladeDepth * 0.08),
      rotation: [0, 0, angle],
      axis: 'x',
      radius: rootWidth * 0.22,
      height: rootRadius * 1.2,
      capSegments: 4,
      radialSegments: 16,
      material: rootMat,
    })
  }

  shapes.push({
    kind: 'cylinder',
    name: `${part.name ?? input.name ?? 'object'} blade hub`,
    position: center,
    axis: 'z',
    radius: radius * 0.16,
    height: clamp(part.depth, 0.055, 0.015, 0.2),
    radialSegments: 32,
    material: rootMat,
  })

  return shapes
}

function composeFanBladeArray(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 1.18, 0.04])
  const count = clampInt(part.count ?? part.aroundCount, 1, 1, 16)
  const bladeLength = clamp(part.length ?? part.bladeRadius ?? part.radius, 0.24, 0.04, 1.2)
  const bladeWidth = clamp(
    part.bladeWidth ?? part.width,
    bladeLength * 0.26,
    bladeLength * 0.06,
    bladeLength * 0.55,
  )
  const thickness = clamp(part.thickness ?? part.depth ?? part.height, 0.018, 0.003, 0.08)
  const pitch = clamp(part.pitch ?? part.bladePitch, 0.24, -0.8, 0.8)
  const sweep = clamp(part.bladeSweep, bladeWidth * 0.32, -bladeWidth, bladeWidth)
  const hubRadius = clamp(part.wireRadius, bladeLength * 0.22, 0.01, bladeLength * 0.45)
  const rootWidth = clamp(part.rootWidth, bladeWidth * 0.42, bladeWidth * 0.16, bladeWidth)
  const profile: [number, number][] = [
    [0, -rootWidth * 0.5],
    [bladeLength * 0.18, -bladeWidth * 0.42 + sweep * 0.12],
    [bladeLength * 0.54, -bladeWidth * 0.55 + sweep * 0.38],
    [bladeLength * 0.96, -bladeWidth * 0.25 + sweep],
    [bladeLength, bladeWidth * 0.08 + sweep * 0.92],
    [bladeLength * 0.72, bladeWidth * 0.44 + sweep * 0.46],
    [bladeLength * 0.24, bladeWidth * 0.36 + sweep * 0.14],
    [0, rootWidth * 0.5],
  ]
  const mat = partMaterial(
    part,
    material(
      part.primaryColor ?? input.accentColor ?? input.primaryColor ?? '#8ec5ff',
      0.42,
      0.05,
      0.86,
    ),
  )
  const hubMat = material(input.darkColor ?? '#25272c', 0.48, 0.35)
  const radialCenter = hubRadius + bladeLength * 0.5
  const baseId = part.id ?? part.name ?? part.partName ?? 'fan_blade'
  const shapes: PrimitiveShapeInput[] = []

  for (let index = 0; index < count; index += 1) {
    const angle = part.aroundAngle ?? angularStep(index, count, -Math.PI / 2)
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} fan blade ${index + 1}`,
      semanticRole: part.semanticRole ?? 'fan_blade',
      semanticGroup: part.semanticGroup ?? 'fan_blades',
      sourcePartKind: part.sourcePartKind ?? 'fan_blade',
      sourcePartId: count > 1 ? `${baseId}_${index + 1}` : baseId,
      editableHints: {
        primaryDimension: 'length',
        canScale: ['primary', 'length', 'width', 'thickness'],
        minFactor: 0.35,
        maxFactor: 2.2,
      },
      position: radialPoint(center, angle, radialCenter, Math.sin(index * 1.7) * thickness * 0.2),
      rotation: radialExtrudeRotationInLocalPlane(angle, pitch),
      profile,
      depth: thickness,
      bevelSize: thickness * 0.16,
      bevelThickness: thickness * 0.18,
      bevelSegments: 2,
      curveSegments: 10,
      material: mat,
    })
  }

  if (part.includeHub !== false && count > 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} fan blade hub`,
      semanticRole: 'fan_hub',
      semanticGroup: part.semanticGroup ?? 'fan_blades',
      sourcePartKind: part.sourcePartKind ?? 'fan_blade',
      sourcePartId: `${baseId}_hub`,
      position: center,
      axis: 'z',
      radius: hubRadius,
      height: Math.max(thickness * 2.4, 0.045),
      radialSegments: 32,
      material: hubMat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeProtectiveGrill(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const detailLevel = partDetailLevel(input, part)
  const segmentDetail =
    detailLevel === 'high' ? 'high' : detailLevel === 'low' ? 'low' : input.detail
  const defaultRingCount = detailLevel === 'high' ? 5 : detailLevel === 'low' ? 3 : 4
  const defaultSpokeCount = detailLevel === 'high' ? 24 : detailLevel === 'low' ? 12 : 18
  const center = add(origin, part.position ?? [0, 1.18, 0.04])
  const radius = clamp(part.radius, 0.36, 0.08, 2)
  const cageDepth = clamp(part.depth, 0.12, 0.005, 0.6)
  const domeDepth = clamp(part.domeDepth, cageDepth * 0.72, 0.005, radius * 0.85)
  const ringCount = clampInt(part.ringCount ?? part.count, defaultRingCount, 1, 8)
  const spokeCount = clampInt(part.spokeCount, defaultSpokeCount, 6, 36)
  const wireRadius = clamp(part.wireRadius, radius * 0.018, 0.002, 0.05)
  const grillMat = partMaterial(part, material(input.metalColor ?? '#d1d5db', 0.38, 0.62))
  const shapes: PrimitiveShapeInput[] = []
  const frontZForRatio = (ratio: number) => center[2] + domeDepth * (1 - ratio * ratio)
  const ringTubularSegments = ringSegments(segmentDetail)
  const ringRadialSegments = Math.max(12, Math.round(ringTubularSegments * 0.35))

  for (let i = 0; i < ringCount; i += 1) {
    const ratio = ringCount === 1 ? 1 : 0.22 + (i / (ringCount - 1)) * 0.78
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} grill front ring ${i + 1}`,
      position: [center[0], center[1], frontZForRatio(ratio)],
      axis: 'z',
      majorRadius: radius * ratio,
      tubeRadius: wireRadius,
      radialSegments: ringRadialSegments,
      tubularSegments: ringTubularSegments,
      material: grillMat,
    })
  }

  shapes.push(
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} grill rear outer ring`,
      position: [center[0], center[1], center[2] - cageDepth],
      axis: 'z',
      majorRadius: radius,
      tubeRadius: wireRadius,
      radialSegments: ringRadialSegments,
      tubularSegments: ringTubularSegments,
      material: grillMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} grill center cap`,
      position: [center[0], center[1], frontZForRatio(0.08) + wireRadius * 0.4],
      axis: 'z',
      radius: radius * 0.13,
      height: wireRadius * 2.2,
      radialSegments: Math.max(24, Math.round(ringTubularSegments * 0.6)),
      material: grillMat,
    },
  )

  if (detailLevel !== 'low') {
    shapes.splice(shapes.length - 1, 0, {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} grill rear inner support ring`,
      position: [center[0], center[1], center[2] - cageDepth * 0.82],
      axis: 'z',
      majorRadius: radius * 0.42,
      tubeRadius: wireRadius * 0.82,
      radialSegments: ringRadialSegments,
      tubularSegments: Math.max(24, Math.round(ringTubularSegments * 0.75)),
      material: grillMat,
    })
  }

  const innerRatio = 0.12
  const spokeStartZ = frontZForRatio(innerRatio)
  const spokeEndZ = frontZForRatio(1)
  const spokeRadialLength = radius * (1 - innerRatio)
  const spokeDepth = spokeStartZ - spokeEndZ
  const spokeLength = Math.hypot(spokeRadialLength, spokeDepth)
  const spokeTilt = -Math.atan2(spokeDepth, spokeRadialLength)
  const spokeMidRadius = radius * (innerRatio + (1 - innerRatio) / 2)
  const spokeMidZ = (spokeStartZ + spokeEndZ) / 2

  for (let i = 0; i < spokeCount; i += 1) {
    const angle = angularStep(i, spokeCount)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} grill spoke ${i + 1}`,
      position: [center[0] + dx * spokeMidRadius, center[1] + dy * spokeMidRadius, spokeMidZ],
      rotation: [0, spokeTilt, angle],
      axis: 'x',
      radius: wireRadius * 0.72,
      height: spokeLength,
      radialSegments: 8,
      material: grillMat,
    })
  }

  const sideRibCount =
    detailLevel === 'high'
      ? Math.max(12, Math.min(18, Math.round(spokeCount / 2)))
      : Math.max(6, Math.min(12, Math.round(spokeCount / 2)))
  for (let i = 0; i < sideRibCount; i += 1) {
    const angle = angularStep(i, sideRibCount)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} grill side rib ${i + 1}`,
      position: [center[0] + dx * radius, center[1] + dy * radius, center[2] - cageDepth / 2],
      axis: 'z',
      radius: wireRadius * 0.75,
      height: cageDepth,
      radialSegments: 8,
      material: grillMat,
    })
  }

  return shapes
}

function partDetailLevel(input: PartComposeInput, part: PartComposePartInput): PartComposeDetail {
  const raw =
    `${part.detailLevel ?? part.grillDetailLevel ?? part.detail ?? input.detail ?? ''}`.toLowerCase()
  if (/(low|simple|coarse|light|\u4f4e|\u7b80)/i.test(raw)) return 'low'
  if (/(high|fine|detailed|dense|\u9ad8|\u7ec6|\u5bc6)/i.test(raw)) return 'high'
  return 'medium'
}

function detailDefaultInt(
  input: PartComposeInput,
  part: PartComposePartInput,
  values: Record<PartComposeDetail, number>,
): number {
  return values[partDetailLevel(input, part)]
}

function detailSegmentLevel(
  input: PartComposeInput,
  part: PartComposePartInput,
): PartComposeDetail {
  const detailLevel = partDetailLevel(input, part)
  if (detailLevel !== 'medium') return detailLevel
  const raw = `${input.detail ?? ''}`.toLowerCase()
  if (/(low|simple|coarse|light|\u4f4e|\u7b80)/i.test(raw)) return 'low'
  if (/(high|fine|detailed|dense|\u9ad8|\u7ec6|\u5bc6)/i.test(raw)) return 'high'
  return 'medium'
}

function composePyramid(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length ?? part.width ?? part.diameter, 0.6, 0.02, 20)
  const width = clamp(part.width ?? part.length ?? part.diameter, length, 0.02, 20)
  const height = clamp(part.height ?? part.depth, 0.8, 0.02, 20)
  const requestedRadius = part.radius ?? (part.diameter != null ? part.diameter / 2 : undefined)
  const radius = clamp(requestedRadius, Math.max(length, width) / 2, 0.01, 20)
  const center = add(origin, part.position ?? [0, height / 2, 0])
  const scale: Vec3 = [length / (radius * 2), 1, width / (radius * 2)]
  const topScale = pyramidTopScale(part, length, width)
  const isTruncated = part.truncated === true || topScale != null || part.topRadius != null
  const topRadius = isTruncated
    ? clamp(part.topRadius, radius * (topScale ?? 0.35), 0.005, radius * 0.98)
    : 0

  // Three.js CylinderGeometry with 4 segments places the first vertex at +X,
  // making edges face front/back/left/right (diamond orientation).
  // Rotating 45° (π/4) around Y makes the flat faces front-facing (correct pyramid look).
  const pyramidRotation: Vec3 = part.rotation
    ? [part.rotation[0], (part.rotation[1] ?? 0) + Math.PI / 4, part.rotation[2]]
    : [0, Math.PI / 4, 0]

  return [
    {
      kind: isTruncated ? 'frustum' : 'cone',
      name: `${part.name ?? input.name ?? 'object'} pyramid`,
      semanticRole: part.semanticRole ?? 'pyramid',
      sourcePartKind: part.sourcePartKind ?? 'pyramid',
      position: center,
      rotation: pyramidRotation,
      axis: part.axis ?? 'y',
      ...(isTruncated ? { radiusBottom: radius, radiusTop: topRadius } : { radius }),
      height,
      scale,
      radialSegments: 4,
      material: partMaterial(part, material(input.primaryColor ?? '#c08457', 0.56, 0.18)),
    },
  ]
}

function pyramidTopScale(
  part: PartComposePartInput,
  length: number,
  width: number,
): number | undefined {
  if (typeof part.topScale === 'number' && Number.isFinite(part.topScale)) {
    return clamp(part.topScale, 0.35, 0.02, 0.95)
  }
  if (Array.isArray(part.topScale)) {
    const [xScale, zScale] = part.topScale
    const scales = [xScale, zScale].filter(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
    if (scales.length > 0) {
      return clamp(scales.reduce((sum, value) => sum + value, 0) / scales.length, 0.35, 0.02, 0.95)
    }
  }

  const lengthScale =
    typeof part.topLength === 'number' && Number.isFinite(part.topLength)
      ? part.topLength / length
      : undefined
  const widthScale =
    typeof part.topWidth === 'number' && Number.isFinite(part.topWidth)
      ? part.topWidth / width
      : undefined
  const scales = [lengthScale, widthScale].filter((value): value is number => value != null)
  if (scales.length === 0) return undefined
  return clamp(scales.reduce((sum, value) => sum + value, 0) / scales.length, 0.35, 0.02, 0.95)
}

function composeSupportBracket(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 1.08, -0.02])
  const width = clamp(part.width ?? part.length, 0.26, 0.04, 1)
  const height = clamp(part.height, 0.18, 0.04, 0.8)
  const depth = clamp(part.depth, 0.05, 0.01, 0.3)
  const r = clamp(part.radius ?? part.wireRadius, 0.018, 0.004, 0.08)
  const bracketMat = partMaterial(part, material(input.metalColor ?? '#9ca3af', 0.34, 0.72))
  return [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} bracket left arm`,
      position: [center[0] - width / 2, center[1] + height / 2, center[2]],
      axis: 'y',
      radius: r,
      height,
      radialSegments: 16,
      material: bracketMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} bracket right arm`,
      position: [center[0] + width / 2, center[1] + height / 2, center[2]],
      axis: 'y',
      radius: r,
      height,
      radialSegments: 16,
      material: bracketMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} bracket crossbar`,
      position: [center[0], center[1], center[2]],
      axis: 'x',
      radius: r,
      height: width,
      radialSegments: 16,
      material: bracketMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} bracket neck block`,
      position: [center[0], center[1] - depth * 0.2, center[2]],
      length: width * 0.32,
      width: depth,
      height: depth,
      cornerRadius: depth * 0.2,
      cornerSegments: 4,
      material: bracketMat,
    },
  ]
}

function composeControlKnob(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  index: number,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.035, 0.005, 0.2)
  const depth = clamp(part.depth ?? part.height, 0.025, 0.005, 0.15)
  const center = add(origin, part.position ?? [0.12, 1.18, -0.04])
  return [
    {
      kind: 'cylinder',
      name: part.name ?? `${input.name ?? 'object'} control knob ${index + 1}`,
      position: center,
      axis: 'x',
      radius,
      height: depth,
      radialSegments: 24,
      material: partMaterial(part, material(input.darkColor ?? '#25272c', 0.5, 0.2)),
    },
  ]
}

function composeVentSlats(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  kind: 'vent_slats' | 'vent_grill' = 'vent_slats',
): PrimitiveShapeInput[] {
  const detailLevel = partDetailLevel(input, part)
  const center = add(origin, part.position ?? [0, 0.5, 0.02])
  const defaultCount =
    kind === 'vent_grill'
      ? detailDefaultInt(input, part, { low: 5, medium: 8, high: 12 })
      : detailDefaultInt(input, part, { low: 4, medium: 6, high: 10 })
  const count = clampInt(part.slatCount ?? part.count, defaultCount, 2, 20)
  const width = clamp(part.width ?? part.length, 0.5, 0.05, 3)
  const height = clamp(part.height, 0.018, 0.004, 0.08)
  const spacing = clamp(part.depth, 0.055, 0.01, 0.3)
  const panelHeight = Math.max(height * 2.4, spacing * (count - 1) + height * 2.4)
  const frameWidth = clamp(
    part.wireRadius ?? part.thickness,
    Math.min(width, panelHeight) * 0.035,
    0.004,
    0.08,
  )
  const panelDepth = clamp(part.thickness ?? part.wireRadius, height * 0.7, 0.003, 0.08)
  const slatMat = partMaterial(part, material(input.darkColor ?? '#4b5563', 0.62, 0.08))
  const frameMat = material(input.metalColor ?? '#9ca3af', 0.42, 0.48)
  const recessMat = material(input.darkColor ?? '#111827', 0.7, 0.04)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} vent recess panel`,
      position: [center[0], center[1], center[2] - panelDepth * 0.45],
      length: width + frameWidth * 2.4,
      width: panelHeight + frameWidth * 2.2,
      thickness: panelDepth,
      cornerRadius: frameWidth * 1.2,
      cornerSegments: detailLevel === 'high' ? 4 : detailLevel === 'low' ? 1 : 3,
      material: recessMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vent top frame`,
      position: [center[0], center[1] + panelHeight / 2 + frameWidth / 2, center[2]],
      length: width + frameWidth * 2,
      width: frameWidth,
      height: frameWidth,
      cornerRadius: frameWidth * 0.25,
      cornerSegments: detailLevel === 'low' ? 1 : 3,
      material: frameMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vent bottom frame`,
      position: [center[0], center[1] - panelHeight / 2 - frameWidth / 2, center[2]],
      length: width + frameWidth * 2,
      width: frameWidth,
      height: frameWidth,
      cornerRadius: frameWidth * 0.25,
      cornerSegments: detailLevel === 'low' ? 1 : 3,
      material: frameMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vent left frame`,
      position: [center[0] - width / 2 - frameWidth / 2, center[1], center[2]],
      length: frameWidth,
      width: frameWidth,
      height: panelHeight,
      cornerRadius: frameWidth * 0.25,
      cornerSegments: detailLevel === 'low' ? 1 : 3,
      material: frameMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vent right frame`,
      position: [center[0] + width / 2 + frameWidth / 2, center[1], center[2]],
      length: frameWidth,
      width: frameWidth,
      height: panelHeight,
      cornerRadius: frameWidth * 0.25,
      cornerSegments: detailLevel === 'low' ? 1 : 3,
      material: frameMat,
    },
  ]
  for (let i = 0; i < count; i += 1) {
    const y = center[1] + (i - (count - 1) / 2) * spacing
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vent slat ${i + 1}`,
      position: [center[0], y, center[2] + panelDepth * 0.15],
      rotation: [0, 0, 0],
      length: width,
      width: height,
      height,
      cornerRadius: height * 0.3,
      cornerSegments: detailLevel === 'low' ? 1 : 3,
      material: slatMat,
    })
  }
  if (kind === 'vent_grill' && detailLevel !== 'low') {
    for (const offset of [-0.25, 0.25]) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'object'} vent vertical mullion`,
        position: [center[0] + offset * width, center[1], center[2] + panelDepth * 0.2],
        length: frameWidth * 0.8,
        width: frameWidth * 0.7,
        height: panelHeight * 0.92,
        cornerRadius: frameWidth * 0.2,
        cornerSegments: 3,
        material: frameMat,
      })
    }
  }
  return shapes
}

function composeSkidBase(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.06, 0])
  const length = clamp(part.length ?? part.depth, 1.1, 0.25, 5)
  const width = clamp(part.width, 0.46, 0.12, 2)
  const railHeight = clamp(part.height, 0.08, 0.02, 0.35)
  const railWidth = clamp(part.radius, Math.min(width, length) * 0.08, 0.015, 0.18)
  const frameMat = partMaterial(part, material(input.darkColor ?? '#2f343b', 0.6, 0.42))
  const railZ = width / 2 - railWidth / 2
  return [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} skid left rail`,
      position: [center[0], center[1], center[2] - railZ],
      length,
      width: railWidth,
      height: railHeight,
      cornerRadius: railHeight * 0.12,
      cornerSegments: 3,
      material: frameMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} skid right rail`,
      position: [center[0], center[1], center[2] + railZ],
      length,
      width: railWidth,
      height: railHeight,
      cornerRadius: railHeight * 0.12,
      cornerSegments: 3,
      material: frameMat,
    },
    ...[-0.36, 0, 0.36].map((offset, index) => ({
      kind: 'box' as const,
      name: `${part.name ?? input.name ?? 'object'} skid cross member ${index + 1}`,
      position: [center[0] + offset * length, center[1] + railHeight * 0.18, center[2]] as Vec3,
      length: railWidth,
      width: width,
      height: railHeight * 0.72,
      cornerRadius: railHeight * 0.08,
      cornerSegments: 3,
      material: frameMat,
    })),
  ]
}

function composeRoundedMachineBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.45, 0])
  const length = clamp(part.length, 0.7, 0.1, 5)
  const width = clamp(part.width ?? part.depth, 0.36, 0.08, 2)
  const height = clamp(part.height, 0.36, 0.08, 2)
  const cornerRadius = clamp(part.cornerRadius, Math.min(length, width, height) * 0.12, 0.004, 0.22)
  const bodyMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.48, 0.28))
  const secondaryMat = material(input.secondaryColor ?? '#334155', 0.55, 0.18)
  const darkMat = material(input.darkColor ?? '#1f2937', 0.62, 0.18)
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.34, 0.68)
  const seamThickness = Math.min(length, width, height) * 0.012
  return [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} rounded machine body`,
      position: center,
      length,
      width,
      height,
      cornerRadius,
      cornerSegments: clampInt(part.cornerSegments, input.detail === 'high' ? 8 : 6, 3, 12),
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} recessed front access cover plate`,
      position: [center[0], center[1] + height * 0.02, center[2] + width * 0.515],
      length: length * 0.72,
      width: width * 0.035,
      height: height * 0.58,
      cornerRadius: Math.min(length, height) * 0.025,
      cornerSegments: 3,
      material: secondaryMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} raised top service hatch`,
      position: [center[0] - length * 0.06, center[1] + height * 0.51, center[2]],
      length: length * 0.54,
      width: width * 0.72,
      thickness: seamThickness * 1.8,
      cornerRadius: cornerRadius * 0.55,
      cornerSegments: 4,
      material: secondaryMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} lower shadow plinth`,
      position: [center[0], center[1] - height * 0.52 - seamThickness, center[2]],
      length: length * 0.94,
      width: width * 0.92,
      height: seamThickness * 2,
      cornerRadius: cornerRadius * 0.35,
      cornerSegments: 3,
      material: darkMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} front horizontal seam`,
      position: [center[0], center[1] + height * 0.22, center[2] + width * 0.535],
      length: length * 0.8,
      width: seamThickness,
      height: seamThickness,
      cornerRadius: seamThickness * 0.25,
      cornerSegments: 2,
      material: metalMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} side service seam`,
      position: [center[0] - length * 0.18, center[1], center[2] + width * 0.536],
      length: seamThickness,
      width: seamThickness,
      height: height * 0.62,
      cornerRadius: seamThickness * 0.25,
      cornerSegments: 2,
      material: metalMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} rear foot pad left`,
      position: [center[0] - length * 0.32, center[1] - height * 0.58, center[2] - width * 0.28],
      length: length * 0.12,
      width: width * 0.16,
      height: seamThickness * 2.2,
      cornerRadius: seamThickness * 0.4,
      cornerSegments: 3,
      material: darkMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} rear foot pad right`,
      position: [center[0] + length * 0.32, center[1] - height * 0.58, center[2] - width * 0.28],
      length: length * 0.12,
      width: width * 0.16,
      height: seamThickness * 2.2,
      cornerRadius: seamThickness * 0.4,
      cornerSegments: 3,
      material: darkMat,
    },
  ]
}

function composeVoluteCasing(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.55, 0.18])
  const radius = clamp(part.radius, 0.28, 0.06, 2)
  const depth = clamp(part.depth ?? part.width, radius * 0.48, 0.03, 1)
  const outletAngle = clamp(part.outletAngle, Math.atan2(0.34, 0.72), -Math.PI, Math.PI)
  const casingMat = partMaterial(part, material(input.primaryColor ?? '#6b7280', 0.5, 0.32))
  const darkMat = material(input.darkColor ?? '#1f2937', 0.58, 0.18)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} volute scroll casing`,
      position: center,
      axis: 'z',
      majorRadius: radius * 0.5,
      tubeRadius: radius * 0.24,
      arc: Math.PI * 1.78,
      radialSegments: Math.max(12, Math.round(ringSegments(input.detail) * 0.4)),
      tubularSegments: ringSegments(input.detail),
      material: casingMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} volute circular cover`,
      position: [center[0], center[1], center[2] + depth * 0.04],
      axis: 'z',
      radius: radius * 0.72,
      height: depth * 0.64,
      radialSegments: ringSegments(input.detail),
      wallThickness: radius * 0.08,
      material: casingMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} volute inlet lip`,
      position: [center[0], center[1], center[2] + depth * 0.42],
      axis: 'z',
      radius: radius * 0.34,
      height: depth * 0.18,
      radialSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.75)),
      wallThickness: radius * 0.07,
      material: darkMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} volute discharge neck`,
      position: [
        center[0] + Math.cos(outletAngle) * radius * 0.8,
        center[1] + Math.sin(outletAngle) * radius * 0.8,
        center[2],
      ],
      rotation: [0, 0, outletAngle],
      axis: 'x',
      radius: radius * 0.18,
      height: radius * 0.52,
      radialSegments: Math.max(20, Math.round(ringSegments(input.detail) * 0.55)),
      material: casingMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeImpellerBlades(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.55, 0.34])
  const count = clampInt(part.count, 7, 4, 16)
  const radius = clamp(part.bladeRadius ?? part.radius, 0.18, 0.04, 1.2)
  const bladeWidth = clamp(
    part.bladeWidth ?? part.width,
    radius * 0.18,
    radius * 0.06,
    radius * 0.36,
  )
  const bladeDepth = clamp(part.depth ?? part.height, 0.025, 0.006, 0.12)
  const sweep = clamp(part.bladeSweep, bladeWidth * 0.55, -bladeWidth, bladeWidth)
  const mat = partMaterial(part, material(input.accentColor ?? '#94a3b8', 0.4, 0.45))
  const profile: [number, number][] = [
    [0, -bladeWidth * 0.32],
    [radius * 0.38, -bladeWidth * 0.48 + sweep * 0.2],
    [radius * 0.92, -bladeWidth * 0.22 + sweep],
    [radius, bladeWidth * 0.18 + sweep * 0.8],
    [radius * 0.45, bladeWidth * 0.44 + sweep * 0.24],
    [0, bladeWidth * 0.28],
  ]
  const shapes: PrimitiveShapeInput[] = []

  for (let i = 0; i < count; i += 1) {
    const angle = angularStep(i, count)
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} impeller vane ${i + 1}`,
      position: radialPoint(center, angle, radius * 0.42, 0),
      rotation: radialExtrudeRotationInLocalPlane(angle, 0),
      profile,
      depth: bladeDepth,
      bevelSize: bladeDepth * 0.12,
      bevelThickness: bladeDepth * 0.12,
      bevelSegments: 1,
      curveSegments: 8,
      material: mat,
    })
  }

  shapes.push({
    kind: 'cylinder',
    name: `${part.name ?? input.name ?? 'object'} impeller hub`,
    position: center,
    axis: 'z',
    radius: radius * 0.26,
    height: bladeDepth * 1.45,
    radialSegments: 32,
    material: mat,
  })

  return shapes
}

function normalizedBladeShape(value: unknown): 'taiji_half' | 'airfoil' {
  const text = textOf(value).replace(/[\s-]+/g, '_')
  if (/airfoil|wing|aero|翼型|飞机|航空/.test(text)) return 'airfoil'
  return 'taiji_half'
}

function taijiHalfBladeProfile(
  length: number,
  rootWidth: number,
  bladeWidth: number,
  longitudinalCurve: number,
  steps: number,
): [number, number][] {
  const profile: [number, number][] = []
  const halfRoot = rootWidth * 0.5
  const maxHalfWidth = bladeWidth * 0.78
  const halfWidthAt = (t: number) => {
    const bulb = Math.sin(Math.PI * t) ** 0.48
    const outerWeight = 0.72 + t * 0.28
    const rootNeck = halfRoot * (1 - t) ** 2.2
    return rootNeck + maxHalfWidth * bulb * outerWeight
  }
  const spineOffset = (t: number) =>
    longitudinalCurve * (Math.sin(Math.PI * (t - 0.06)) + 0.28 * Math.sin(Math.PI * 2 * t))
  const innerCut = (t: number) => longitudinalCurve * 0.72 * Math.sin(Math.PI * t) * (1 - t * 0.35)

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    const x = length * (t - 0.5)
    profile.push([x, spineOffset(t) + halfWidthAt(t) * (0.92 + t * 0.18)])
  }
  for (let step = steps; step >= 0; step -= 1) {
    const t = step / steps
    const x = length * (t - 0.5)
    const width = halfWidthAt(t)
    profile.push([x, spineOffset(t) - width * (0.5 + 0.32 * (1 - t)) + innerCut(t)])
  }
  return profile
}

function rotateBladeProfile(profile: [number, number][], angle: number): [number, number][] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return profile.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos])
}

function composePropellerBladeSet(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  options?: {
    semanticRole?: string
    semanticGroup?: string
    sourcePartKind?: string
    namePrefix?: string
  },
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.12, 0])
  const count = clampInt(part.count, 3, 2, 8)
  const bladeLength = clamp(part.bladeRadius ?? part.radius ?? part.length, 0.34, 0.08, 1.2)
  const bladeWidth = clamp(part.bladeWidth ?? part.width, 0.13, 0.04, 0.45)
  const bladeDepth = clamp(part.depth ?? part.height, 0.028, 0.01, 0.09)
  const pitch = clamp(part.bladePitch, 0.52, 0, 1.05)
  const hubRadius = clamp(
    part.hubRadius ?? part.wireRadius,
    bladeLength * 0.12,
    0.015,
    bladeLength * 0.32,
  )
  const rootWidth = Math.max(bladeDepth * 1.05, hubRadius * 0.36)
  const tipWidth = Math.max(bladeDepth * 1.8, bladeWidth * 0.24)
  const camber = clamp(part.camber, bladeWidth * 0.22, -bladeWidth * 0.8, bladeWidth * 0.8)
  const sweep = clamp(part.bladeSweep, bladeWidth * 0.18, -bladeWidth, bladeWidth)
  const longitudinalCurve = clamp(
    part.verticalCurve ?? part.curvature,
    bladeWidth * 0.38,
    -bladeWidth,
    bladeWidth,
  )
  const bladeShape = normalizedBladeShape(part.bladeShape ?? part.style ?? part.variant)
  const mat = partMaterial(part, material(input.accentColor ?? '#64748b', 0.5, 0.45))
  const shapes: PrimitiveShapeInput[] = []
  const profile =
    bladeShape === 'airfoil'
      ? airfoilProfile(
          bladeLength,
          rootWidth,
          tipWidth,
          camber,
          sweep,
          input.detail === 'low' ? 12 : input.detail === 'high' ? 30 : 22,
        )
      : taijiHalfBladeProfile(
          bladeLength,
          rootWidth,
          Math.max(bladeWidth, tipWidth * 1.8),
          longitudinalCurve,
          input.detail === 'low' ? 14 : input.detail === 'high' ? 36 : 28,
        )
  const planarMixerBlades = options?.sourcePartKind === 'mixer_blades'

  for (let i = 0; i < count; i += 1) {
    const angle = (i * Math.PI * 2) / count
    const bladeProfile = planarMixerBlades ? rotateBladeProfile(profile, angle) : profile
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} ${options?.namePrefix ?? bladeShape.replace('_', ' ')} propeller blade ${i + 1}`,
      semanticRole: options?.semanticRole ?? part.semanticRole ?? 'propeller_blade',
      semanticGroup: options?.semanticGroup ?? part.semanticGroup ?? 'propeller_blade_set',
      sourcePartKind: options?.sourcePartKind ?? part.sourcePartKind ?? 'propeller_blade_set',
      position: [
        center[0] + Math.cos(angle) * (hubRadius + bladeLength * 0.5),
        center[1],
        center[2] + Math.sin(angle) * (hubRadius + bladeLength * 0.5),
      ],
      rotation: planarMixerBlades
        ? [-Math.PI / 2, 0, 0]
        : radialExtrudeRotationInHorizontalPlane(angle, pitch * 0.55),
      profile: bladeProfile,
      depth: bladeDepth,
      bevelSize: bladeDepth * 0.12,
      bevelThickness: bladeDepth * 0.16,
      bevelSegments: input.detail === 'high' ? 3 : 2,
      curveSegments: input.detail === 'high' ? 24 : 18,
      material: mat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeMixerBlades(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  return composePropellerBladeSet(input, { bladeShape: 'taiji_half', ...part }, origin, {
    semanticRole: 'mixer_blade',
    semanticGroup: 'mixer_blades',
    sourcePartKind: 'mixer_blades',
    namePrefix: 'taiji half mixer',
  })
}

function airfoilProfile(
  length: number,
  rootWidth: number,
  tipWidth: number,
  camber: number,
  sweep: number,
  steps: number,
): [number, number][] {
  const profile: [number, number][] = []
  const halfRoot = rootWidth / 2
  const halfTip = tipWidth / 2
  const halfWidthAt = (t: number) =>
    halfTip + (halfRoot - halfTip) * Math.sqrt(Math.max(0, 1 - t * t))
  const centerOffset = (t: number) =>
    sweep * Math.sin(Math.PI * t) + camber * Math.sin(Math.PI * t) * (1 - t * 0.35)

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    profile.push([length * (t - 0.5), centerOffset(t) - halfWidthAt(t)])
  }
  for (let step = steps; step >= 0; step -= 1) {
    const t = step / steps
    profile.push([length * (t - 0.5), centerOffset(t) + halfWidthAt(t)])
  }
  return profile
}

function composeAirfoilBlade(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.4, 0])
  const count = clampInt(part.count, 1, 1, 64)
  const bladeLength = clamp(part.length ?? part.bladeRadius ?? part.radius, 0.46, 0.06, 2.5)
  const rootWidth = clamp(part.rootWidth ?? part.bladeWidth ?? part.width, 0.13, 0.015, 0.8)
  const tipWidth = clamp(part.tipWidth, rootWidth * 0.34, 0.006, rootWidth)
  const thickness = clamp(part.thickness ?? part.depth ?? part.height, 0.025, 0.003, 0.16)
  const pitch = clamp(part.pitch ?? part.bladePitch, 0.34, -1.2, 1.2)
  const twist = clamp(part.twist, 0.18, -1.2, 1.2)
  const camber = clamp(part.camber, rootWidth * 0.18, -rootWidth * 0.8, rootWidth * 0.8)
  const sweep = clamp(part.bladeSweep, rootWidth * 0.18, -rootWidth, rootWidth)
  const hubRadius = clamp(part.wireRadius, bladeLength * 0.12, 0.01, bladeLength * 0.35)
  const profile = airfoilProfile(
    bladeLength,
    rootWidth,
    tipWidth,
    camber,
    sweep,
    input.detail === 'low' ? 10 : 18,
  )
  const mat = partMaterial(part, material(input.accentColor ?? '#64748b', 0.45, 0.45))
  const shapes: PrimitiveShapeInput[] = []

  for (let index = 0; index < count; index += 1) {
    const angle = angularStep(index, count)
    const radialCenter = hubRadius + bladeLength * 0.5
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} airfoil blade ${index + 1}`,
      semanticRole: part.semanticRole ?? 'airfoil_blade',
      semanticGroup: 'airfoil_blades',
      sourcePartKind: 'airfoil_blade',
      position: [
        center[0] + Math.cos(angle) * radialCenter,
        center[1],
        center[2] + Math.sin(angle) * radialCenter,
      ],
      rotation: radialExtrudeRotationInHorizontalPlane(angle, pitch + twist * 0.35),
      profile,
      depth: thickness,
      bevelSize: thickness * 0.12,
      bevelThickness: thickness * 0.16,
      bevelSegments: 1,
      curveSegments: 16,
      material: mat,
    })
  }

  if (count > 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} airfoil blade hub`,
      semanticRole: 'airfoil_hub',
      semanticGroup: 'airfoil_blades',
      sourcePartKind: 'airfoil_blade',
      position: center,
      axis: 'y',
      radius: hubRadius,
      height: thickness * 1.8,
      radialSegments: 32,
      material: partMaterial(part, material(input.metalColor ?? '#94a3b8', 0.35, 0.7)),
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function lensProfile(shape: string | undefined, width: number, height: number): [number, number][] {
  const normalized =
    shape
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_') ?? ''
  const steps = 24
  const profile: [number, number][] = []
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const aviatorDrop = normalized.includes('aviator') || normalized.includes('teardrop')
    const frog = normalized.includes('frog') || normalized.includes('toad')
    const lowerBulge = aviatorDrop ? (sin < 0 ? 1.26 : 0.92) : frog ? (sin < 0 ? 1.12 : 0.9) : 1
    const outerLift = frog ? 1 + Math.max(0, cos) * 0.16 : 1
    const innerPinch = frog ? 1 - Math.max(0, -cos) * 0.08 : 1
    profile.push([
      cos * width * 0.5 * outerLift * innerPinch,
      sin * height * 0.5 * lowerBulge - (aviatorDrop ? height * 0.05 : 0),
    ])
  }
  return profile
}

function composeCurvedLensPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.45, 0])
  const width = clamp(part.width ?? part.length, 0.32, 0.04, 2)
  const height = clamp(part.height, 0.18, 0.025, 1.2)
  const thickness = clamp(part.thickness ?? part.depth, 0.012, 0.002, 0.08)
  const curvature = clamp(part.curvature, 0.05, -0.4, 0.4)
  const profile = lensProfile(part.lensShape ?? part.style ?? part.variant, width, height)
  const tint = part.color ?? part.primaryColor ?? input.primaryColor ?? '#1f2937'
  const lensMat: PrimitiveMaterialInput = {
    properties: {
      color: tint,
      roughness: 0.18,
      metalness: 0.05,
      opacity: 0.46,
      transparent: true,
      side: 'double',
    },
  }
  const rimMat = material(input.darkColor ?? '#111827', 0.42, 0.35)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} curved lens panel`,
      semanticRole: 'curved_lens',
      semanticGroup: 'curved_lens_panel',
      sourcePartKind: 'curved_lens_panel',
      position: center,
      rotation: [0, curvature, 0],
      profile,
      depth: thickness,
      bevelSize: thickness * 0.2,
      bevelThickness: thickness * 0.24,
      bevelSegments: 2,
      curveSegments: 18,
      material: lensMat,
    },
    {
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} curved lens rim`,
      semanticRole: 'lens_rim',
      semanticGroup: 'curved_lens_panel',
      sourcePartKind: 'curved_lens_panel',
      position: [center[0], center[1], center[2] - thickness * 0.7],
      rotation: [0, curvature, 0],
      profile: profile.map(([x, y]) => [x * 1.045, y * 1.06]),
      holes: [profile.map(([x, y]) => [x * 0.94, y * 0.92])],
      depth: thickness * 0.9,
      bevelSize: thickness * 0.14,
      bevelThickness: thickness * 0.18,
      bevelSegments: 1,
      curveSegments: 18,
      material: rimMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeEllipsoidShell(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.48, 0.04, 6)
  const width = clamp(part.width ?? part.depth, 0.28, 0.025, 4)
  const height = clamp(part.height, 0.18, 0.02, 3)
  const shellThickness = clamp(part.shellThickness ?? part.thickness, height * 0.05, 0.002, 0.18)
  const openingRadius = clamp(part.openingRadius, Math.min(length, width) * 0.16, 0.01, 1)
  const center = add(origin, part.position ?? [0, height * 0.56, 0])
  const role = part.semanticRole ?? 'ellipsoid_shell'
  const group = part.semanticGroup ?? 'ellipsoid_shell'
  const source = part.sourcePartKind ?? 'ellipsoid_shell'
  const shellMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.44, 0.22))
  const rimMat = material(input.darkColor ?? '#1f2937', 0.56, 0.2)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} ellipsoid shell body`,
      semanticRole: role,
      semanticGroup: group,
      sourcePartKind: source,
      position: center,
      radius: 0.5,
      scale: [length, height * 1.22, width],
      widthSegments: part.cornerSegments ?? 40,
      heightSegments: part.cornerSegments ?? 22,
      material: shellMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} ellipsoid shell base rim`,
      semanticRole: 'ellipsoid_shell_rim',
      semanticGroup: group,
      sourcePartKind: source,
      position: [center[0], center[1] - height * 0.45, center[2]],
      axis: 'y',
      majorRadius: Math.min(length, width) * 0.34,
      tubeRadius: shellThickness * 0.45,
      radialSegments: 14,
      tubularSegments: 44,
      scale: [length / Math.max(width, 0.01), 1, 1],
      material: rimMat,
    },
  ]

  if (part.cutBottom !== false) {
    shapes.push({
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} flattened shell opening lip`,
      semanticRole: 'ellipsoid_shell_opening',
      semanticGroup: group,
      sourcePartKind: source,
      position: [center[0], center[1] - height * 0.5, center[2]],
      length: length * 0.82,
      width: width * 0.82,
      thickness: shellThickness,
      cornerRadius: Math.min(length, width) * 0.22,
      cornerSegments: 8,
      material: rimMat,
    })
  }

  if (part.openingRadius != null || part.style === 'vessel_head' || part.variant === 'manway') {
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} top access opening rim`,
      semanticRole: 'ellipsoid_shell_top_opening',
      semanticGroup: group,
      sourcePartKind: source,
      position: [center[0], center[1] + height * 0.48, center[2]],
      axis: 'y',
      majorRadius: openingRadius,
      tubeRadius: shellThickness * 0.42,
      radialSegments: 12,
      tubularSegments: 32,
      material: rimMat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeErgonomicShell(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.12, 0.04, 2)
  const width = clamp(part.width ?? part.depth, 0.065, 0.02, 1)
  const height = clamp(part.height, 0.036, 0.01, 0.6)
  const center = add(origin, part.position ?? [0, height * 0.72, 0])
  const sideTaper = clamp(part.sideTaper, 0.18, 0, 0.6)
  const noseSlope = clamp(part.noseSlope, 0.38, 0, 1)
  const tailSlope = clamp(part.tailSlope, 0.22, 0, 1)
  const shellMat = partMaterial(part, material(input.primaryColor ?? '#374151', 0.5, 0.2))
  const darkMat = material(input.darkColor ?? '#111827', 0.56, 0.18)
  const panelWidth = width * (1 - sideTaper * 0.4)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} ergonomic shell base lip`,
      semanticRole: 'ergonomic_shell_base',
      semanticGroup: 'ergonomic_shell',
      sourcePartKind: 'ergonomic_shell',
      position: [center[0], center[1] - height * 0.44, center[2]],
      length,
      width,
      thickness: Math.max(height * 0.08, 0.004),
      cornerRadius: Math.min(length, width) * 0.24,
      cornerSegments: 8,
      material: darkMat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} ergonomic domed shell`,
      semanticRole: 'ergonomic_shell',
      semanticGroup: 'ergonomic_shell',
      sourcePartKind: 'ergonomic_shell',
      position: [center[0], center[1], center[2]],
      radius: 0.5,
      scale: [length, height * 1.55, panelWidth],
      widthSegments: 32,
      heightSegments: 20,
      material: shellMat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} ergonomic low nose slope`,
      semanticRole: 'ergonomic_shell_nose',
      semanticGroup: 'ergonomic_shell',
      sourcePartKind: 'ergonomic_shell',
      position: [center[0] + length * 0.34, center[1] - height * 0.1, center[2]],
      rotation: [0, 0, -noseSlope * 0.22],
      length: length * 0.34,
      width: panelWidth * 0.92,
      height: height * 0.42,
      material: shellMat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} ergonomic tail taper`,
      semanticRole: 'ergonomic_shell_tail',
      semanticGroup: 'ergonomic_shell',
      sourcePartKind: 'ergonomic_shell',
      position: [center[0] - length * 0.34, center[1] - height * 0.14, center[2]],
      rotation: [0, 0, Math.PI + tailSlope * 0.18],
      length: length * 0.32,
      width: panelWidth * 0.9,
      height: height * 0.36,
      material: shellMat,
    },
  ]

  if (
    part.style === 'mouse' ||
    part.variant === 'mouse' ||
    part.name?.toLowerCase().includes('mouse')
  ) {
    shapes.push(
      {
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'object'} left button panel`,
        semanticRole: 'mouse_button',
        semanticGroup: 'ergonomic_shell',
        sourcePartKind: 'ergonomic_shell',
        position: [center[0] + length * 0.18, center[1] + height * 0.42, center[2] - width * 0.18],
        rotation: [0, 0, -0.12],
        length: length * 0.32,
        width: width * 0.28,
        thickness: height * 0.04,
        cornerRadius: width * 0.08,
        cornerSegments: 5,
        material: material(input.secondaryColor ?? '#4b5563', 0.48, 0.12),
      },
      {
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'object'} right button panel`,
        semanticRole: 'mouse_button',
        semanticGroup: 'ergonomic_shell',
        sourcePartKind: 'ergonomic_shell',
        position: [center[0] + length * 0.18, center[1] + height * 0.42, center[2] + width * 0.18],
        rotation: [0, 0, -0.12],
        length: length * 0.32,
        width: width * 0.28,
        thickness: height * 0.04,
        cornerRadius: width * 0.08,
        cornerSegments: 5,
        material: material(input.secondaryColor ?? '#4b5563', 0.48, 0.12),
      },
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} scroll wheel`,
        semanticRole: 'scroll_wheel',
        semanticGroup: 'ergonomic_shell',
        sourcePartKind: 'ergonomic_shell',
        position: [center[0] + length * 0.24, center[1] + height * 0.47, center[2]],
        rotation: [Math.PI / 2, 0, 0],
        axis: 'z',
        radius: Math.min(width, height) * 0.08,
        height: width * 0.16,
        radialSegments: 18,
        material: darkMat,
      },
    )
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeStreamlinedBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.2, 0.08, 20)
  const width = clamp(part.width ?? part.depth, 0.36, 0.03, 3)
  const height = clamp(part.height, 0.22, 0.02, 2.5)
  const center = add(origin, part.position ?? [0, height * 0.55, 0])
  const noseRoundness = clamp(part.noseRoundness, 0.56, 0, 1)
  const tailTaper = clamp(part.tailTaper, 0.34, 0, 0.9)
  const roofArc = clamp(part.roofArc, 0.22, 0, 0.8)
  const shellMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.45, 0.28))
  const darkMat = material(input.darkColor ?? '#1f2937', 0.52, 0.22)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} streamlined central body`,
      semanticRole: 'streamlined_body',
      semanticGroup: 'streamlined_body',
      sourcePartKind: 'streamlined_body',
      position: center,
      radius: 0.5,
      scale: [length * 0.78, height * 1.18, width],
      widthSegments: 36,
      heightSegments: 20,
      material: shellMat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} rounded nose fairing`,
      semanticRole: 'streamlined_nose',
      semanticGroup: 'streamlined_body',
      sourcePartKind: 'streamlined_body',
      position: [
        center[0] + length * (0.4 + noseRoundness * 0.03),
        center[1] - height * 0.035,
        center[2],
      ],
      radius: 0.5,
      scale: [
        length * 0.28 * Math.max(0.28, noseRoundness),
        height * (0.68 + noseRoundness * 0.18),
        width * (0.6 + noseRoundness * 0.2),
      ],
      widthSegments: 28,
      heightSegments: 16,
      material: shellMat,
    },
    {
      kind: 'trapezoid-prism',
      name: `${part.name ?? input.name ?? 'object'} tapered tail fairing`,
      semanticRole: 'streamlined_tail',
      semanticGroup: 'streamlined_body',
      sourcePartKind: 'streamlined_body',
      position: [center[0] - length * 0.405, center[1] - height * 0.015, center[2]],
      rotation: [0, 0, Math.PI],
      length: length * 0.18,
      width: width * 0.58,
      height: height * 0.42,
      topScale: [Math.max(0.18, 1 - tailTaper), Math.max(0.22, 1 - tailTaper * 0.8)],
      cornerRadius: Math.min(width, height) * 0.12,
      cornerSegments: 5,
      material: shellMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} smooth roof highlight`,
      semanticRole: 'streamlined_roof_arc',
      semanticGroup: 'streamlined_body',
      sourcePartKind: 'streamlined_body',
      position: [
        center[0] - length * 0.03,
        center[1] + height * (0.38 + roofArc * 0.25),
        center[2],
      ],
      rotation: [0, 0, -roofArc * 0.18],
      length: length * 0.42,
      width: width * 0.48,
      thickness: Math.max(height * 0.035, 0.006),
      cornerRadius: Math.min(width, length) * 0.08,
      cornerSegments: 6,
      material: darkMat,
    },
  ]

  return applyPartRotation(shapes, center, part.rotation)
}

function composeAircraftFuselage(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.12, 0.4, 20)
  const width = clamp(part.width ?? part.depth, 0.14, 0.05, 1.4)
  const height = clamp(part.height, width * 1.08, 0.04, 1.2)
  const center = add(origin, part.position ?? [0, height * 3.2, 0])
  const fuselageMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#f8fafc', 0.5, 0.04),
  )
  const stripeMat = material(part.accentColor ?? input.accentColor ?? '#0f8fb3', 0.36, 0.08)
  const glassMat = material(input.darkColor ?? '#1e293b', 0.22, 0.02, 0.9)
  const cockpitGlassMat = material(input.darkColor ?? '#020617', 0.24, 0.02, 0.94)
  const base = composeStreamlinedBody(
    input,
    {
      ...part,
      kind: 'streamlined_body',
      name: part.name ?? 'aircraft fuselage',
      length,
      width,
      height,
      position: center,
      noseRoundness: part.noseRoundness ?? 0.62,
      tailTaper: part.tailTaper ?? 0.56,
      roofArc: part.roofArc ?? 0.08,
      material: fuselageMat,
      semanticGroup: 'aircraft_fuselage',
      rotation: undefined,
    },
    [0, 0, 0],
  )
    .filter(
      (shape) =>
        shape.semanticRole !== 'streamlined_roof_arc' && shape.semanticRole !== 'streamlined_nose',
    )
    .map((shape) => ({
      ...shape,
      sourcePartKind: 'aircraft_fuselage',
      semanticGroup: 'aircraft_fuselage',
      semanticRole:
        shape.semanticRole === 'streamlined_body'
          ? 'aircraft_fuselage'
          : shape.semanticRole === 'streamlined_tail'
            ? 'aircraft_tail'
            : shape.semanticRole,
    }))
  const windowCount = clampInt(part.count, length > 1.6 ? 18 : 14, 6, 40)
  const cabinWindowStart = -length * 0.31
  const cabinWindowEnd = length * 0.2
  const windowSpacing = (cabinWindowEnd - cabinWindowStart) / Math.max(windowCount - 1, 1)
  const shapes: PrimitiveShapeInput[] = [
    ...base,
    {
      kind: 'conformal-strip',
      name: `${part.name ?? input.name ?? 'aircraft'} left blue conformal cheatline stripe`,
      semanticRole: 'aircraft_livery_stripe',
      semanticGroup: 'aircraft_fuselage',
      sourcePartKind: 'aircraft_fuselage',
      position: center,
      side: 'left',
      surface: 'ellipsoid-cylinder',
      xStart: -length * 0.38,
      xEnd: length * 0.34,
      verticalOffset: height * 0.04,
      width: height * 0.075,
      thickness: width * 0.025,
      surfaceRadiusY: height * 0.5,
      surfaceRadiusZ: width * 0.5,
      surfaceLength: length,
      endTaper: 0.42,
      segments: 32,
      widthSegments: 4,
      material: stripeMat,
    },
    {
      kind: 'conformal-strip',
      name: `${part.name ?? input.name ?? 'aircraft'} right blue conformal cheatline stripe`,
      semanticRole: 'aircraft_livery_stripe',
      semanticGroup: 'aircraft_fuselage',
      sourcePartKind: 'aircraft_fuselage',
      position: center,
      side: 'right',
      surface: 'ellipsoid-cylinder',
      xStart: -length * 0.38,
      xEnd: length * 0.34,
      verticalOffset: height * 0.04,
      width: height * 0.075,
      thickness: width * 0.025,
      surfaceRadiusY: height * 0.5,
      surfaceRadiusZ: width * 0.5,
      surfaceLength: length,
      endTaper: 0.42,
      segments: 32,
      widthSegments: 4,
      material: stripeMat,
    },
  ]

  for (const sideName of ['left', 'right'] as const) {
    for (let index = 0; index < windowCount; index += 1) {
      const x = cabinWindowStart + index * windowSpacing
      const windowDecalLength = clamp(undefined, length * 0.01, 0.025, 0.075)
      shapes.push({
        kind: 'conformal-strip',
        name: `${part.name ?? input.name ?? 'aircraft'} ${sideName} conformal cabin window ${index + 1}`,
        semanticRole: 'cabin_window',
        semanticGroup: 'aircraft_windows',
        sourcePartKind: 'aircraft_fuselage',
        position: center,
        side: sideName,
        surface: 'ellipsoid-cylinder',
        xStart: x - windowDecalLength / 2,
        xEnd: x + windowDecalLength / 2,
        verticalOffset: height * 0.24,
        width: clamp(undefined, height * 0.075, 0.025, 0.075),
        thickness: width * 0.018,
        surfaceRadiusY: height * 0.5,
        surfaceRadiusZ: width * 0.5,
        surfaceLength: length,
        endTaper: 0.42,
        segments: 2,
        widthSegments: 2,
        material: glassMat,
      })
    }
  }

  for (const sideName of ['left', 'right'] as const) {
    shapes.push({
      kind: 'conformal-strip',
      name: `${part.name ?? input.name ?? 'aircraft'} ${sideName} conformal cockpit side window`,
      semanticRole: 'cockpit_window',
      semanticGroup: 'aircraft_windows',
      sourcePartKind: 'aircraft_fuselage',
      position: center,
      side: sideName,
      surface: 'ellipsoid-cylinder',
      xStart: length * 0.275,
      xEnd: length * 0.305,
      verticalOffset: height * 0.34,
      width: clamp(undefined, height * 0.085, 0.035, 0.09),
      thickness: width * 0.018,
      surfaceRadiusY: height * 0.5,
      surfaceRadiusZ: width * 0.5,
      surfaceLength: length,
      endTaper: 0.3,
      segments: 3,
      widthSegments: 2,
      material: cockpitGlassMat,
    })
    shapes.push({
      kind: 'conformal-strip',
      name: `${part.name ?? input.name ?? 'aircraft'} ${sideName} conformal forward windshield pane`,
      semanticRole: 'cockpit_window',
      semanticGroup: 'aircraft_windows',
      sourcePartKind: 'aircraft_fuselage',
      position: center,
      side: sideName,
      surface: 'ellipsoid-cylinder',
      xStart: length * 0.318,
      xEnd: length * 0.34,
      verticalOffset: height * 0.39,
      width: clamp(undefined, height * 0.095, 0.035, 0.095),
      thickness: width * 0.018,
      surfaceRadiusY: height * 0.5,
      surfaceRadiusZ: width * 0.5,
      surfaceLength: length,
      endTaper: 0.3,
      segments: 3,
      widthSegments: 2,
      material: cockpitGlassMat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeAircraftWing(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.04, 0.47, 0])
  const span = clamp(part.length, 0.95, 0.2, 16)
  const chord = clamp(part.width ?? part.depth, 0.18, 0.04, 1.2)
  const thickness = clamp(part.thickness ?? part.height, 0.014, 0.004, 0.08)
  const dihedral = clamp(part.verticalCurve ?? part.pitch, 0.045, -0.25, 0.25)
  const sweep = clamp(part.bladeSweep ?? part.twist, 0.12, -0.5, 0.5)
  const mat = partMaterial(part, material(input.secondaryColor ?? '#cbd5e1', 0.48, 0.18))
  const includeWinglets = part.sourcePartKind !== 'aircraft_horizontal_stabilizer'
  const side = partSide(part.side)
  const sides = side === 'left' ? [-1] : side === 'right' ? [1] : [-1, 1]
  const halfSpan = span / 2
  const shapes: PrimitiveShapeInput[] = []
  for (const wingSide of sides) {
    const rootY = wingSide < 0 ? -halfSpan / 2 : halfSpan / 2
    const tipY = -rootY
    const sweptTipX = sweep * halfSpan
    const rootLeadingX = chord * 0.52
    const rootTrailingX = -chord * 0.48
    const tipLeadingX = chord * 0.18 + sweptTipX
    const tipTrailingX = -chord * 0.22 + sweptTipX
    const profile: [number, number][] = [
      [rootTrailingX, rootY],
      [rootLeadingX, rootY],
      [tipLeadingX, tipY],
      [tipTrailingX, tipY],
    ]
    const wingCenter: Vec3 = [center[0], center[1], center[2] + wingSide * halfSpan * 0.5]
    const tipPosition: Vec3 = [
      center[0] + (tipLeadingX + tipTrailingX) / 2,
      center[1] + Math.abs(halfSpan * dihedral),
      center[2] + wingSide * halfSpan,
    ]
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'aircraft'} ${wingSide < 0 ? 'left' : 'right'} swept tapered airfoil wing`,
      semanticRole: 'aircraft_wing',
      semanticGroup: 'aircraft_wings',
      sourcePartKind: 'aircraft_wing',
      position: wingCenter,
      rotation: [-Math.PI / 2 - wingSide * dihedral, 0, 0],
      profile,
      depth: thickness,
      bevelSize: thickness * 0.12,
      bevelThickness: thickness * 0.2,
      bevelSegments: 1,
      curveSegments: 8,
      material: mat,
    })
    if (includeWinglets) {
      shapes.push({
        kind: 'trapezoid-prism',
        name: `${part.name ?? input.name ?? 'aircraft'} ${wingSide < 0 ? 'left' : 'right'} upturned winglet`,
        semanticRole: 'aircraft_winglet',
        semanticGroup: 'aircraft_wings',
        sourcePartKind: 'aircraft_wing',
        position: tipPosition,
        rotation: [0, 0, wingSide * 0.18],
        length: chord * 0.18,
        width: thickness * 1.8,
        height: Math.max(thickness * 6, chord * 0.16),
        topLengthScale: 0.55,
        topWidthScale: 0.72,
        cornerRadius: thickness * 0.4,
        cornerSegments: 3,
        material: mat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeAircraftEngine(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [-0.38, 0.52, 0])
  const radius = clamp(part.radius, 0.05, 0.018, 0.36)
  const length = clamp(part.length ?? part.depth, 0.2, 0.05, 1.25)
  const spacing = clamp(part.width, 0.46, radius * 3, 4)
  const count = clampInt(part.count, 2, 1, 4)
  const nacelleMat = partMaterial(part, material(input.metalColor ?? '#64748b', 0.34, 0.56))
  const intakeMat = material(input.darkColor ?? '#111827', 0.42, 0.2)
  const fanMat = material(input.secondaryColor ?? '#cbd5e1', 0.3, 0.65)
  const offsets =
    count === 1
      ? [0]
      : Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing)
  const shapes: PrimitiveShapeInput[] = []
  offsets.forEach((zOffset, index) => {
    const nacelleCenter: Vec3 = [center[0], center[1], center[2] + zOffset]
    const sideRole = zOffset < 0 ? 'engine_nacelle_left' : 'engine_nacelle_right'
    shapes.push(
      {
        kind: 'hollow-cylinder',
        name: `${part.name ?? input.name ?? 'aircraft'} engine nacelle ${index + 1}`,
        semanticRole: count === 1 ? 'engine_nacelle' : sideRole,
        semanticGroup: 'aircraft_engines',
        sourcePartKind: 'aircraft_engine',
        position: nacelleCenter,
        axis: 'x',
        radius,
        height: length,
        wallThickness: radius * 0.16,
        radialSegments: ringSegments(input.detail),
        material: nacelleMat,
      },
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'aircraft'} engine intake fan ${index + 1}`,
        semanticRole: 'engine_fan',
        semanticGroup: 'aircraft_engines',
        sourcePartKind: 'aircraft_engine',
        position: [nacelleCenter[0] + length * 0.48, nacelleCenter[1], nacelleCenter[2]],
        axis: 'x',
        radius: radius * 0.72,
        height: length * 0.04,
        radialSegments: 18,
        material: fanMat,
      },
      {
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'aircraft'} dark engine intake lip ${index + 1}`,
        semanticRole: 'engine_intake',
        semanticGroup: 'aircraft_engines',
        sourcePartKind: 'aircraft_engine',
        position: [nacelleCenter[0] + length * 0.52, nacelleCenter[1], nacelleCenter[2]],
        axis: 'x',
        majorRadius: radius * 0.88,
        tubeRadius: radius * 0.08,
        tubularSegments: ringSegments(input.detail),
        radialSegments: 12,
        material: intakeMat,
      },
    )
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function composeAircraftVerticalStabilizer(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [-0.48, 0.73, 0])
  const length = clamp(part.length, 0.22, 0.04, 1.5)
  const height = clamp(part.height, 0.28, 0.04, 1.4)
  const width = clamp(part.width ?? part.thickness, 0.025, 0.004, 0.16)
  return applyPartRotation(
    [
      {
        kind: 'trapezoid-prism',
        name: `${part.name ?? input.name ?? 'aircraft'} swept vertical stabilizer`,
        semanticRole: 'vertical_stabilizer',
        semanticGroup: 'aircraft_tail',
        sourcePartKind: 'aircraft_vertical_stabilizer',
        position: center,
        rotation: [0, 0, -0.12],
        length,
        width,
        height,
        topLengthScale: 0.42,
        topWidthScale: 0.82,
        cornerRadius: Math.min(length, height) * 0.04,
        cornerSegments: 3,
        material: partMaterial(part, material(input.secondaryColor ?? '#cbd5e1', 0.48, 0.18)),
      },
    ],
    center,
    part.rotation,
  )
}

function composeAircraftHorizontalStabilizer(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  return composeAircraftWing(
    input,
    {
      ...part,
      name: part.name ?? 'T-tail',
      position: part.position ?? [-0.53, 0.84, 0],
      length: part.length ?? 0.34,
      width: part.width ?? 0.08,
      thickness: part.thickness ?? part.height ?? 0.009,
      verticalCurve: part.verticalCurve ?? 0.015,
      sourcePartKind: 'aircraft_horizontal_stabilizer',
    },
    origin,
  ).map((shape) => ({
    ...shape,
    name: shape.name?.replace('swept main wing', 'horizontal stabilizer'),
    semanticRole: 'horizontal_stabilizer',
    semanticGroup: 'aircraft_tail',
    sourcePartKind: 'aircraft_horizontal_stabilizer',
  }))
}

function composeAircraftLandingGear(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.02, 0.12, 0])
  const radius = clamp(part.radius ?? part.wheelRadius, 0.035, 0.012, 0.2)
  const track = clamp(part.width, 0.32, radius * 3, 1.4)
  const wheelbase = clamp(part.length, 0.62, radius * 5, 2.5)
  const tireMat = partMaterial(part, material(input.darkColor ?? '#111827', 0.72, 0.02))
  const strutMat = material(input.metalColor ?? '#94a3b8', 0.28, 0.72)
  const positions: Vec3[] = [
    [center[0] + wheelbase * 0.42, center[1], center[2]],
    [center[0] - wheelbase * 0.28, center[1], center[2] - track / 2],
    [center[0] - wheelbase * 0.28, center[1], center[2] + track / 2],
  ]
  const shapes: PrimitiveShapeInput[] = []
  positions.forEach((wheelCenter, index) => {
    const label = index === 0 ? 'nose' : `main ${index}`
    const wheelRole = index === 0 ? 'aircraft_landing_gear_nose' : 'aircraft_landing_gear_main'
    shapes.push(
      {
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'aircraft'} landing gear wheel ${label}`,
        semanticRole: wheelRole,
        semanticGroup: 'aircraft_landing_gear',
        sourcePartKind: 'aircraft_landing_gear',
        position: wheelCenter,
        axis: 'z',
        majorRadius: radius,
        tubeRadius: radius * 0.22,
        radialSegments: 10,
        tubularSegments: ringSegments(input.detail),
        material: tireMat,
      },
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'aircraft'} landing gear strut ${label}`,
        semanticRole: wheelRole,
        semanticGroup: 'aircraft_landing_gear',
        sourcePartKind: 'aircraft_landing_gear',
        position: [wheelCenter[0], wheelCenter[1] + radius * 1.65, wheelCenter[2]],
        axis: 'y',
        radius: radius * 0.18,
        height: radius * 2.4,
        radialSegments: 10,
        material: strutMat,
      },
    )
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function normalizedLoftSections(part: PartComposePartInput) {
  const length = clamp(part.length, 0.8, 0.08, 6)
  const baseWidth = clamp(part.width ?? part.depth, 0.28, 0.02, 2)
  const baseHeight = clamp(part.height, 0.12, 0.01, 1.8)
  const provided = Array.isArray(part.sections) ? part.sections.filter(Boolean) : []
  if (provided.length >= 2) {
    return provided.slice(0, 12).map((section, index) => ({
      x:
        typeof section.x === 'number' && Number.isFinite(section.x)
          ? section.x
          : -length / 2 + (index * length) / Math.max(1, provided.length - 1),
      width: clamp(section.width ?? section.length, baseWidth, 0.01, 3),
      height: clamp(section.height, baseHeight, 0.005, 2),
      y: clamp(section.y, 0, -2, 2),
      z: clamp(section.z, 0, -2, 2),
      topScale: section.topScale,
    }))
  }
  return [
    { x: -length / 2, width: baseWidth * 1.05, height: baseHeight * 0.82, y: 0, z: 0 },
    { x: 0, width: baseWidth, height: baseHeight * 1.12, y: baseHeight * 0.12, z: 0 },
    { x: length / 2, width: baseWidth * 0.45, height: baseHeight * 0.62, y: 0, z: 0 },
  ]
}

function composeLoftedPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, clamp(part.height, 0.12, 0.01, 1.8) * 0.7, 0])
  const thickness = clamp(part.thickness ?? part.depth, 0.024, 0.003, 0.18)
  const sections = normalizedLoftSections(part)
  const mat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.46, 0.24))
  const seamMat = material(input.darkColor ?? '#1f2937', 0.56, 0.2)
  const shapes: PrimitiveShapeInput[] = []

  for (let index = 0; index < sections.length - 1; index += 1) {
    const a = sections[index]
    const b = sections[index + 1]
    if (!a || !b) continue
    const segmentLength = Math.max(0.01, Math.abs(b.x - a.x))
    shapes.push({
      kind: 'trapezoid-prism',
      name: `${part.name ?? input.name ?? 'object'} lofted panel segment ${index + 1}`,
      semanticRole: part.semanticRole ?? 'lofted_panel_segment',
      semanticGroup: 'lofted_panel',
      sourcePartKind: 'lofted_panel',
      position: [
        center[0] + (a.x + b.x) / 2,
        center[1] + (a.y + b.y) / 2,
        center[2] + (a.z + b.z) / 2,
      ],
      length: segmentLength,
      width: Math.max(a.width, b.width),
      height: Math.max(a.height, b.height),
      topScale: [
        Math.max(0.05, b.width / Math.max(a.width, 0.01)),
        Math.max(0.05, b.height / Math.max(a.height, 0.01)),
      ],
      cornerRadius: Math.min(a.width, b.width, a.height, b.height) * 0.08,
      cornerSegments: 5,
      material: mat,
    })
  }

  sections.forEach((section, index) => {
    shapes.push({
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} loft section seam ${index + 1}`,
      semanticRole:
        index === 0
          ? 'lofted_panel_root'
          : index === sections.length - 1
            ? 'lofted_panel_tip'
            : 'lofted_panel_section',
      semanticGroup: 'lofted_panel',
      sourcePartKind: 'lofted_panel',
      position: [center[0] + section.x, center[1] + section.y, center[2] + section.z],
      rotation: [0, Math.PI / 2, 0],
      length: section.width,
      width: section.height,
      thickness,
      cornerRadius: Math.min(section.width, section.height) * 0.12,
      cornerSegments: 5,
      material: seamMat,
    })
  })

  return applyPartRotation(shapes, center, part.rotation)
}

function composePipePort(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  label: string,
): PrimitiveShapeInput[] {
  const side = partSide(part.side)
  const axis = side
    ? axisForSide(side, label === 'outlet_port' ? 'x' : 'z')
    : partAxis(part.axis, label === 'outlet_port' ? 'x' : 'z')
  const sign = signForSide(side, axis)
  const center = add(origin, part.position ?? [0, 0.55, 0.45])
  const radius = clamp(part.radius, 0.08, 0.01, 0.8)
  const length = clamp(part.length ?? part.depth ?? part.height, 0.26, 0.02, 2)
  const rimCenter = offsetAlongAxis(center, axis, (length / 2) * sign)
  const pipeMat = partMaterial(part, material(input.primaryColor ?? '#6b7280', 0.45, 0.35))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} ${label.replace('_', ' ')}`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: Math.max(20, Math.round(ringSegments(input.detail) * 0.55)),
      wallThickness: radius * 0.18,
      duct: {
        crossSection: 'round',
        radius,
        wallThickness: radius * 0.18,
      },
      ports: [
        {
          id: label,
          kind: label === 'inlet_port' ? 'inlet' : label === 'outlet_port' ? 'outlet' : 'generic',
          semanticRole: label,
          position: rimCenter,
          normal: axisNormal(axis, sign),
          axis,
          radius,
          direction:
            label === 'inlet_port' ? 'in' : label === 'outlet_port' ? 'out' : 'bidirectional',
        },
      ],
      material: pipeMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} ${label.replace('_', ' ')} rim`,
      position: rimCenter,
      axis,
      majorRadius: radius,
      tubeRadius: radius * 0.08,
      radialSegments: 12,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
      material: pipeMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeFlangeRing(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const segmentDetail = detailSegmentLevel(input, part)
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'z') : partAxis(part.axis, 'z')
  const center = add(origin, part.position ?? [0, 0.55, 0.5])
  const radius = clamp(part.radius, 0.12, 0.02, 1)
  const thickness = clamp(part.depth ?? part.height, 0.035, 0.006, 0.3)
  const boltCount = clampInt(
    part.boltCount ?? part.count,
    detailDefaultInt(input, part, { low: 4, medium: 6, high: 10 }),
    3,
    20,
  )
  const mat = partMaterial(part, material(input.metalColor ?? '#9ca3af', 0.34, 0.68))
  const gasketMat = material(input.darkColor ?? '#111827', 0.62, 0.08)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} flange ring`,
      position: center,
      axis,
      radius,
      height: thickness,
      radialSegments: ringSegments(segmentDetail),
      wallThickness: radius * 0.28,
      material: mat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} flange gasket`,
      position: offsetAlongAxis(center, axis, thickness * 0.54),
      axis,
      majorRadius: radius * 0.62,
      tubeRadius: radius * 0.035,
      radialSegments: 12,
      tubularSegments: Math.max(24, Math.round(ringSegments(segmentDetail) * 0.65)),
      material: gasketMat,
    },
  ]
  if (part.includeBolts !== false) {
    shapes.push(
      ...composeBoltPattern(
        input,
        {
          ...part,
          name: `${part.name ?? input.name ?? 'object'} flange`,
          position: center,
          rotation: undefined,
          axis,
          radius: radius * 0.76,
          count: boltCount,
          depth: thickness * 1.2,
        },
        [0, 0, 0],
      ),
    )
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function panelRotationForSide(side: PartSide | undefined): Vec3 {
  switch (side) {
    case 'left':
    case 'right':
      return [0, Math.PI / 2, 0]
    case 'top':
    case 'bottom':
      return [Math.PI / 2, 0, 0]
    default:
      return [0, 0, 0]
  }
}

function defaultSurfacePosition(input: PartComposeInput, side: PartSide | undefined): Vec3 {
  const length = input.length ?? input.diameter ?? (input.radius ? input.radius * 2 : 1)
  const width =
    input.width ?? input.depth ?? input.diameter ?? (input.radius ? input.radius * 2 : 0.8)
  const height = input.height ?? 1.2
  switch (side) {
    case 'left':
      return [-length * 0.51, height * 0.56, 0]
    case 'right':
      return [length * 0.51, height * 0.56, 0]
    case 'back':
      return [0, height * 0.56, -width * 0.51]
    case 'top':
      return [0, height * 1.02, 0]
    case 'bottom':
      return [0, -height * 0.02, 0]
    default:
      return [0, height * 0.56, width * 0.51]
  }
}

function composeManwayLid(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const segmentDetail = detailSegmentLevel(input, part)
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'y') : partAxis(part.axis, 'y')
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side ?? 'top'))
  const radius = clamp(
    part.radius,
    input.radius ?? (input.diameter ? input.diameter / 2 : 0.18),
    0.04,
    1,
  )
  const thickness = clamp(part.thickness ?? part.depth ?? part.height, 0.035, 0.006, 0.25)
  const boltCount = clampInt(
    part.boltCount ?? part.count,
    detailDefaultInt(input, part, { low: 4, medium: 8, high: 12 }),
    0,
    24,
  )
  const lidMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.28, 0.78),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.55, 0.2)
  const role = genericPartRole(part, 'manway_lid')
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} manway lid`,
      semanticRole: role,
      position: center,
      axis,
      radius,
      height: thickness,
      radialSegments: ringSegments(segmentDetail),
      material: lidMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} manway gasket`,
      semanticRole: 'manway_gasket',
      position: offsetAlongAxis(center, axis, thickness * 0.55),
      axis,
      majorRadius: radius * 0.72,
      tubeRadius: radius * 0.035,
      radialSegments: 12,
      tubularSegments: Math.max(24, Math.round(ringSegments(segmentDetail) * 0.65)),
      material: darkMat,
    },
    {
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} manway handle`,
      semanticRole: 'manway_handle',
      position: offsetAlongAxis(center, axis, thickness * 0.9),
      axis: axis === 'x' ? 'z' : 'x',
      radius: Math.max(0.006, radius * 0.055),
      height: radius * 0.78,
      radialSegments: 10,
      capSegments: 3,
      material: darkMat,
    },
  ]
  if (boltCount > 0) {
    shapes.push(
      ...composeBoltPattern(
        input,
        {
          ...part,
          name: `${part.name ?? input.name ?? 'object'} manway`,
          position: center,
          rotation: undefined,
          axis,
          radius: radius * 0.82,
          count: boltCount,
          depth: thickness * 1.3,
          wireRadius: radius * 0.045,
        },
        [0, 0, 0],
      ),
    )
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeSanitaryNozzle(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const segmentDetail = detailSegmentLevel(input, part)
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'y') : partAxis(part.axis, 'y')
  const sign = signForSide(side, axis)
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side ?? 'top'))
  const radius = clamp(part.radius, 0.08, 0.01, 0.5)
  const length = clamp(part.length ?? part.depth ?? part.height, 0.18, 0.03, 1)
  const mat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.24, 0.82),
  )
  const role = genericPartRole(part, 'sanitary_nozzle')
  const outer = offsetAlongAxis(center, axis, (length / 2) * sign)
  return applyPartRotation(
    [
      {
        kind: 'hollow-cylinder',
        name: `${part.name ?? input.name ?? 'object'} sanitary nozzle`,
        semanticRole: role,
        position: center,
        axis,
        radius,
        height: length,
        radialSegments: Math.max(20, Math.round(ringSegments(input.detail) * 0.55)),
        wallThickness: radius * 0.16,
        material: mat,
      },
      {
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'object'} sanitary clamp bead`,
        semanticRole: 'sanitary_clamp_bead',
        position: outer,
        axis,
        majorRadius: radius * 1.08,
        tubeRadius: radius * 0.08,
        radialSegments: 12,
        tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeFlangedNozzle(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const segmentDetail = detailSegmentLevel(input, part)
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'y') : partAxis(part.axis, 'y')
  const sign = signForSide(side, axis)
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side ?? 'front'))
  const radius = clamp(part.radius, 0.09, 0.015, 0.8)
  const length = clamp(part.length ?? part.depth ?? part.height, 0.26, 0.06, 1.8)
  const flangeRadius = clamp(part.flangeRadius, radius * 1.75, radius * 1.1, radius * 3.2)
  const flangeThickness = clamp(part.flangeThickness ?? part.thickness, radius * 0.28, 0.008, 0.22)
  const mat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.24, 0.82),
  )
  const role = genericPartRole(part, 'flanged_nozzle')
  const nozzleCenter = offsetAlongAxis(center, axis, length * 0.22 * sign)
  const flangeCenter = offsetAlongAxis(center, axis, length * 0.58 * sign)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} flanged nozzle neck`,
      semanticRole: role,
      sourcePartKind: 'flanged_nozzle',
      position: nozzleCenter,
      axis,
      radius,
      height: length,
      radialSegments: Math.max(24, Math.round(ringSegments(segmentDetail) * 0.65)),
      wallThickness: radius * 0.14,
      material: mat,
    },
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} nozzle flange`,
      semanticRole: 'nozzle_flange',
      sourcePartKind: 'flanged_nozzle',
      position: flangeCenter,
      axis,
      radius: flangeRadius,
      height: flangeThickness,
      wallThickness: Math.max(radius * 0.22, flangeRadius - radius * 1.05),
      radialSegments: ringSegments(segmentDetail),
      material: mat,
    },
  ]
  if (part.includeBolts !== false) {
    shapes.push(
      ...composeBoltPattern(
        input,
        {
          ...part,
          name: `${part.name ?? input.name ?? 'object'} nozzle flange`,
          position: flangeCenter,
          rotation: undefined,
          axis,
          radius: flangeRadius * 0.76,
          count: clampInt(
            part.boltCount ?? part.count,
            detailDefaultInt(input, part, { low: 4, medium: 8, high: 12 }),
            0,
            24,
          ),
          depth: flangeThickness * 1.4,
          wireRadius: flangeRadius * 0.035,
        },
        [0, 0, 0],
      ),
    )
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeInspectionHatch(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'z') : partAxis(part.axis, 'z')
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side ?? 'front'))
  const radius = clamp(part.radius, 0.18, 0.04, 1.2)
  const thickness = clamp(part.thickness ?? part.depth ?? part.height, 0.035, 0.006, 0.28)
  const hatchMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.3, 0.75),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.55, 0.18)
  const role = genericPartRole(part, 'inspection_hatch')
  const handleAxis = axis === 'x' ? 'z' : 'x'
  return applyPartRotation(
    [
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} inspection hatch cover`,
        semanticRole: role,
        sourcePartKind: 'inspection_hatch',
        position: center,
        axis,
        radius,
        height: thickness,
        radialSegments: ringSegments(input.detail),
        material: hatchMat,
      },
      {
        kind: 'box',
        name: `${part.name ?? input.name ?? 'object'} hatch hinge block`,
        semanticRole: 'hatch_hinge',
        sourcePartKind: 'inspection_hatch',
        position: add(offsetAlongAxis(center, axis, thickness * 0.7), [radius * 0.78, 0, 0]),
        length: radius * 0.18,
        width: thickness * 1.2,
        height: radius * 0.42,
        material: darkMat,
      },
      {
        kind: 'capsule',
        name: `${part.name ?? input.name ?? 'object'} hatch handle`,
        semanticRole: 'hatch_handle',
        sourcePartKind: 'inspection_hatch',
        position: offsetAlongAxis(center, axis, thickness * 0.95),
        axis: handleAxis,
        radius: Math.max(0.006, radius * 0.045),
        height: radius * 0.72,
        radialSegments: 10,
        capSegments: 3,
        material: darkMat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeJacketShell(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'y')
  const radius = clamp(
    part.radius,
    input.radius ? input.radius * 1.06 : (input.diameter ?? 1) * 0.53,
    0.08,
    3,
  )
  const height = clamp(part.height, (input.height ?? 1.4) * 0.74, 0.12, 8)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const opacity = clamp(part.opacity, 0.28, 0.08, 1)
  const mat = partMaterial(
    part,
    material(part.primaryColor ?? input.secondaryColor ?? '#dbe3ea', 0.3, 0.56, opacity),
  )
  const seamMat = material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.24, 0.82)
  const role = genericPartRole(part, 'jacket_shell')
  return applyPartRotation(
    [
      {
        kind: 'hollow-cylinder',
        name: `${part.name ?? input.name ?? 'object'} jacket shell`,
        semanticRole: role,
        position: center,
        axis,
        radius,
        height,
        radialSegments: ringSegments(input.detail),
        wallThickness: clamp(part.thickness, radius * 0.025, 0.004, 0.12),
        material: mat,
      },
      {
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'object'} jacket upper seam`,
        semanticRole: 'jacket_seam',
        position: offsetAlongAxis(center, axis, height * 0.5),
        axis,
        majorRadius: radius,
        tubeRadius: radius * 0.018,
        radialSegments: 12,
        tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
        material: seamMat,
      },
      {
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'object'} jacket lower seam`,
        semanticRole: 'jacket_seam',
        position: offsetAlongAxis(center, axis, -height * 0.5),
        axis,
        majorRadius: radius,
        tubeRadius: radius * 0.018,
        radialSegments: 12,
        tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
        material: seamMat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeSightGlass(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side) ?? 'front'
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side))
  const length = clamp(part.length, 0.18, 0.03, 1.4)
  const height = clamp(part.height ?? part.width, 0.24, 0.03, 1.6)
  const thickness = clamp(part.thickness ?? part.depth, 0.012, 0.002, 0.08)
  const rotation = part.rotation ?? panelRotationForSide(side)
  const glass = material(
    part.color ?? input.accentColor ?? '#93c5fd',
    0.06,
    0.02,
    clamp(part.opacity, 0.42, 0.12, 0.9),
  )
  const rim = material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.25, 0.82)
  const role = genericPartRole(part, 'sight_glass')
  return [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} sight glass rim`,
      semanticRole: 'sight_glass_rim',
      position: center,
      rotation,
      length: length * 1.18,
      width: height * 1.14,
      thickness: thickness * 1.25,
      cornerRadius: Math.min(length, height) * 0.16,
      cornerSegments: 5,
      material: rim,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} sight glass`,
      semanticRole: role,
      position: offsetAlongAxis(
        center,
        axisForSide(side, 'z'),
        signForSide(side, axisForSide(side, 'z')) * thickness * 0.8,
      ),
      rotation,
      length,
      width: height,
      thickness,
      cornerRadius: Math.min(length, height) * 0.14,
      cornerSegments: 5,
      material: glass,
    },
  ]
}

function composeSampleValve(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side) ?? 'front'
  const axis = axisForSide(side, 'z')
  const sign = signForSide(side, axis)
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side))
  const radius = clamp(part.radius, 0.045, 0.008, 0.25)
  const length = clamp(part.length ?? part.depth ?? part.height, 0.22, 0.04, 0.8)
  const mat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.27, 0.78),
  )
  const dark = material(part.darkColor ?? input.darkColor ?? '#111827', 0.48, 0.35)
  const role = genericPartRole(part, 'sample_valve')
  const knobCenter = offsetAlongAxis(center, axis, length * 0.42 * sign)
  return applyPartRotation(
    [
      {
        kind: 'hollow-cylinder',
        name: `${part.name ?? input.name ?? 'object'} sample valve nozzle`,
        semanticRole: role,
        position: center,
        axis,
        radius,
        height: length,
        radialSegments: 20,
        wallThickness: radius * 0.18,
        material: mat,
      },
      {
        kind: 'sphere',
        name: `${part.name ?? input.name ?? 'object'} sample valve body`,
        semanticRole: 'sample_valve_body',
        position: knobCenter,
        radius: radius * 1.25,
        widthSegments: 20,
        heightSegments: 12,
        material: mat,
      },
      {
        kind: 'capsule',
        name: `${part.name ?? input.name ?? 'object'} sample valve handle`,
        semanticRole: 'sample_valve_handle',
        position: offsetAlongAxis(knobCenter, 'y', radius * 1.35),
        axis: 'x',
        radius: radius * 0.18,
        height: radius * 3.2,
        radialSegments: 10,
        capSegments: 3,
        material: dark,
      },
    ],
    center,
    part.rotation,
  )
}

function composeInstrumentPort(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'y') : partAxis(part.axis, 'y')
  const sign = signForSide(side, axis)
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side ?? 'top'))
  const radius = clamp(part.radius, 0.035, 0.006, 0.22)
  const length = clamp(part.length ?? part.depth ?? part.height, 0.16, 0.03, 0.7)
  const mat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#cbd5e1', 0.24, 0.8),
  )
  const dark = material(part.darkColor ?? input.darkColor ?? '#0f172a', 0.48, 0.3)
  const role = genericPartRole(part, 'instrument_port')
  const head = offsetAlongAxis(center, axis, length * 0.62 * sign)
  return applyPartRotation(
    [
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} instrument stem`,
        semanticRole: role,
        position: center,
        axis,
        radius,
        height: length,
        radialSegments: 18,
        material: mat,
      },
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} instrument gauge`,
        semanticRole: 'instrument_gauge',
        position: head,
        axis,
        radius: radius * 1.8,
        height: radius * 0.65,
        radialSegments: 24,
        material: dark,
      },
    ],
    center,
    part.rotation,
  )
}

function composeStainlessHighlightPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side) ?? 'front'
  const center = add(origin, part.position ?? defaultSurfacePosition(input, side))
  const length = clamp(part.length, (input.length ?? input.diameter ?? 1) * 0.16, 0.02, 1.2)
  const height = clamp(part.height ?? part.width, (input.height ?? 1.2) * 0.55, 0.04, 4)
  const thickness = clamp(part.thickness ?? part.depth, 0.006, 0.001, 0.05)
  const mat = partMaterial(
    part,
    material(part.color ?? '#f8fafc', 0.18, 0.68, clamp(part.opacity, 0.5, 0.12, 0.95)),
  )
  return [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} stainless highlight panel`,
      semanticRole: genericPartRole(part, 'stainless_highlight_panel'),
      position: center,
      rotation: part.rotation ?? panelRotationForSide(side),
      length,
      width: height,
      thickness,
      cornerRadius: Math.min(length, height) * 0.35,
      cornerSegments: 6,
      material: mat,
    },
  ]
}

function composeBoltPattern(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'z') : partAxis(part.axis, 'z')
  const center = add(origin, part.position ?? [0, 0.55, 0.5])
  const radius = clamp(part.radius, 0.12, 0.01, 2)
  const count = clampInt(part.boltCount ?? part.count, 6, 3, 32)
  const boltRadius = clamp(part.wireRadius ?? part.width, radius * 0.08, 0.003, 0.08)
  const boltDepth = clamp(part.depth ?? part.height, boltRadius * 1.5, 0.004, 0.2)
  const boltMat = partMaterial(part, material(input.darkColor ?? '#1f2937', 0.42, 0.5))
  const pattern = {
    id: `${part.id ?? part.sourcePartId ?? part.name ?? 'bolt_pattern'}_radial`,
    kind: 'radial' as const,
    semanticRole: part.semanticRole ?? 'bolt_pattern',
    count,
    axis,
    radius,
    startAngle: 0,
    endAngle: Math.PI * 2,
    mode: 'expanded' as const,
  }
  const shapes = Array.from({ length: count }, (_, i) => {
    const angle = angularStep(i, count)
    return {
      kind: 'cylinder' as const,
      name: `${part.name ?? input.name ?? 'object'} bolt ${i + 1}`,
      position: radialPointOnAxis(center, axis, angle, radius),
      axis,
      radius: boltRadius,
      height: boltDepth,
      radialSegments: 12,
      pattern,
      material: boltMat,
    }
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function composeControlBox(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.32, 0.62, 0.24])
  const width = clamp(part.width ?? part.length, 0.24, 0.04, 1.5)
  const height = clamp(part.height, 0.32, 0.06, 1.5)
  const depth = clamp(part.depth, 0.11, 0.025, 0.7)
  const boxMat = partMaterial(part, material(input.secondaryColor ?? '#334155', 0.55, 0.18))
  return [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} control box`,
      position: center,
      length: width,
      width: depth,
      height,
      cornerRadius: Math.min(width, depth, height) * 0.08,
      cornerSegments: 4,
      material: boxMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} control face plate`,
      position: [center[0], center[1], center[2] + depth * 0.52],
      length: width * 0.78,
      width: height * 0.62,
      thickness: depth * 0.08,
      cornerRadius: Math.min(width, height) * 0.025,
      cornerSegments: 4,
      material: material(input.darkColor ?? '#0f172a', 0.5, 0.08),
    },
  ]
}

function composeRibbedMotorBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'x')
  const center = add(origin, part.position ?? [-0.24, 0.42, 0])
  const radius = clamp(part.radius, 0.18, 0.04, 1)
  const length = clamp(part.length ?? part.depth, 0.48, 0.12, 3)
  const finCount = clampInt(part.slatCount ?? part.count, 8, 3, 20)
  const bodyMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.46, 0.42))
  const darkMat = material(input.darkColor ?? '#1f2937', 0.5, 0.28)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ribbed motor body`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: ringSegments(input.detail),
      material: bodyMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} motor front end cap`,
      position: offsetAlongAxis(center, axis, length * 0.53),
      axis,
      radius: radius * 0.92,
      height: length * 0.08,
      radialSegments: ringSegments(input.detail),
      material: darkMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} motor rear fan cover`,
      position: offsetAlongAxis(center, axis, -length * 0.53),
      axis,
      radius: radius * 0.98,
      height: length * 0.1,
      radialSegments: ringSegments(input.detail),
      material: darkMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} motor shaft`,
      position: offsetAlongAxis(center, axis, length * 0.72),
      axis,
      radius: radius * 0.18,
      height: length * 0.32,
      radialSegments: 20,
      material: material(input.metalColor ?? '#cbd5e1', 0.28, 0.78),
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} motor terminal box`,
      position: [center[0], center[1] + radius * 1.05, center[2]],
      length: length * 0.34,
      width: radius * 0.72,
      height: radius * 0.38,
      cornerRadius: radius * 0.05,
      cornerSegments: 3,
      material: darkMat,
    },
  ]

  for (let i = 0; i < finCount; i += 1) {
    const z = center[2] + (i - (finCount - 1) / 2) * ((radius * 1.55) / Math.max(1, finCount - 1))
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} motor cooling fin ${i + 1}`,
      position: [center[0], center[1] + radius * 0.98, z],
      length: length * 0.82,
      width: radius * 0.025,
      height: radius * 0.18,
      cornerRadius: radius * 0.01,
      cornerSegments: 2,
      material: bodyMat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeConveyorFrame(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.38, 0])
  const length = clamp(part.length, 1.4, 0.3, 6)
  const width = clamp(part.width, 0.42, 0.12, 2)
  const height = clamp(part.height, 0.42, 0.12, 2)
  const railSize = clamp(part.radius, 0.025, 0.006, 0.12)
  const mat = partMaterial(part, material(input.metalColor ?? '#94a3b8', 0.34, 0.72))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} conveyor left rail`,
      position: [center[0], center[1] + height * 0.2, center[2] - width / 2],
      length,
      width: railSize,
      height: railSize,
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} conveyor right rail`,
      position: [center[0], center[1] + height * 0.2, center[2] + width / 2],
      length,
      width: railSize,
      height: railSize,
      material: mat,
    },
  ]

  const legPairs = clampInt(
    part.legCount != null ? Math.ceil(part.legCount / 2) : undefined,
    2,
    1,
    8,
  )
  const legOffsets = Array.from({ length: legPairs }, (_, index) =>
    legPairs === 1 ? 0 : -0.44 + (0.88 * index) / (legPairs - 1),
  )
  for (const x of legOffsets) {
    for (const z of [-0.5, 0.5]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} conveyor support leg`,
        position: [center[0] + x * length, center[1] - height * 0.26, center[2] + z * width],
        axis: 'y',
        radius: railSize * 0.58,
        height,
        radialSegments: 12,
        material: mat,
      })
    }
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeRollerArray(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.52, 0])
  const count = clampInt(part.count, 7, 2, 32)
  const length = clamp(part.length, 1.2, 0.2, 6)
  const width = clamp(part.width, 0.46, 0.08, 2)
  const radius = clamp(part.radius, 0.035, 0.008, 0.18)
  const mat = partMaterial(part, material(input.metalColor ?? '#cbd5e1', 0.26, 0.82))
  const pattern = {
    id: `${part.id ?? part.sourcePartId ?? part.name ?? 'roller_array'}_linear`,
    kind: 'linear' as const,
    semanticRole: part.semanticRole ?? 'roller_array',
    count,
    axis: 'x' as const,
    spacing: count > 1 ? length / (count - 1) : 0,
    mode: 'expanded' as const,
  }
  const shapes = Array.from({ length: count }, (_, i) => ({
    kind: 'cylinder' as const,
    name: `${part.name ?? input.name ?? 'object'} conveyor roller ${i + 1}`,
    position: [
      center[0] + (i - (count - 1) / 2) * (length / Math.max(1, count - 1)),
      center[1],
      center[2],
    ] as Vec3,
    axis: 'z',
    radius,
    height: width,
    radialSegments: 20,
    pattern,
    material: mat,
  }))
  return applyPartRotation(shapes, center, part.rotation)
}

function composeBeltSurface(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.56, 0])
  const length = clamp(part.length, 1.35, 0.2, 6)
  const width = clamp(part.width, 0.46, 0.08, 2)
  const thickness = clamp(part.height ?? part.depth, 0.025, 0.004, 0.12)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} conveyor belt surface`,
      position: center,
      length,
      width,
      height: thickness,
      cornerRadius: thickness * 0.4,
      cornerSegments: 3,
      material: partMaterial(part, material(input.darkColor ?? '#111827', 0.64, 0.02)),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeCylindricalTank(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'x')
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const radius = clamp(part.radius, 0.24, 0.05, 2)
  const length = clamp(part.length ?? part.height, 0.9, 0.16, 24)
  const wallThickness = clamp(
    part.thickness ?? part.shellThickness,
    radius * 0.075,
    radius * 0.02,
    radius * 0.28,
  )
  const mat = partMaterial(part, material(input.primaryColor ?? '#94a3b8', 0.42, 0.48))
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.76)
  const dark = material(input.darkColor ?? '#1f2937', 0.56, 0.24)
  const supportMat = material(input.darkColor ?? '#334155', 0.58, 0.36)
  const headScale = axis === 'x' ? [radius * 0.36, radius, radius] : [radius, radius * 0.36, radius]
  const leftEnd = offsetAlongAxis(center, axis, -length * 0.52)
  const rightEnd = offsetAlongAxis(center, axis, length * 0.52)
  const topNozzleCenter: Vec3 = [center[0], center[1] + radius * 1.08, center[2]]
  const manwayCenter: Vec3 =
    axis === 'x'
      ? [center[0] - length * 0.18, center[1], center[2] + radius * 1.04]
      : [center[0] + radius * 1.04, center[1] + length * 0.16, center[2]]
  const manwayAxis = axis === 'x' ? 'z' : 'x'
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} cylindrical tank shell`,
      semanticRole: part.semanticRole ?? 'vessel_shell',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: center,
      axis,
      radius,
      height: length,
      wallThickness,
      radialSegments: ringSegments(input.detail),
      duct: {
        crossSection: 'round',
        radius,
        wallThickness,
      },
      ports: [
        {
          id: 'vessel_left_head',
          kind: 'support',
          semanticRole: 'vessel_head',
          position: leftEnd,
          normal: axisNormal(axis, -1),
          axis,
          radius,
          direction: 'bidirectional',
        },
        {
          id: 'vessel_right_head',
          kind: 'support',
          semanticRole: 'vessel_head',
          position: rightEnd,
          normal: axisNormal(axis, 1),
          axis,
          radius,
          direction: 'bidirectional',
        },
        {
          id: 'top_nozzle',
          kind: 'generic',
          semanticRole: 'top_nozzle',
          position: topNozzleCenter,
          normal: axisNormal('y', 1),
          axis: 'y',
          radius: radius * 0.16,
          direction: 'bidirectional',
        },
        {
          id: 'manway',
          kind: 'access',
          semanticRole: 'manway_flange',
          position: manwayCenter,
          normal: axisNormal(manwayAxis, 1),
          axis: manwayAxis,
          radius: radius * 0.22,
          direction: 'bidirectional',
        },
      ],
      cutouts: [
        {
          id: 'top_nozzle_opening',
          kind: 'round',
          semanticRole: 'top_nozzle',
          position: topNozzleCenter,
          normal: axisNormal('y', 1),
          axis: 'y',
          radius: radius * 0.16,
          through: true,
          bevelRadius: wallThickness * 0.5,
        },
        {
          id: 'manway_opening',
          kind: 'round',
          semanticRole: 'manway_flange',
          position: manwayCenter,
          normal: axisNormal(manwayAxis, 1),
          axis: manwayAxis,
          radius: radius * 0.22,
          through: true,
          bevelRadius: wallThickness * 0.5,
        },
      ],
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} tank left dished end`,
      semanticRole: 'vessel_head',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: leftEnd,
      radius: 1,
      scale: headScale as Vec3,
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} tank right dished end`,
      semanticRole: 'vessel_head',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: rightEnd,
      radius: 1,
      scale: headScale as Vec3,
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} tank left seam ring`,
      semanticRole: 'vessel_seam',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: leftEnd,
      axis,
      majorRadius: radius * 1.01,
      tubeRadius: wallThickness * 0.48,
      radialSegments: 10,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.7)),
      material: metal,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} tank right seam ring`,
      semanticRole: 'vessel_seam',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: rightEnd,
      axis,
      majorRadius: radius * 1.01,
      tubeRadius: wallThickness * 0.48,
      radialSegments: 10,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.7)),
      material: metal,
    },
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} tank top nozzle`,
      semanticRole: 'top_nozzle',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: topNozzleCenter,
      axis: 'y',
      radius: radius * 0.16,
      height: radius * 0.35,
      wallThickness: wallThickness * 0.65,
      radialSegments: 20,
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} tank manway flange`,
      semanticRole: 'manway_flange',
      sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
      position: manwayCenter,
      axis: manwayAxis,
      radius: radius * 0.22,
      height: wallThickness * 3,
      radialSegments: 28,
      material: dark,
    },
  ]
  if (axis === 'x') {
    for (const x of [-length * 0.28, length * 0.28]) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'object'} tank saddle support`,
        semanticRole: 'saddle_support',
        sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
        position: [center[0] + x, center[1] - radius * 0.86, center[2]],
        length: radius * 0.48,
        width: radius * 1.72,
        height: radius * 0.32,
        cornerRadius: radius * 0.08,
        cornerSegments: 3,
        material: supportMat,
      })
    }
  } else {
    for (const [x, z] of [
      [radius * 0.72, radius * 0.72],
      [radius * 0.72, -radius * 0.72],
      [-radius * 0.72, radius * 0.72],
      [-radius * 0.72, -radius * 0.72],
    ] as const) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} tank support leg`,
        semanticRole: 'support_leg',
        sourcePartKind: part.sourcePartKind ?? 'cylindrical_tank',
        position: [center[0] + x, center[1] - length * 0.5 - radius * 0.28, center[2] + z],
        axis: 'y',
        radius: radius * 0.045,
        height: radius * 0.56,
        radialSegments: 12,
        material: supportMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeChimneyStack(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const height = clamp(part.height ?? part.length, 6, 0.6, 80)
  const baseRadius = clamp(part.radius ?? part.width ?? part.diameter, height * 0.055, 0.05, 6)
  const topRadius = clamp(part.topRadius, baseRadius * 0.72, baseRadius * 0.28, baseRadius)
  const rawCenter = add(origin, part.position ?? [0, height / 2, 0])
  const center: Vec3 = [rawCenter[0], Math.max(rawCenter[1], origin[1] + height / 2), rawCenter[2]]
  const shaftMaterial = partMaterial(part, material(input.primaryColor ?? '#d8d4ca', 0.58, 0.18))
  const concreteMaterial = material('#d8d4ca', 0.62, 0.12)
  const redMaterial = material(part.secondaryColor ?? input.secondaryColor ?? '#b91c1c', 0.46, 0.22)
  const whiteMaterial = material('#f8fafc', 0.5, 0.1)
  const darkMaterial = material(input.darkColor ?? '#111827', 0.5, 0.25)
  const radiusAt = (y: number) => {
    const t = Math.max(0, Math.min(1, y / height))
    return baseRadius + (topRadius - baseRadius) * t
  }
  const makeBand = (
    name: string,
    yMin: number,
    yMax: number,
    bandMaterial: PrimitiveMaterialInput,
    semanticRole: string,
    oversize = 1.018,
  ): PrimitiveShapeInput => ({
    kind: 'frustum',
    name,
    semanticRole,
    sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
    position: [center[0], center[1] - height / 2 + (yMin + yMax) / 2, center[2]],
    axis: 'y',
    radiusBottom: radiusAt(yMin) * oversize,
    radiusTop: radiusAt(yMax) * oversize,
    height: yMax - yMin,
    radialSegments: ringSegments(input.detail),
    material: bandMaterial,
  })

  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'chimney'} tapered chimney shell`,
      semanticRole: part.semanticRole ?? 'chimney_body',
      sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
      position: center,
      axis: 'y',
      radiusBottom: baseRadius,
      radiusTop: topRadius,
      height,
      radialSegments: ringSegments(input.detail),
      material: shaftMaterial,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'chimney'} reinforced base plinth`,
      semanticRole: 'chimney_base',
      sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
      position: [center[0], center[1] - height / 2 + height * 0.025, center[2]],
      axis: 'y',
      radius: baseRadius * 1.42,
      height: height * 0.05,
      radialSegments: ringSegments(input.detail),
      material: concreteMaterial,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'chimney'} top rim`,
      semanticRole: 'chimney_top_rim',
      sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
      position: [center[0], center[1] + height / 2, center[2]],
      axis: 'y',
      majorRadius: topRadius * 1.03,
      tubeRadius: Math.max(topRadius * 0.045, 0.012),
      radialSegments: ringSegments(input.detail),
      tubularSegments: 12,
      material: darkMaterial,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'chimney'} lower access door`,
      semanticRole: 'access_door',
      sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
      position: [center[0], center[1] - height * 0.42, center[2] + baseRadius * 1.025],
      rotation: [Math.PI / 2, 0, 0],
      length: baseRadius * 0.46,
      width: height * 0.11,
      thickness: Math.max(baseRadius * 0.025, 0.006),
      cornerRadius: baseRadius * 0.03,
      cornerSegments: 3,
      material: darkMaterial,
    },
  ]

  const seamCount = clampInt(part.ringCount, Math.max(5, Math.round(height / 1.1)), 3, 24)
  for (let i = 1; i < seamCount; i += 1) {
    const y = (height * i) / seamCount
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'chimney'} concrete lift seam`,
      semanticRole: 'chimney_seam_ring',
      sourcePartKind: part.sourcePartKind ?? 'chimney_stack',
      position: [center[0], center[1] - height / 2 + y, center[2]],
      axis: 'y',
      majorRadius: radiusAt(y) * 1.012,
      tubeRadius: Math.max(baseRadius * 0.006, 0.004),
      radialSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.6)),
      tubularSegments: 8,
      material: material('#b8b4aa', 0.64, 0.08),
    })
  }

  const stripeIntent = `${part.variant ?? ''} ${part.style ?? ''} ${input.name ?? ''}`.toLowerCase()
  const warningStripes =
    part.warningStripes === true || /red.?white|stripe|striped|warning|红白|紅白/.test(stripeIntent)
  if (warningStripes) {
    const stripeCount = clampInt(part.stripeCount ?? part.count, 5, 2, 12)
    const stripeZoneHeight = clamp(part.stripeHeight, height * 0.36, height * 0.12, height * 0.7)
    const yStart = height - stripeZoneHeight
    const stripeStep = stripeZoneHeight / stripeCount
    for (let i = 0; i < stripeCount; i += 1) {
      const yMin = yStart + i * stripeStep
      const yMax = yStart + (i + 1) * stripeStep
      shapes.push(
        makeBand(
          `${part.name ?? input.name ?? 'chimney'} ${i % 2 === 0 ? 'red' : 'white'} warning band`,
          yMin,
          yMax,
          i % 2 === 0 ? redMaterial : whiteMaterial,
          i % 2 === 0 ? 'chimney_warning_red_band' : 'chimney_warning_white_band',
        ),
      )
    }
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeValveBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const ballValve = isBallValveIntent(input, part)
  const axis = partAxis(part.axis, 'x')
  const center = add(origin, part.position ?? [0, 0.38, 0])
  const radius = clamp(part.radius, 0.12, 0.03, 0.8)
  const length = clamp(part.length ?? part.depth, 0.46, 0.12, 2)
  const mat = partMaterial(part, material(input.primaryColor ?? '#475569', 0.45, 0.45))
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const darkMat = material(input.darkColor ?? '#1f2937', 0.42, 0.5)
  const bonnetY = center[1] + radius * 1.16
  const yokeBaseY = center[1] + radius * 1.72
  const ballValveDetails: PrimitiveShapeInput[] = [
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} valve ball`,
      position: center,
      radius: 1,
      scale: [radius * 0.68, radius * 0.68, radius * 0.68],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: metalMat,
      semanticRole: 'valve_ball',
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} valve ball bore`,
      position: center,
      axis,
      radius: radius * 0.24,
      height: length * 0.72,
      radialSegments: 20,
      material: darkMat,
      semanticRole: 'valve_bore',
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} inlet seat ring`,
      position: offsetAlongAxis(center, axis, -length * 0.28),
      axis,
      majorRadius: radius * 0.38,
      tubeRadius: radius * 0.035,
      radialSegments: 8,
      tubularSegments: 32,
      material: darkMat,
      semanticRole: 'seat_ring',
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} outlet seat ring`,
      position: offsetAlongAxis(center, axis, length * 0.28),
      axis,
      majorRadius: radius * 0.38,
      tubeRadius: radius * 0.035,
      radialSegments: 8,
      tubularSegments: 32,
      material: darkMat,
      semanticRole: 'seat_ring',
    },
  ]
  const gateValveDetails: PrimitiveShapeInput[] = [
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} valve gate wedge`,
      position: [center[0], center[1] - radius * 0.1, center[2]],
      length: radius * 0.8,
      width: radius * 0.42,
      height: radius * 0.72,
      slopeAxis: 'x',
      slopeDirection: 'positive',
      material: material(input.secondaryColor ?? '#334155', 0.48, 0.35),
      semanticRole: 'gate_wedge',
    },
  ]
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} valve body barrel`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: ringSegments(input.detail),
      material: mat,
      semanticRole: 'valve_body',
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} valve bulb chamber`,
      position: center,
      radius: 1,
      scale: [radius * 1.08, radius * 1.2, radius * 1.08],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
      semanticRole: 'valve_body',
    },
    ...(ballValve ? ballValveDetails : gateValveDetails),
    {
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'object'} valve bonnet`,
      position: [center[0], bonnetY, center[2]],
      axis: 'y',
      radiusBottom: radius * 0.62,
      radiusTop: radius * 0.42,
      height: radius * 0.42,
      radialSegments: Math.max(20, Math.round(ringSegments(input.detail) * 0.55)),
      material: mat,
      semanticRole: 'bonnet',
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} valve stem`,
      position: [center[0], center[1] + radius * 1.35, center[2]],
      axis: 'y',
      radius: radius * 0.18,
      height: radius * 0.9,
      radialSegments: 16,
      material: metalMat,
      semanticRole: 'stem',
    },
  ]
  if (!ballValve) {
    for (const z of [-radius * 0.48, radius * 0.48]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} valve yoke post`,
        position: [center[0], yokeBaseY, center[2] + z],
        axis: 'y',
        radius: radius * 0.08,
        height: radius * 0.95,
        radialSegments: 12,
        material: metalMat,
        semanticRole: 'yoke',
      })
    }
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} valve yoke bridge`,
      position: [center[0], yokeBaseY + radius * 0.48, center[2]],
      axis: 'z',
      radius: radius * 0.07,
      height: radius * 1.15,
      radialSegments: 12,
      material: metalMat,
      semanticRole: 'yoke',
    })
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * Math.PI * 2) / 6
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} valve bonnet bolt ${i + 1}`,
      position: [
        center[0] + Math.cos(angle) * radius * 0.54,
        bonnetY - radius * 0.22,
        center[2] + Math.sin(angle) * radius * 0.54,
      ],
      axis: 'y',
      radius: radius * 0.045,
      height: radius * 0.12,
      radialSegments: 8,
      material: darkMat,
      semanticRole: 'bonnet_bolts',
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeHandwheel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const leverHandle = /lever|handle|bar|手柄|把手/i.test(partIntentText(input, part))
  const axis = partAxis(part.axis, 'y')
  const center = add(origin, part.position ?? [0, 0.62, 0])
  const radius = clamp(part.radius, 0.11, 0.025, 0.6)
  const wire = clamp(part.wireRadius, radius * 0.08, 0.002, 0.04)
  const spokeCount = clampInt(part.spokeCount ?? part.count, 4, 3, 8)
  const mat = partMaterial(part, material(input.darkColor ?? '#1f2937', 0.45, 0.45))
  if (leverHandle) {
    const leverLength = clamp(part.length, radius * 2.6, radius * 1.1, radius * 5)
    return applyPartRotation(
      [
        {
          kind: 'cylinder',
          name: `${part.name ?? input.name ?? 'object'} handwheel hub`,
          position: center,
          axis: 'y',
          radius: radius * 0.22,
          height: wire * 3.2,
          radialSegments: 16,
          material: mat,
        },
        {
          kind: 'capsule',
          name: `${part.name ?? input.name ?? 'object'} lever handle`,
          position: [center[0], center[1], center[2] + leverLength * 0.42] as Vec3,
          axis: 'z',
          radius: wire,
          height: leverLength,
          radialSegments: 12,
          material: mat,
        },
        {
          kind: 'sphere',
          name: `${part.name ?? input.name ?? 'object'} lever end knob`,
          position: [center[0], center[1], center[2] + leverLength * 0.92] as Vec3,
          radius: wire * 2.3,
          material: mat,
        },
      ],
      center,
      part.rotation,
    )
  }
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} handwheel rim`,
      position: center,
      axis,
      majorRadius: radius,
      tubeRadius: wire,
      radialSegments: 12,
      tubularSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} handwheel hub`,
      position: center,
      axis,
      radius: radius * 0.22,
      height: wire * 2.6,
      radialSegments: 16,
      material: mat,
    },
  ]
  for (let i = 0; i < spokeCount; i += 1) {
    const angle = angularStep(i, spokeCount)
    const position = radialPointOnAxis(center, axis, angle, radius * 0.5)
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} handwheel spoke ${i + 1}`,
      position,
      rotation: axis === 'y' ? [0, 0, angle] : [0, angle, 0],
      axis: axis === 'y' ? 'x' : 'z',
      radius: wire * 0.5,
      height: radius,
      radialSegments: 8,
      material: mat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeBicycleWheels(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.32, 0])
  const wheelRadius = clamp(part.radius, 0.22, 0.06, 1)
  const length = clamp(part.length, 0.86, 0.25, 3)
  const count = clampInt(part.count, 2, 1, 2)
  const tube = clamp(part.wireRadius, wheelRadius * 0.045, 0.004, 0.04)
  const tireMat = material(input.darkColor ?? '#111827', 0.68, 0.02)
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const shapes: PrimitiveShapeInput[] = []
  const positions = wheelSetPositions(count, length, 0)
  positions.forEach((offset, index) => {
    const label = count === 1 ? 'single' : index === 0 ? 'rear' : 'front'
    const wheelCenter: Vec3 = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]]
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} bicycle ${label} tire`,
      semanticRole: 'bicycle_tire',
      sourcePartKind: part.sourcePartKind ?? 'bicycle_wheels',
      position: wheelCenter,
      axis: 'z',
      majorRadius: wheelRadius,
      tubeRadius: tube * 1.7,
      radialSegments: 12,
      tubularSegments: ringSegments(input.detail),
      material: tireMat,
    })
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} bicycle ${label} rim`,
      semanticRole: 'bicycle_rim',
      sourcePartKind: part.sourcePartKind ?? 'bicycle_wheels',
      position: wheelCenter,
      axis: 'z',
      majorRadius: wheelRadius * 0.76,
      tubeRadius: tube * 0.55,
      radialSegments: 8,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
      material: metalMat,
    })
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} bicycle ${label} hub`,
      semanticRole: 'bicycle_hub',
      sourcePartKind: part.sourcePartKind ?? 'bicycle_wheels',
      position: wheelCenter,
      axis: 'z',
      radius: wheelRadius * 0.08,
      height: tube * 5,
      radialSegments: 16,
      material: metalMat,
    })
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI * 2) / 8
      shapes.push({
        ...tubeBetween(
          `${part.name ?? input.name ?? 'object'} bicycle ${label} spoke ${i + 1}`,
          wheelCenter,
          [
            wheelCenter[0] + Math.cos(angle) * wheelRadius * 0.72,
            wheelCenter[1] + Math.sin(angle) * wheelRadius * 0.72,
            wheelCenter[2],
          ],
          tube * 0.22,
          metalMat,
        ),
        semanticRole: 'bicycle_spoke',
        sourcePartKind: part.sourcePartKind ?? 'bicycle_wheels',
      })
    }
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function composeBicycleFrame(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.52, 0])
  const length = clamp(part.length, 0.86, 0.25, 3)
  const height = clamp(part.height, 0.36, 0.12, 1.5)
  const r = clamp(part.radius ?? part.wireRadius, 0.018, 0.004, 0.08)
  const mat = partMaterial(part, material(input.primaryColor ?? '#2563eb', 0.42, 0.18))
  const rear: Vec3 = [center[0] - length / 2, center[1] - height * 0.55, center[2]]
  const front: Vec3 = [center[0] + length / 2, center[1] - height * 0.55, center[2]]
  const seat: Vec3 = [center[0] - length * 0.12, center[1] + height * 0.35, center[2]]
  const head: Vec3 = [center[0] + length * 0.34, center[1] + height * 0.28, center[2]]
  const bottom: Vec3 = [center[0] - length * 0.02, center[1] - height * 0.2, center[2]]
  const pedalOffset = Math.max(r * 4.5, 0.08)
  const pedalLength = Math.max(r * 3.5, 0.07)
  const metalMat = material(input.darkColor ?? '#111827', 0.48, 0.35)
  const shapes: PrimitiveShapeInput[] = [
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle top tube`, seat, head, r, mat),
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle down tube`, head, bottom, r, mat),
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle seat tube`, seat, bottom, r, mat),
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle chain stay`, bottom, rear, r, mat),
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle seat stay`, seat, rear, r, mat),
    tubeBetween(`${part.name ?? input.name ?? 'object'} bicycle front stay`, head, front, r, mat),
    {
      kind: 'cylinder' as const,
      name: `${part.name ?? input.name ?? 'object'} bicycle crank`,
      position: bottom,
      axis: 'z',
      radius: r * 2.2,
      height: r * 3,
      radialSegments: 18,
      semanticRole: 'crank',
      material: metalMat,
    },
    {
      ...tubeBetween(
        `${part.name ?? input.name ?? 'object'} bicycle left crank arm`,
        bottom,
        [bottom[0], bottom[1] - r * 2.5, bottom[2] - pedalOffset],
        r * 0.38,
        metalMat,
      ),
      semanticRole: 'crank',
    },
    {
      ...tubeBetween(
        `${part.name ?? input.name ?? 'object'} bicycle right crank arm`,
        bottom,
        [bottom[0], bottom[1] + r * 2.5, bottom[2] + pedalOffset],
        r * 0.38,
        metalMat,
      ),
      semanticRole: 'crank',
    },
    {
      kind: 'box' as const,
      name: `${part.name ?? input.name ?? 'object'} bicycle left pedal`,
      position: [bottom[0], bottom[1] - r * 2.5, bottom[2] - pedalOffset - pedalLength * 0.4],
      length: pedalLength,
      width: r * 1.2,
      height: r * 0.75,
      semanticRole: 'pedal',
      material: metalMat,
    },
    {
      kind: 'box' as const,
      name: `${part.name ?? input.name ?? 'object'} bicycle right pedal`,
      position: [bottom[0], bottom[1] + r * 2.5, bottom[2] + pedalOffset + pedalLength * 0.4],
      length: pedalLength,
      width: r * 1.2,
      height: r * 0.75,
      semanticRole: 'pedal',
      material: metalMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeBicycleFork(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.37, 0.5, 0])
  const height = clamp(part.height, 0.42, 0.12, 1.5)
  const spread = clamp(part.width, 0.08, 0.02, 0.4)
  const r = clamp(part.radius ?? part.wireRadius, 0.014, 0.003, 0.06)
  const mat = partMaterial(part, material(input.metalColor ?? '#cbd5e1', 0.3, 0.75))
  const crown: Vec3 = [center[0], center[1] + height * BICYCLE_FORK_CROWN_RISE_RATIO, center[2]]
  const axle: Vec3 = [
    center[0] + height * BICYCLE_FORK_AXLE_FORWARD_RATIO,
    center[1] - height * BICYCLE_FORK_AXLE_DROP_RATIO,
    center[2],
  ]
  const shapes = [
    tubeBetween(
      `${part.name ?? input.name ?? 'object'} bicycle left fork blade`,
      [crown[0], crown[1], crown[2] - spread / 2],
      [axle[0], axle[1], axle[2] - spread / 2],
      r,
      mat,
    ),
    tubeBetween(
      `${part.name ?? input.name ?? 'object'} bicycle right fork blade`,
      [crown[0], crown[1], crown[2] + spread / 2],
      [axle[0], axle[1], axle[2] + spread / 2],
      r,
      mat,
    ),
    tubeBetween(
      `${part.name ?? input.name ?? 'object'} bicycle steerer tube`,
      crown,
      [
        crown[0] + height * BICYCLE_STEERER_FORWARD_RATIO,
        crown[1] + height * BICYCLE_STEERER_RISE_RATIO,
        crown[2],
      ],
      r,
      mat,
    ),
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeHandlebar(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.44, 0.78, 0])
  const width = clamp(part.width ?? part.length, 0.32, 0.06, 1.2)
  const stemDrop = clamp(part.height, width * 0.22, 0.025, 0.45)
  const r = clamp(part.radius ?? part.wireRadius, 0.014, 0.003, 0.06)
  const mat = partMaterial(part, material(input.metalColor ?? '#cbd5e1', 0.28, 0.78))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} handlebar crossbar`,
      position: center,
      axis: 'z',
      radius: r,
      height: width,
      radialSegments: 12,
      material: mat,
    },
    tubeBetween(
      `${part.name ?? input.name ?? 'object'} handlebar stem`,
      [center[0] - width * BICYCLE_HANDLEBAR_STEM_REACH_RATIO, center[1] - stemDrop, center[2]],
      center,
      r,
      mat,
    ),
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeSaddle(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [-0.12, 0.76, 0])
  const length = clamp(part.length, 0.18, 0.04, 0.6)
  const width = clamp(part.width, 0.12, 0.03, 0.4)
  const height = clamp(part.height, 0.035, 0.01, 0.16)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} saddle cushion`,
      position: center,
      length,
      width,
      height,
      cornerRadius: height * 0.55,
      cornerSegments: 5,
      material: partMaterial(part, material(input.darkColor ?? '#111827', 0.62, 0.02)),
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} saddle post`,
      position: [center[0], center[1] - height * 2.4, center[2]],
      axis: 'y',
      radius: height * 0.22,
      height: height * 3.6,
      radialSegments: 12,
      material: material(input.metalColor ?? '#cbd5e1', 0.3, 0.75),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeChainLoop(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [-0.23, 0.36, 0.018])
  const chainringRadius = clamp(part.radius, 0.105, 0.04, 0.24)
  const rearCogRadius = clamp(part.depth, chainringRadius * 0.52, 0.025, chainringRadius * 0.8)
  const span = clamp(part.length, 0.46, 0.22, 1.4)
  const tubeRadius = clamp(part.wireRadius, chainringRadius * 0.045, 0.002, 0.018)
  const chainHalfHeight = Math.max(chainringRadius * 0.62, rearCogRadius * 1.15)
  const frontX = span / 2
  const rearX = -span / 2
  const chainPath: Vec3[] = [
    [rearX, chainHalfHeight * 0.72, 0],
    [-span * 0.18, chainHalfHeight, 0],
    [frontX, chainHalfHeight, 0],
    [frontX + chainHalfHeight * 0.34, chainHalfHeight * 0.45, 0],
    [frontX + chainHalfHeight * 0.34, -chainHalfHeight * 0.45, 0],
    [frontX, -chainHalfHeight, 0],
    [-span * 0.18, -chainHalfHeight * 0.82, 0],
    [rearX, -chainHalfHeight * 0.58, 0],
    [rearX - chainHalfHeight * 0.28, -chainHalfHeight * 0.18, 0],
    [rearX - chainHalfHeight * 0.24, chainHalfHeight * 0.36, 0],
  ]
  const chainMat = partMaterial(part, material(input.darkColor ?? '#111827', 0.48, 0.35))
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.3, 0.7)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'sweep',
      name: `${part.name ?? input.name ?? 'object'} chain elongated loop`,
      position: center,
      path: chainPath,
      radius: tubeRadius,
      radialSegments: 6,
      tubularSegments: Math.max(32, Math.round(ringSegments(input.detail) * 0.7)),
      closed: true,
      semanticRole: 'chain_loop',
      material: chainMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} front chainring`,
      position: [center[0] + frontX, center[1], center[2] - tubeRadius * 1.6],
      axis: 'z',
      majorRadius: chainringRadius,
      tubeRadius: tubeRadius * 0.75,
      radialSegments: 8,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.55)),
      semanticRole: 'chainring',
      material: metalMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} rear sprocket`,
      position: [
        center[0] + rearX,
        center[1] - chainHalfHeight * 0.1,
        center[2] - tubeRadius * 1.6,
      ],
      axis: 'z',
      majorRadius: rearCogRadius,
      tubeRadius: tubeRadius * 0.65,
      radialSegments: 8,
      tubularSegments: 24,
      semanticRole: 'rear_sprocket',
      material: metalMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeVehicleBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const style = vehicleStyleFor(input, part)
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const length = vehicleLength(part, style)
  const width = vehicleWidth(part, style)
  const overallHeight = vehicleOverallHeight(part, length, width, style)
  const center = add(origin, part.position ?? [0, Math.max(0.34, overallHeight * 0.58), 0])
  const baseY = center[1] - overallHeight / 2
  const bodyHeight = clamp(
    part.bodyHeight,
    overallHeight * defaults.bodyHeightRatio,
    0.08,
    overallHeight * 0.65,
  )
  const cabinHeight = clamp(
    part.cabinHeight,
    overallHeight * defaults.cabinHeightRatio,
    0.06,
    overallHeight * 0.7,
  )
  const bodyY = baseY + overallHeight * 0.38
  const deckY = bodyY + bodyHeight * 0.48
  const cabinY = baseY + overallHeight * 0.72
  const bodyColor = part.primaryColor ?? part.color ?? input.primaryColor ?? '#ef4444'
  const mat = partMaterial(part, material(bodyColor, 0.42, 0.18))
  const shadowMat = material(part.darkColor ?? input.darkColor ?? '#1f2937', 0.58, 0.16)
  const bodyCornerRadius = clamp(
    part.cornerRadius,
    Math.min(length, width, bodyHeight) * 0.12,
    0,
    Math.min(length, width, bodyHeight) * 0.45,
  )
  const bodyCornerSegments = clampInt(part.cornerSegments, 6, 1, 12)
  const roofCornerAngle = clamp(part.roofCornerAngle, 90, 65, 90)
  const angleTopScale = roofCornerAngle < 90 ? 1 - (90 - roofCornerAngle) * 0.02 : undefined
  const cabinTopLengthScale = clamp(
    part.cabinTopLengthScale ?? part.cabinTopScale ?? angleTopScale,
    defaults.cabinTopScale,
    0.55,
    1,
  )
  const cabinTopWidthScale = clamp(
    part.cabinTopWidthScale ?? part.cabinTopScale ?? angleTopScale,
    defaults.cabinTopScale,
    0.55,
    1,
  )
  const useTaperedCabin = cabinTopLengthScale < 0.995 || cabinTopWidthScale < 0.995
  const cabinLength = length * defaults.cabinLengthRatio
  const cabinWidth = width * defaults.cabinWidthRatio
  const cabinX = center[0] + length * defaults.cabinXRatio
  const roofHeight = Math.max(bodyHeight * 0.06, 0.024)
  const cabinFrameHeight = Math.max(roofHeight * 1.4, cabinHeight * 0.14)
  const roofLength = cabinLength * cabinTopLengthScale * 0.96
  const roofWidth = cabinWidth * cabinTopWidthScale * 0.94
  const noseLength = style === 'truck' || style === 'van' ? length * 0.18 : length * 0.24
  const tailLength = style === 'sports' ? length * 0.22 : length * 0.18
  const fenderRadius = Math.min(overallHeight * 0.22, width * 0.2)
  const wheelWellRadius = vehicleWheelRadius(part, length, width, overallHeight, style) * 1.08
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'trapezoid-prism',
      name: `${part.name ?? input.name ?? 'object'} vehicle body shell`,
      position: [center[0], bodyY, center[2]],
      length,
      width,
      height: bodyHeight,
      topLengthScale: style === 'van' ? 0.98 : 0.94,
      topWidthScale: style === 'truck' || style === 'suv' ? 0.93 : 0.88,
      cornerRadius: bodyCornerRadius,
      cornerSegments: bodyCornerSegments,
      material: mat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} vehicle rounded front nose`,
      position: [center[0] + length * 0.43, bodyY + bodyHeight * 0.04, center[2]],
      length: noseLength,
      width: width * 0.86,
      height: bodyHeight * 0.46,
      slopeAxis: 'x',
      slopeDirection: 'negative',
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.18),
      cornerSegments: Math.max(4, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} vehicle tapered rear quarter`,
      position: [center[0] - length * 0.43, bodyY + bodyHeight * 0.02, center[2]],
      length: tailLength,
      width: width * 0.84,
      height: bodyHeight * 0.4,
      slopeAxis: 'x',
      slopeDirection: 'positive',
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.15),
      cornerSegments: Math.max(4, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} vehicle front deck hood surface`,
      position: [center[0] + length * 0.25, deckY, center[2]],
      length: length * 0.36,
      width: width * 0.82,
      height: bodyHeight * 0.1,
      slopeAxis: 'x',
      slopeDirection: 'negative',
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.08),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'wedge',
      name: `${part.name ?? input.name ?? 'object'} vehicle rear deck trunk surface`,
      position: [center[0] - length * 0.35, deckY - bodyHeight * 0.02, center[2]],
      length: length * 0.24,
      width: width * 0.82,
      height: bodyHeight * 0.085,
      slopeAxis: 'x',
      slopeDirection: 'positive',
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.08),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: useTaperedCabin ? 'trapezoid-prism' : 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle cabin frame`,
      position: [cabinX, cabinY - cabinHeight * 0.42, center[2]],
      length: cabinLength,
      width: cabinWidth,
      height: cabinFrameHeight,
      cornerRadius: Math.min(bodyCornerRadius, cabinHeight * 0.12),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      topLengthScale: cabinTopLengthScale,
      topWidthScale: cabinTopWidthScale,
      material: mat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} vehicle roof cap`,
      position: [cabinX, cabinY + cabinHeight * 0.5 + roofHeight * 0.18, center[2]],
      length: roofLength,
      width: roofWidth,
      thickness: roofHeight,
      cornerRadius: Math.min(bodyCornerRadius, roofHeight * 0.65),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle rocker shadow`,
      position: [center[0], baseY + overallHeight * 0.2, center[2]],
      length: length * 0.9,
      width: width * 0.86,
      height: bodyHeight * 0.16,
      cornerRadius: bodyHeight * 0.04,
      cornerSegments: 3,
      material: shadowMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} vehicle lower front intake`,
      position: [center[0] + length * 0.47, baseY + overallHeight * 0.24, center[2]],
      rotation: [0, Math.PI / 2, 0],
      length: width * 0.52,
      width: bodyHeight * 0.16,
      thickness: Math.max(length * 0.008, 0.016),
      cornerRadius: bodyHeight * 0.055,
      cornerSegments: 4,
      material: shadowMat,
    },
  ]
  const pillarHeight = Math.max(cabinHeight * 0.72, 0.08)
  const pillarY = cabinY + cabinHeight * 0.08
  const pillarWidth = Math.max(width * 0.022, 0.028)
  const pillarLength = Math.max(length * 0.012, 0.032)
  for (const [label, x] of [
    ['A', cabinX + cabinLength * 0.43],
    ['B', cabinX],
    ['C', cabinX - cabinLength * 0.43],
  ] as const) {
    for (const [side, z] of [
      ['left', center[2] - cabinWidth * 0.49],
      ['right', center[2] + cabinWidth * 0.49],
    ] as const) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'object'} vehicle ${label} pillar ${side}`,
        position: [x, pillarY, z],
        length: pillarLength,
        width: pillarWidth,
        height: pillarHeight,
        cornerRadius: pillarWidth * 0.35,
        cornerSegments: 3,
        material: mat,
      })
    }
  }
  for (const [side, z] of [
    ['left', center[2] - roofWidth * 0.52],
    ['right', center[2] + roofWidth * 0.52],
  ] as const) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle roof rail ${side}`,
      position: [cabinX, cabinY + cabinHeight * 0.44, z],
      length: roofLength,
      width: pillarWidth,
      height: roofHeight * 0.9,
      cornerRadius: pillarWidth * 0.35,
      cornerSegments: 3,
      material: mat,
    })
  }
  for (const [side, z] of [
    ['left', center[2] - width * 0.515],
    ['right', center[2] + width * 0.515],
  ] as const) {
    shapes.push({
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} vehicle side character line ${side}`,
      position: [center[0], bodyY + bodyHeight * 0.22, z],
      rotation: [Math.PI / 2, 0, 0],
      length: length * 0.78,
      width: Math.max(bodyHeight * 0.055, 0.02),
      thickness: width * 0.012,
      cornerRadius: bodyHeight * 0.03,
      cornerSegments: 3,
      material: shadowMat,
    })
    shapes.push({
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} vehicle lower sill ${side}`,
      position: [center[0], baseY + overallHeight * 0.28, z],
      rotation: [Math.PI / 2, 0, 0],
      length: length * 0.74,
      width: Math.max(bodyHeight * 0.08, 0.026),
      thickness: width * 0.014,
      cornerRadius: bodyHeight * 0.04,
      cornerSegments: 3,
      material: mat,
    })
    for (const x of [cabinX + cabinLength * 0.43, cabinX - cabinLength * 0.43]) {
      shapes.push({
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'object'} vehicle door cutline ${side}`,
        position: [x, bodyY + bodyHeight * 0.16, z],
        rotation: [Math.PI / 2, 0, Math.PI / 2],
        length: bodyHeight * 0.48,
        width: Math.max(length * 0.006, 0.012),
        thickness: width * 0.01,
        cornerRadius: bodyHeight * 0.018,
        cornerSegments: 2,
        material: shadowMat,
      })
    }
  }
  if (style === 'truck') {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} truck cargo bed`,
      position: [center[0] - length * 0.24, deckY - bodyHeight * 0.02, center[2]],
      length: length * 0.42,
      width: width * 0.88,
      height: bodyHeight * 0.2,
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.06),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    })
  }
  if (input.enhanceVisualDetails === true || input.detail === 'high') {
    for (const x of [-length * 0.36, length * 0.36]) {
      for (const z of [-width * 0.515, width * 0.515]) {
        shapes.push({
          kind: 'rounded-panel',
          name: `${part.name ?? input.name ?? 'object'} vehicle wheel well shadow`,
          position: [center[0] + x, baseY + wheelWellRadius * 1.05, center[2] + z],
          rotation: [Math.PI / 2, 0, 0],
          length: wheelWellRadius * 2.35,
          width: wheelWellRadius * 1.75,
          thickness: width * 0.012,
          cornerRadius: wheelWellRadius * 0.42,
          cornerSegments: 5,
          material: shadowMat,
        })
        shapes.push({
          kind: 'torus',
          name: `${part.name ?? input.name ?? 'object'} vehicle wheel arch lip`,
          position: [center[0] + x, baseY + wheelWellRadius * 1.16, center[2] + z],
          axis: 'z',
          majorRadius: wheelWellRadius,
          tubeRadius: Math.max(width * 0.01, 0.012),
          radialSegments: 8,
          tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.62)),
          scale: [1.16, 0.72, 1],
          material: mat,
        })
        shapes.push({
          kind: 'rounded-panel',
          name: `${part.name ?? input.name ?? 'object'} vehicle fender crown`,
          position: [center[0] + x, baseY + wheelWellRadius * 1.82, center[2] + z],
          rotation: [Math.PI / 2, 0, 0],
          length: fenderRadius * 2.1,
          width: Math.max(fenderRadius * 0.28, 0.028),
          thickness: width * 0.014,
          cornerRadius: fenderRadius * 0.16,
          cornerSegments: 4,
          material: mat,
        })
      }
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}
function wheelSetPositions(count: number, length: number, width: number): Vec3[] {
  if (count <= 1) return [[0, 0, 0]]
  if (count === 2)
    return [
      [-length / 2, 0, 0],
      [length / 2, 0, 0],
    ]
  if (count === 3) {
    return [
      [length / 2, 0, 0],
      [-length / 2, 0, -width / 2],
      [-length / 2, 0, width / 2],
    ]
  }
  return [
    [-length / 2, 0, -width / 2],
    [-length / 2, 0, width / 2],
    [length / 2, 0, -width / 2],
    [length / 2, 0, width / 2],
  ]
}

function isBicycleWheelContext(input: PartComposeInput, part: PartComposePartInput): boolean {
  const text = [
    input.name,
    input.geometryBrief,
    part.kind,
    part.partType,
    part.type,
    part.id,
    part.name,
    part.partName,
    part.semanticRole,
    ...(input.parts ?? []).map(partIdentityText),
  ]
    .map(textOf)
    .join(' ')
  return /bicycle|bike/.test(text)
}

function isVehicleWheelContext(input: PartComposeInput, part: PartComposePartInput): boolean {
  const text = [
    input.name,
    input.geometryBrief,
    part.kind,
    part.partType,
    part.type,
    part.id,
    part.name,
    part.partName,
    part.semanticRole,
    ...(input.parts ?? []).map(partIdentityText),
  ]
    .map(textOf)
    .join(' ')
  return /vehicle|car|auto|automobile|sedan|suv|truck|van/.test(text)
}

function wheelTireRole(input: PartComposeInput, part: PartComposePartInput, partName: string) {
  const role = normalizedRoleToken(part.semanticRole)
  if (
    role === 'bicycle_tire' ||
    ((role === '' || role === 'wheel' || role === 'wheels' || role === 'bicycle_wheel') &&
      isBicycleWheelContext(input, part))
  ) {
    return 'bicycle_tire'
  }
  if (
    role === 'vehicle_tire' ||
    role === 'vehicle_tires' ||
    role === 'car_tire' ||
    role === 'car_tires' ||
    role === 'vehicle_tyre' ||
    role === 'car_tyre' ||
    ((role === '' || role === 'wheel' || role === 'wheels' || role === 'vehicle_wheel') &&
      isVehicleWheelContext(input, part))
  ) {
    return 'vehicle_tire'
  }
  if (/bicycle|bike/.test(partName)) return 'bicycle_tire'
  if (/vehicle|car|auto/.test(partName)) return 'vehicle_tire'
  return role || 'wheel_tire'
}

function composeWheelSet(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.16, 0])
  const partName = `${part.name ?? part.partName ?? part.kind ?? ''}`.toLowerCase()
  const tireRole = wheelTireRole(input, part, partName)
  const defaultCount = tireRole === 'bicycle_tire' ? 2 : tireRole === 'vehicle_tire' ? 4 : 4
  const count = clampInt(part.count, defaultCount, 1, 8)
  const length = clamp(part.length, count === 2 ? 0.86 : 0.95, 0, 8)
  const width = clamp(part.width, count >= 4 ? 0.54 : 0, 0, 4)
  const radius = clamp(part.radius ?? part.wheelRadius, count === 2 ? 0.22 : 0.14, 0.025, 1.2)
  const wheelWidth = clamp(part.wheelWidth ?? part.depth, radius * 0.42, 0.012, 0.6)
  const tireMat = partMaterial(part, material(input.darkColor ?? '#111827', 0.72, 0.02))
  const rimMat = material(input.metalColor ?? '#d1d5db', 0.25, 0.75)
  const hubDarkMat = material(input.darkColor ?? '#1f2937', 0.48, 0.36)
  const axis =
    tireRole === 'bicycle_tire' || tireRole === 'vehicle_tire' ? 'z' : partAxis(part.axis, 'z')
  const shapes: PrimitiveShapeInput[] = []
  const tireNamePrefix =
    tireRole === 'vehicle_tire' ? 'vehicle' : tireRole === 'bicycle_tire' ? 'bicycle' : 'wheel'
  const positions = wheelSetPositions(count, length, width)
  positions.forEach((offset, index) => {
    const wheelCenter: Vec3 = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]]
    const label =
      count === 2
        ? index === 0
          ? 'rear'
          : 'front'
        : count === 3
          ? index === 0
            ? 'nose'
            : `main ${index}`
          : `${index + 1}`
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} ${tireNamePrefix} tire ${label}`,
      semanticRole: tireRole,
      sourcePartKind:
        part.sourcePartKind ?? (tireRole === 'bicycle_tire' ? 'bicycle_wheels' : 'wheel_set'),
      position: wheelCenter,
      axis,
      majorRadius: radius,
      tubeRadius: Math.min(radius * 0.22, wheelWidth * 0.42),
      radialSegments: 12,
      tubularSegments: ringSegments(input.detail),
      material: tireMat,
    })
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} ${label} wheel rim ring`,
      semanticRole: tireRole === 'bicycle_tire' ? 'bicycle_rim' : 'wheel_rim',
      sourcePartKind:
        part.sourcePartKind ?? (tireRole === 'bicycle_tire' ? 'bicycle_wheels' : 'wheel_set'),
      position: wheelCenter,
      axis,
      majorRadius: radius * 0.55,
      tubeRadius: Math.max(radius * 0.045, wheelWidth * 0.06),
      radialSegments: 8,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.55)),
      material: rimMat,
    })
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ${label} wheel hub`,
      semanticRole: tireRole === 'bicycle_tire' ? 'bicycle_hub' : 'wheel_hub',
      sourcePartKind:
        part.sourcePartKind ?? (tireRole === 'bicycle_tire' ? 'bicycle_wheels' : 'wheel_set'),
      position: wheelCenter,
      axis,
      radius: radius * 0.45,
      height: wheelWidth * 0.35,
      radialSegments: 20,
      material: rimMat,
    })
    if (input.detail === 'high' || input.enhanceVisualDetails === true) {
      const spokeCount = tireRole === 'bicycle_tire' ? 8 : 5
      for (let spoke = 0; spoke < spokeCount; spoke += 1) {
        const angle = angularStep(spoke, spokeCount)
        const spokeLength = radius * 0.58
        shapes.push({
          kind: 'capsule',
          name: `${part.name ?? input.name ?? 'object'} ${label} wheel spoke ${spoke + 1}`,
          semanticRole: tireRole === 'bicycle_tire' ? 'bicycle_spoke' : 'wheel_spoke',
          sourcePartKind:
            part.sourcePartKind ?? (tireRole === 'bicycle_tire' ? 'bicycle_wheels' : 'wheel_set'),
          position: [
            wheelCenter[0] + Math.cos(angle) * radius * 0.28,
            wheelCenter[1] + Math.sin(angle) * radius * 0.28,
            wheelCenter[2],
          ],
          rotation: [0, 0, angle],
          axis: 'x',
          radius: Math.max(radius * 0.018, 0.004),
          height: spokeLength,
          radialSegments: 8,
          capSegments: 2,
          material: hubDarkMat,
        })
      }
    }
  })
  if (axis === 'z' && count >= 4) {
    const axleXs = Array.from(new Set(positions.map((position) => Number(position[0].toFixed(4)))))
    for (const x of axleXs) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} wheel axle`,
        semanticRole: 'wheel_axle',
        sourcePartKind: part.sourcePartKind ?? 'wheel_set',
        position: [center[0] + x, center[1], center[2]],
        axis: 'z',
        radius: radius * 0.12,
        height: width + wheelWidth * 1.2,
        radialSegments: 16,
        material: hubDarkMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeWindowPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const length = clamp(part.length ?? part.width, 0.32, 0.02, 4)
  const height = clamp(part.height, 0.18, 0.015, 2)
  const thickness = clamp(part.thickness ?? part.depth, 0.01, 0.002, 0.12)
  const glass = partMaterial(
    part,
    material(part.accentColor ?? input.accentColor ?? '#38bdf8', 0.12, 0.02, 0.58),
  )
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: part.name ?? `${input.name ?? 'object'} glass panel`,
      semanticRole: part.semanticRole ?? 'window_panel',
      sourcePartKind: part.sourcePartKind ?? 'window_panel',
      position: center,
      rotation: part.rotation,
      length,
      width: height,
      thickness,
      cornerRadius: clamp(
        part.cornerRadius,
        Math.min(length, height) * 0.16,
        0,
        Math.min(length, height) * 0.45,
      ),
      cornerSegments: clampInt(part.cornerSegments, 4, 1, 12),
      material: glass,
    },
  ]
  return shapes
}

function composeWindowStrip(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  if (
    part.vehicleStyle ||
    part.style === 'vehicle_glasshouse' ||
    part.variant === 'vehicle_glasshouse'
  ) {
    return composeVehicleWindows(input, part, origin)
  }
  const center = add(origin, part.position ?? [0, 0.65, 0.02])
  const count = clampInt(part.count, 8, 2, 60)
  const length = clamp(part.length, 1.2, 0.08, 12)
  const panelWidth = clamp(part.width, Math.min(0.12, length / Math.max(count * 1.6, 1)), 0.01, 0.8)
  const height = clamp(part.height, panelWidth * 0.72, 0.01, 0.5)
  const spacing = count <= 1 ? 0 : length / Math.max(count - 1, 1)
  const shapes: PrimitiveShapeInput[] = []
  for (let i = 0; i < count; i += 1) {
    shapes.push(
      ...composeWindowPanel(
        input,
        {
          ...part,
          name: `${part.name ?? input.name ?? 'object'} window ${i + 1}`,
          semanticRole: part.semanticRole ?? 'window_panel',
          sourcePartKind: part.sourcePartKind ?? 'window_strip',
          position: [center[0] - length / 2 + i * spacing, center[1], center[2]],
          length: panelWidth,
          height,
        },
        origin,
      ),
    )
  }
  return shapes
}

function composeVehicleWheels(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  return composeWheelSet(input, { semanticRole: 'vehicle_tire', ...part }, origin)
}

function composeVehicleWindows(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const style = vehicleStyleFor(input, part)
  const defaults = VEHICLE_STYLE_DEFAULTS[style]
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const length = clamp(part.length, 0.5, 0.1, 2)
  const width = clamp(part.width, 0.52, 0.08, 1.8)
  const height = clamp(part.height, 0.12, 0.03, 0.6)
  const glass = partMaterial(
    part,
    material(part.accentColor ?? input.accentColor ?? '#1e3a8a', 0.18, 0.02, 0.68),
  )
  const trim = material(input.darkColor ?? '#0f172a', 0.42, 0.12)
  const glasshouseTopScale = clamp(part.cabinTopScale, defaults.cabinTopScale, 0.55, 1)
  const sideWindowLength = length * (style === 'sports' ? 0.58 : 0.66)
  const sidePanelLength = sideWindowLength * 0.43
  const quarterPanelLength = length * 0.16
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'trapezoid-prism',
      name: `${part.name ?? input.name ?? 'object'} integrated vehicle glasshouse`,
      semanticRole: part.semanticRole ?? 'vehicle_window',
      sourcePartKind: part.sourcePartKind ?? 'window_strip',
      position: [center[0], center[1] + height * 0.1, center[2]],
      length: length * 0.72,
      width: width * 0.76,
      height: height * 0.82,
      topLengthScale: glasshouseTopScale,
      topWidthScale: Math.min(0.92, glasshouseTopScale + 0.04),
      material: glass,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} windshield`,
      semanticRole: part.semanticRole ?? 'vehicle_window',
      sourcePartKind: part.sourcePartKind ?? 'window_strip',
      position: [center[0] + length * 0.42, center[1] + height * 0.1, center[2]],
      rotation: [0, 0, Math.PI / 2 - 0.22],
      length: height * 1.02,
      width: width * 0.46,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} rear window`,
      semanticRole: part.semanticRole ?? 'vehicle_window',
      sourcePartKind: part.sourcePartKind ?? 'window_strip',
      position: [center[0] - length * 0.42, center[1] + height * 0.1, center[2]],
      rotation: [0, 0, Math.PI / 2 + 0.18],
      length: height * 0.96,
      width: width * 0.44,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
  ]
  for (const side of [-1, 1]) {
    for (const [label, x] of [
      ['front', center[0] + length * 0.14],
      ['rear', center[0] - length * 0.15],
    ] as const) {
      shapes.push({
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'object'} ${label} side window ${
          side < 0 ? 'left' : 'right'
        }`,
        semanticRole: part.semanticRole ?? 'vehicle_window',
        sourcePartKind: part.sourcePartKind ?? 'window_strip',
        position: [x, center[1] + height * 0.1, center[2] + side * width * 0.505],
        rotation: [Math.PI / 2, 0, 0],
        length: sidePanelLength,
        width: height * 0.82,
        thickness: 0.01,
        cornerRadius: height * 0.12,
        cornerSegments: 4,
        material: glass,
      })
    }
    shapes.push({
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} rear quarter window ${side < 0 ? 'left' : 'right'}`,
      semanticRole: part.semanticRole ?? 'vehicle_window',
      sourcePartKind: part.sourcePartKind ?? 'window_strip',
      position: [
        center[0] - length * 0.26,
        center[1] + height * 0.06,
        center[2] + side * width * 0.51,
      ],
      rotation: [Math.PI / 2, 0, 0],
      length: quarterPanelLength,
      width: height * 0.72,
      thickness: 0.01,
      cornerRadius: height * 0.11,
      cornerSegments: 4,
      material: glass,
    })
    for (const x of [center[0] - length * 0.01, center[0] - length * 0.3]) {
      shapes.push({
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'object'} side window divider ${
          side < 0 ? 'left' : 'right'
        }`,
        sourcePartKind: part.sourcePartKind ?? 'window_strip',
        position: [x, center[1] + height * 0.1, center[2] + side * width * 0.512],
        rotation: [Math.PI / 2, 0, Math.PI / 2],
        length: height * 0.86,
        width: Math.max(length * 0.01, 0.012),
        thickness: 0.012,
        cornerRadius: height * 0.04,
        cornerSegments: 2,
        material: trim,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeHeadlights(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.62, 0.34, 0])
  const width = clamp(part.width, 0.5, 0.08, 2)
  const radius = clamp(part.radius, 0.035, 0.008, 0.16)
  const lightMat = partMaterial(part, material('#fde68a', 0.2, 0.02, 0.86))
  return [-1, 1].map(
    (side): PrimitiveShapeInput => ({
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} ${side < 0 ? 'left' : 'right'} headlight`,
      semanticRole: part.semanticRole ?? 'headlight',
      sourcePartKind: part.sourcePartKind ?? 'light_pair',
      position: [center[0], center[1], center[2] + side * width * 0.34],
      radius,
      scale: [0.55, 0.75, 1],
      material: lightMat,
    }),
  )
}

function composeBumper(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.66, 0.24, 0])
  const width = clamp(part.width ?? part.length, 0.56, 0.08, 2.5)
  const height = clamp(part.height, 0.045, 0.01, 0.2)
  const bumperMat = partMaterial(part, material(input.darkColor ?? '#1f2937', 0.48, 0.25))
  const makeBar = (name: string, position: Vec3): PrimitiveShapeInput => ({
    kind: 'box',
    name,
    position,
    length: height,
    width,
    height,
    cornerRadius: height * 0.35,
    cornerSegments: 4,
    material: bumperMat,
  })
  const side = partSide(part.side)
  const shapes: PrimitiveShapeInput[] = []

  if (!side || side === 'front') {
    shapes.push(makeBar(`${part.name ?? input.name ?? 'object'} front bumper bar`, center))
  }
  if (!side || side === 'back') {
    shapes.push(
      makeBar(`${part.name ?? input.name ?? 'object'} rear bumper bar`, [
        center[0] - Math.abs(center[0]) * 2,
        center[1],
        center[2],
      ]),
    )
  }

  return shapes
}
function genericPartRole(part: PartComposePartInput, fallback: string): string {
  return normalizedRoleToken(part.semanticRole) || fallback
}

function composeGenericBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, input.length ?? 1, 0.08, 8)
  const width = clamp(part.width ?? part.depth, input.width ?? input.depth ?? 0.65, 0.05, 5)
  const height = clamp(part.height, input.height ?? 0.8, 0.05, 5)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const mat = partMaterial(part, material(part.primaryColor ?? input.primaryColor ?? '#8b9aae'))
  return applyPartRotation(
    [
      {
        kind: 'box',
        name: part.name ?? `${input.name ?? 'generic object'} body`,
        semanticRole: genericPartRole(part, 'main_body'),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'generic_body',
        position: center,
        length,
        width,
        height,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, width, height) * 0.06, 0, 0.5),
        cornerSegments: part.cornerSegments ?? 5,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeGenericBase(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, (input.length ?? 1) * 1.08, 0.08, 8)
  const width = clamp(
    part.width ?? part.depth,
    (input.width ?? input.depth ?? 0.65) * 1.08,
    0.05,
    5,
  )
  const thickness = clamp(part.thickness ?? part.height, (input.height ?? 0.8) * 0.08, 0.01, 0.8)
  const center = add(origin, part.position ?? [0, thickness * 0.5, 0])
  const mat = partMaterial(part, material(part.darkColor ?? input.darkColor ?? '#1f2937', 0.66))
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name: part.name ?? `${input.name ?? 'generic object'} base`,
        semanticRole: genericPartRole(part, 'support_base'),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'generic_base',
        position: center,
        length,
        width,
        thickness,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, width) * 0.04, 0, 0.35),
        cornerSegments: part.cornerSegments ?? 5,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeGenericPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
  kind:
    | 'generic_panel'
    | 'generic_control_panel'
    | 'generic_display'
    | 'generic_opening'
    | 'generic_detail_accent',
): PrimitiveShapeInput[] {
  const objectLength = input.length ?? 1
  const objectWidth = input.width ?? input.depth ?? 0.65
  const objectHeight = input.height ?? 0.8
  const length = clamp(
    part.length,
    kind === 'generic_detail_accent' ? objectLength * 0.24 : objectLength * 0.3,
    0.02,
    4,
  )
  const panelHeight = clamp(
    part.height ?? part.width,
    kind === 'generic_opening' ? objectHeight * 0.34 : objectHeight * 0.22,
    0.02,
    3,
  )
  const thickness = clamp(part.thickness ?? part.depth, 0.025, 0.002, 0.4)
  const fallbackZ = objectWidth * 0.51
  const fallbackY =
    kind === 'generic_opening'
      ? objectHeight * 0.36
      : kind === 'generic_detail_accent'
        ? objectHeight * 0.68
        : objectHeight * 0.62
  const center = add(
    origin,
    part.position ?? [
      kind === 'generic_detail_accent' ? objectLength * 0.18 : 0,
      fallbackY,
      fallbackZ,
    ],
  )
  const fallbackColor =
    kind === 'generic_display'
      ? '#0f172a'
      : kind === 'generic_opening'
        ? '#111827'
        : kind === 'generic_control_panel'
          ? '#38bdf8'
          : '#94a3b8'
  const mat = partMaterial(
    part,
    material(part.color ?? part.accentColor ?? input.accentColor ?? fallbackColor, 0.4),
  )
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name:
          part.name ??
          `${input.name ?? 'generic object'} ${kind.replace(/^generic_/, '').replace(/_/g, ' ')}`,
        semanticRole: genericPartRole(
          part,
          kind === 'generic_control_panel'
            ? 'control_detail'
            : kind === 'generic_display'
              ? 'display'
              : kind === 'generic_opening'
                ? 'opening'
                : kind === 'generic_detail_accent'
                  ? 'detail_accent'
                  : 'panel',
        ),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: kind,
        position: center,
        length,
        width: panelHeight,
        thickness,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, panelHeight) * 0.06, 0, 0.2),
        cornerSegments: part.cornerSegments ?? 4,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeGenericHandle(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const objectWidth = input.width ?? input.depth ?? 0.65
  const objectHeight = input.height ?? 0.8
  const length = clamp(part.length, 0.22, 0.03, 2)
  const radius = clamp(part.radius ?? part.wireRadius, 0.018, 0.004, 0.12)
  const center = add(origin, part.position ?? [0, objectHeight * 0.46, objectWidth * 0.56])
  return applyPartRotation(
    [
      {
        kind: 'capsule',
        name: part.name ?? `${input.name ?? 'generic object'} handle`,
        semanticRole: genericPartRole(part, 'handle'),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'generic_handle',
        position: center,
        axis: 'x',
        radius,
        height: length,
        radialSegments: 12,
        capSegments: 4,
        material: partMaterial(part, material(input.darkColor ?? '#111827', 0.62, 0.12)),
      },
    ],
    center,
    part.rotation,
  )
}

function composeGenericSpout(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const objectLength = input.length ?? 1
  const objectWidth = input.width ?? input.depth ?? 0.65
  const objectHeight = input.height ?? 0.8
  const radius = clamp(part.radius, Math.min(objectLength, objectWidth) * 0.035, 0.004, 0.2)
  const length = clamp(part.length ?? part.depth ?? part.height, objectWidth * 0.22, 0.02, 1.2)
  const center = add(origin, part.position ?? [0, objectHeight * 0.52, objectWidth * 0.58])
  return applyPartRotation(
    [
      {
        kind: 'cylinder',
        name: part.name ?? `${input.name ?? 'generic object'} spout`,
        semanticRole: genericPartRole(part, 'spout'),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'generic_spout',
        position: center,
        axis: partAxis(part.axis, 'z'),
        radius,
        height: length,
        radialSegments: 16,
        material: partMaterial(part, material(input.darkColor ?? '#111827', 0.5, 0.24)),
      },
    ],
    center,
    part.rotation,
  )
}

function composeGenericFootSet(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const objectLength = input.length ?? 1
  const objectWidth = input.width ?? input.depth ?? 0.65
  const radius = clamp(part.radius, 0.035, 0.006, 0.18)
  const height = clamp(part.height, 0.08, 0.02, 0.8)
  const inset = clamp(part.cornerInset, radius * 2.2, 0, Math.min(objectLength, objectWidth) * 0.45)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const xs = [-objectLength / 2 + inset, objectLength / 2 - inset]
  const zs = [-objectWidth / 2 + inset, objectWidth / 2 - inset]
  const mat = partMaterial(part, material(input.darkColor ?? '#111827', 0.66, 0.08))
  const shapes: PrimitiveShapeInput[] = []
  for (const x of xs) {
    for (const z of zs) {
      shapes.push({
        kind: 'cylinder',
        name: part.name ?? `${input.name ?? 'generic object'} foot`,
        semanticRole: genericPartRole(part, 'support_foot'),
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'generic_foot_set',
        position: [center[0] + x, center[1], center[2] + z],
        axis: 'y',
        radius,
        height,
        radialSegments: 10,
        material: mat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeMobilePlatformChassis(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, input.length ?? 1.45, 0.3, 4)
  const width = clamp(part.width ?? part.depth, input.width ?? input.depth ?? 0.9, 0.24, 2.4)
  const height = clamp(part.height, input.height ?? 0.28, 0.08, 1.2)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const cornerRadius = clamp(
    part.cornerRadius,
    Math.min(length, width) * 0.18,
    0,
    Math.min(length, width) * 0.35,
  )
  const bodyMat = material(part.primaryColor ?? input.primaryColor ?? '#e5e7eb', 0.48, 0.08)
  const skirtMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.62, 0.12)
  const deckMat = material(part.secondaryColor ?? input.secondaryColor ?? '#334155', 0.55, 0.12)
  const seamMat = material(part.accentColor ?? input.accentColor ?? '#38bdf8', 0.35, 0.02, 0.9)
  const skirtHeight = Math.max(0.035, height * 0.32)
  const deckThickness = Math.max(0.024, height * 0.16)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'mobile platform'} lower bumper skirt`,
      semanticRole: 'lower_bumper_skirt',
      sourcePartKind: 'mobile_platform_chassis',
      position: [center[0], center[1] - height * 0.35, center[2]],
      length: length * 1.04,
      width: width * 1.04,
      thickness: skirtHeight,
      cornerRadius: cornerRadius * 1.02,
      cornerSegments: part.cornerSegments ?? 8,
      material: skirtMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'mobile platform'} rounded chassis body`,
      semanticRole: part.semanticRole ?? 'vehicle_body',
      sourcePartKind: 'mobile_platform_chassis',
      position: center,
      length,
      width,
      height,
      cornerRadius,
      cornerSegments: part.cornerSegments ?? 8,
      material: bodyMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'mobile platform'} top load deck`,
      semanticRole: 'cargo_platform',
      sourcePartKind: 'mobile_platform_chassis',
      position: [center[0], center[1] + height * 0.52, center[2]],
      length: length * 0.74,
      width: width * 0.68,
      thickness: deckThickness,
      cornerRadius: Math.min(length, width) * 0.07,
      cornerSegments: 5,
      material: deckMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'mobile platform'} left side status seam`,
      semanticRole: 'status_light_strip',
      sourcePartKind: 'mobile_platform_chassis',
      position: [center[0], center[1] + height * 0.02, center[2] + width * 0.53],
      length: length * 0.62,
      width: Math.max(0.018, height * 0.08),
      thickness: Math.max(0.006, width * 0.01),
      cornerRadius: Math.max(0.01, height * 0.05),
      cornerSegments: 3,
      material: seamMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'mobile platform'} right side status seam`,
      semanticRole: 'status_light_strip',
      sourcePartKind: 'mobile_platform_chassis',
      position: [center[0], center[1] + height * 0.02, center[2] - width * 0.53],
      length: length * 0.62,
      width: Math.max(0.018, height * 0.08),
      thickness: Math.max(0.006, width * 0.01),
      cornerRadius: Math.max(0.01, height * 0.05),
      cornerSegments: 3,
      material: seamMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeLidarSensor(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.045, 0.012, 0.18)
  const height = clamp(part.height ?? part.length, radius * 0.8, radius * 0.25, radius * 2.5)
  const center = add(origin, part.position ?? [0, 0.24, 0])
  const bodyMat = partMaterial(
    part,
    material(part.darkColor ?? input.darkColor ?? '#0f172a', 0.42, 0.3),
  )
  const lensMat = material(part.accentColor ?? input.accentColor ?? '#38bdf8', 0.18, 0.02, 0.72)
  const axis = partAxis(part.axis, 'x')
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'mobile platform'} lidar housing`,
      semanticRole: part.semanticRole ?? 'navigation_sensor',
      sourcePartKind: 'lidar_sensor',
      position: center,
      axis,
      radius,
      height,
      radialSegments: 24,
      material: bodyMat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'mobile platform'} lidar lens`,
      semanticRole: 'sensor_lens',
      sourcePartKind: 'lidar_sensor',
      position: offsetAlongAxis(center, axis, height * 0.52),
      radius: radius * 0.55,
      scale: axis === 'x' ? [0.35, 0.68, 1] : axis === 'z' ? [1, 0.68, 0.35] : [0.8, 0.35, 0.8],
      material: lensMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeEmergencyStopButton(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.04, 0.012, 0.16)
  const height = clamp(part.height ?? part.length, radius * 0.55, radius * 0.2, radius * 1.8)
  const center = add(origin, part.position ?? [0.35, 0.38, 0.2])
  const axis = partAxis(part.axis, 'y')
  const baseMat = material(input.darkColor ?? '#111827', 0.55, 0.25)
  const redMat = partMaterial(part, material(part.color ?? '#ef4444', 0.38, 0.02))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'mobile platform'} emergency stop base`,
      semanticRole: 'emergency_stop_base',
      sourcePartKind: 'emergency_stop_button',
      position: offsetAlongAxis(center, axis, -height * 0.35),
      axis,
      radius: radius * 1.12,
      height: height * 0.38,
      radialSegments: 24,
      material: baseMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'mobile platform'} emergency stop button`,
      semanticRole: part.semanticRole ?? 'emergency_stop_button',
      sourcePartKind: 'emergency_stop_button',
      position: center,
      axis,
      radius,
      height,
      radialSegments: 28,
      material: redMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'mobile platform'} emergency stop guard ring`,
      semanticRole: 'emergency_stop_guard',
      sourcePartKind: 'emergency_stop_button',
      position: offsetAlongAxis(center, axis, height * 0.08),
      axis,
      majorRadius: radius * 1.1,
      tubeRadius: radius * 0.08,
      radialSegments: 8,
      tubularSegments: 28,
      material: baseMat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeStatusLightStrip(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const objectLength = input.length ?? 1.4
  const objectWidth = input.width ?? input.depth ?? 0.85
  const length = clamp(part.length, objectLength * 0.5, 0.04, 4)
  const stripHeight = clamp(part.height ?? part.width, 0.035, 0.008, 0.25)
  const thickness = clamp(part.thickness ?? part.depth, 0.012, 0.002, 0.08)
  const side = partSide(part.side)
  const defaultZ =
    side === 'left'
      ? objectWidth * 0.52
      : side === 'right'
        ? -objectWidth * 0.52
        : objectWidth * 0.52
  const center = add(origin, part.position ?? [0, (input.height ?? 0.45) * 0.45, defaultZ])
  const lightMat = partMaterial(
    part,
    material(part.color ?? part.accentColor ?? input.accentColor ?? '#38bdf8', 0.18, 0.02, 0.82),
  )
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name: `${part.name ?? input.name ?? 'mobile platform'} status light strip`,
        semanticRole: part.semanticRole ?? 'status_light_strip',
        semanticGroup: part.semanticGroup ?? 'generic_parts',
        sourcePartKind: 'status_light_strip',
        position: center,
        length,
        width: stripHeight,
        thickness,
        cornerRadius: Math.min(length, stripHeight) * 0.3,
        cornerSegments: 4,
        material: lightMat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeOperatorPanel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const height = clamp(part.height, 0.62, 0.18, 2)
  const width = clamp(part.width ?? part.length, 0.32, 0.12, 1.2)
  const depth = clamp(part.depth ?? part.thickness, 0.12, 0.03, 0.5)
  const center = add(
    origin,
    part.position ?? [
      (input.length ?? 1.6) * 0.42,
      height * 0.55,
      (input.width ?? input.depth ?? 0.8) * 0.52,
    ],
  )
  const bodyMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#e5e7eb', 0.48, 0.08),
  )
  const screenMat = material(part.darkColor ?? '#0f172a', 0.24, 0.02)
  const buttonMat = material(part.accentColor ?? input.accentColor ?? '#22c55e', 0.3, 0.02)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} operator panel body`,
      semanticRole: part.semanticRole ?? 'control_panel',
      sourcePartKind: 'operator_panel',
      position: center,
      length: width,
      width: depth,
      height,
      cornerRadius: Math.min(width, depth, height) * 0.08,
      cornerSegments: 4,
      material: bodyMat,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'machine'} operator panel screen`,
      semanticRole: 'display_screen',
      sourcePartKind: 'operator_panel',
      position: [center[0], center[1] + height * 0.16, center[2] + depth * 0.54],
      length: width * 0.62,
      width: height * 0.22,
      thickness: 0.012,
      cornerRadius: width * 0.04,
      cornerSegments: 3,
      material: screenMat,
    },
  ]
  for (const x of [-0.18, 0, 0.18]) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} operator panel button`,
      semanticRole: 'control_button',
      sourcePartKind: 'operator_panel',
      position: [center[0] + x * width, center[1] - height * 0.16, center[2] + depth * 0.55],
      axis: 'z',
      radius: Math.max(0.012, width * 0.035),
      height: 0.012,
      radialSegments: 14,
      material: buttonMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeGuardFence(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, input.length ?? 1.8, 0.25, 8)
  const height = clamp(part.height, 0.9, 0.2, 3)
  const width = clamp(part.width ?? part.depth, 0.08, 0.02, 0.5)
  const postRadius = clamp(part.radius ?? part.wireRadius, 0.018, 0.006, 0.08)
  const count = clampInt(part.count, 4, 2, 12)
  const center = add(
    origin,
    part.position ?? [0, height * 0.5, -(input.width ?? input.depth ?? 1) * 0.55],
  )
  const postMat = partMaterial(
    part,
    material(part.color ?? input.accentColor ?? '#facc15', 0.42, 0.16),
  )
  const railMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.5, 0.12)
  const shapes: PrimitiveShapeInput[] = []
  for (let i = 0; i < count; i += 1) {
    const x = center[0] - length / 2 + (length * i) / Math.max(1, count - 1)
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} guard fence post ${i + 1}`,
      semanticRole: 'guard_fence_post',
      sourcePartKind: 'guard_fence',
      position: [x, center[1], center[2]],
      axis: 'y',
      radius: postRadius,
      height,
      radialSegments: 10,
      material: postMat,
    })
  }
  for (const y of [center[1] + height * 0.28, center[1] - height * 0.12]) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} guard fence rail`,
      semanticRole: part.semanticRole ?? 'safety_barrier',
      sourcePartKind: 'guard_fence',
      position: [center[0], y, center[2]],
      length,
      width,
      height: Math.max(0.025, postRadius * 1.8),
      material: railMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composePalletTable(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1, 0.25, 4)
  const width = clamp(part.width ?? part.depth, 0.7, 0.2, 3)
  const height = clamp(part.height, 0.28, 0.08, 1.2)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const deckMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#475569', 0.55, 0.12),
  )
  const legMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.55, 0.2)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'machine'} pallet table deck`,
      semanticRole: part.semanticRole ?? 'pallet_table',
      sourcePartKind: 'pallet_table',
      position: [center[0], center[1] + height * 0.45, center[2]],
      length,
      width,
      thickness: Math.max(0.045, height * 0.16),
      cornerRadius: Math.min(length, width) * 0.04,
      cornerSegments: 3,
      material: deckMat,
    },
  ]
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'machine'} pallet table leg`,
        semanticRole: 'support_leg',
        sourcePartKind: 'pallet_table',
        position: [center[0] + x * length * 0.38, center[1], center[2] + z * width * 0.36],
        length: Math.max(0.04, length * 0.04),
        width: Math.max(0.04, width * 0.05),
        height,
        material: legMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeBearingBlock(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.42, 0.12, 1.6)
  const width = clamp(part.width ?? part.depth, 0.22, 0.08, 1)
  const height = clamp(part.height, 0.26, 0.08, 1.2)
  const radius = clamp(part.radius ?? part.diameter, Math.min(width, height) * 0.24, 0.015, 0.4)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const bodyMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#64748b', 0.72, 0.22),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.5, 0.18)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} bearing block base`,
      semanticRole: 'bearing_base',
      sourcePartKind: 'bearing_block',
      position: [center[0], center[1] - height * 0.34, center[2]],
      length,
      width,
      height: height * 0.22,
      cornerRadius: Math.min(length, width) * 0.06,
      cornerSegments: 3,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} bearing block housing`,
      semanticRole: part.semanticRole ?? 'bearing_block',
      sourcePartKind: 'bearing_block',
      position: [center[0], center[1], center[2]],
      length: length * 0.55,
      width: width * 0.86,
      height: height * 0.72,
      cornerRadius: Math.min(width, height) * 0.12,
      cornerSegments: 5,
      material: bodyMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'machine'} bearing ring`,
      semanticRole: 'bearing_ring',
      sourcePartKind: 'bearing_block',
      position: [center[0], center[1] + height * 0.04, center[2] + width * 0.45],
      axis: 'z',
      majorRadius: radius,
      tubeRadius: Math.max(0.008, radius * 0.18),
      radialSegments: 10,
      tubularSegments: 32,
      material: darkMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} bearing bore`,
      semanticRole: 'bearing_bore',
      sourcePartKind: 'bearing_block',
      position: [center[0], center[1] + height * 0.04, center[2] + width * 0.46],
      axis: 'z',
      radius: radius * 0.58,
      height: Math.max(0.018, width * 0.08),
      radialSegments: 24,
      material: darkMat,
    },
  ]
  for (const x of [-1, 1]) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} bearing mounting bolt`,
      semanticRole: 'mounting_bolt',
      sourcePartKind: 'bearing_block',
      position: [
        center[0] + x * length * 0.34,
        center[1] - height * 0.21,
        center[2] + width * 0.18,
      ],
      axis: 'y',
      radius: Math.max(0.008, radius * 0.16),
      height: height * 0.05,
      radialSegments: 12,
      material: darkMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeSupportRollerPair(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.9, 0.28, 3)
  const width = clamp(part.width ?? part.depth, 1.18, 0.28, 4)
  const height = clamp(part.height, 0.34, 0.12, 1.4)
  const rollerRadius = clamp(part.radius ?? part.wheelRadius, height * 0.28, 0.035, 0.5)
  const rollerLength = clamp(part.rollerLength ?? part.thickness, width * 0.24, 0.08, width * 0.48)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const bodyMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#64748b', 0.68, 0.28),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.54, 0.28)
  const rollerMat = material(part.rollerColor ?? part.metalColor ?? '#374151', 0.38, 0.62)
  const role = part.semanticRole ?? 'support_roller'
  const rollerY = center[1] + height * 0.16
  const rollerZ = Math.max(width * 0.22, rollerRadius * 1.7)
  const blockLength = Math.max(length * 0.18, rollerRadius * 1.2)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'kiln'} support roller foundation`,
      semanticRole: 'support_roller_base',
      sourcePartKind: 'support_roller_pair',
      position: [center[0], center[1] - height * 0.32, center[2]],
      length,
      width,
      height: height * 0.26,
      cornerRadius: Math.min(length, width) * 0.035,
      cornerSegments: 3,
      material: bodyMat,
    },
  ]
  for (const side of [-1, 1]) {
    const z = center[2] + side * rollerZ
    shapes.push(
      {
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'kiln'} ${side < 0 ? 'left' : 'right'} support roller`,
        semanticRole: role,
        sourcePartKind: 'support_roller_pair',
        position: [center[0], rollerY, z],
        axis: 'x',
        radius: rollerRadius,
        height: rollerLength,
        radialSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.5)),
        material: rollerMat,
      },
      {
        kind: 'box',
        name: `${part.name ?? input.name ?? 'kiln'} ${side < 0 ? 'left' : 'right'} roller pedestal`,
        semanticRole: 'support_roller_pedestal',
        sourcePartKind: 'support_roller_pair',
        position: [center[0], center[1] - height * 0.05, z],
        length: blockLength,
        width: rollerLength * 1.18,
        height: height * 0.28,
        cornerRadius: Math.min(blockLength, rollerLength) * 0.05,
        cornerSegments: 3,
        material: bodyMat,
      },
    )
  }
  shapes.push({
    kind: 'cylinder',
    name: `${part.name ?? input.name ?? 'kiln'} thrust roller`,
    semanticRole: 'thrust_roller',
    sourcePartKind: 'support_roller_pair',
    position: [center[0] + length * 0.32, rollerY + rollerRadius * 0.2, center[2]],
    axis: 'z',
    radius: rollerRadius * 0.48,
    height: Math.max(0.04, width * 0.08),
    radialSegments: 20,
    material: darkMat,
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function composeStructuralTowerFrame(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 2.2, 0.8, 12)
  const width = clamp(part.width ?? part.depth, 1.6, 0.6, 8)
  const height = clamp(part.height, 6, 1.4, 18)
  const levels = Math.max(2, Math.min(9, Math.round(part.levelCount ?? part.count ?? 5)))
  const bayCount = Math.max(1, Math.min(5, Math.round(part.bayCount ?? 2)))
  const columnSize = clamp(part.thickness, Math.min(length, width) * 0.035, 0.025, 0.18)
  const deckThickness = Math.max(0.018, columnSize * 0.45)
  const includeDiagonalBraces = part.includeDiagonalBraces !== false
  const includeExternalStairs = part.externalStairs !== false
  const stairFlights = Math.max(2, Math.min(levels, Math.round(part.stairFlights ?? levels)))
  const stairSide = part.stairSide === 'left' ? -1 : 1
  const stairPlacement = part.stairPlacement === 'inside' ? 'inside' : 'outside'
  const center = add(origin, part.position ?? [0, height / 2, 0])
  const bottomY = center[1] - height / 2
  const frameMat = partMaterial(
    part,
    material(part.darkColor ?? input.darkColor ?? '#111827', 0.58, 0.42),
  )
  const deckMat = material(part.metalColor ?? input.metalColor ?? '#475569', 0.72, 0.3, 0.28)
  const railMat = material(part.accentColor ?? input.accentColor ?? '#1f2937', 0.54, 0.34)
  const shapes: PrimitiveShapeInput[] = []
  const cornerXs = [-length / 2, length / 2]
  const cornerZs = [-width / 2, width / 2]

  for (const x of cornerXs) {
    for (const z of cornerZs) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'tower'} corner column`,
        semanticRole: 'tower_column',
        sourcePartKind: 'structural_tower_frame',
        position: [center[0] + x, center[1], center[2] + z],
        length: columnSize,
        width: columnSize,
        height,
        material: frameMat,
      })
    }
  }

  for (let bay = 1; bay < bayCount; bay += 1) {
    const x = -length / 2 + (length * bay) / bayCount
    for (const z of cornerZs) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'tower'} intermediate column`,
        semanticRole: 'tower_column',
        sourcePartKind: 'structural_tower_frame',
        position: [center[0] + x, center[1], center[2] + z],
        length: columnSize * 0.85,
        width: columnSize * 0.85,
        height,
        material: frameMat,
      })
    }
  }

  for (let level = 0; level <= levels; level += 1) {
    const y = bottomY + (height * level) / levels
    for (const z of cornerZs) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'tower'} level ${level} longitudinal beam`,
        semanticRole: level === 0 ? (part.semanticRole ?? 'preheater_tower_body') : 'tower_beam',
        sourcePartKind: 'structural_tower_frame',
        position: [center[0], y, center[2] + z],
        length,
        width: columnSize,
        height: columnSize,
        material: frameMat,
      })
    }
    for (const x of cornerXs) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'tower'} level ${level} transverse beam`,
        semanticRole: 'tower_beam',
        sourcePartKind: 'structural_tower_frame',
        position: [center[0] + x, y, center[2]],
        length: columnSize,
        width,
        height: columnSize,
        material: frameMat,
      })
    }
    if (level > 0) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'tower'} level ${level} grated platform`,
        semanticRole: 'multi_level_platform',
        sourcePartKind: 'structural_tower_frame',
        position: [center[0], y + deckThickness * 0.55, center[2]],
        length: length * 0.95,
        width: width * 0.95,
        height: deckThickness,
        material: deckMat,
      })
      shapes.push(
        {
          kind: 'box',
          name: `${part.name ?? input.name ?? 'tower'} level ${level} front guard rail`,
          semanticRole: 'platform_guard_rail',
          sourcePartKind: 'structural_tower_frame',
          position: [center[0], y + columnSize * 2.2, center[2] + width * 0.5],
          length: length,
          width: columnSize * 0.55,
          height: columnSize * 0.55,
          material: railMat,
        },
        {
          kind: 'box',
          name: `${part.name ?? input.name ?? 'tower'} level ${level} rear guard rail`,
          semanticRole: 'platform_guard_rail',
          sourcePartKind: 'structural_tower_frame',
          position: [center[0], y + columnSize * 2.2, center[2] - width * 0.5],
          length,
          width: columnSize * 0.55,
          height: columnSize * 0.55,
          material: railMat,
        },
      )
    }
  }

  if (includeDiagonalBraces) {
    const bayHeight = height / levels
    const braceLength = Math.hypot(length, bayHeight)
    const braceAngle = Math.atan2(bayHeight, length)
    for (let level = 0; level < levels; level += 1) {
      const y = bottomY + bayHeight * (level + 0.5)
      for (const z of cornerZs) {
        shapes.push(
          {
            kind: 'box',
            name: `${part.name ?? input.name ?? 'tower'} level ${level + 1} diagonal brace`,
            semanticRole: 'tower_diagonal_brace',
            sourcePartKind: 'structural_tower_frame',
            position: [center[0], y, center[2] + z],
            length: braceLength,
            width: columnSize * 0.42,
            height: columnSize * 0.42,
            rotation: [0, 0, braceAngle],
            material: railMat,
          },
          {
            kind: 'box',
            name: `${part.name ?? input.name ?? 'tower'} level ${level + 1} cross brace`,
            semanticRole: 'tower_diagonal_brace',
            sourcePartKind: 'structural_tower_frame',
            position: [center[0], y, center[2] + z],
            length: braceLength,
            width: columnSize * 0.38,
            height: columnSize * 0.38,
            rotation: [0, 0, -braceAngle],
            material: railMat,
          },
        )
      }
    }
  }

  if (includeExternalStairs) {
    const stairDepth = Math.max(columnSize * 5, width * (stairPlacement === 'inside' ? 0.2 : 0.24))
    const stairWidth = Math.max(
      columnSize * 2.4,
      length * (stairPlacement === 'inside' ? 0.07 : 0.08),
    )
    const sideX =
      stairPlacement === 'inside'
        ? center[0] + stairSide * (length * 0.5 - stairWidth * 0.8 - columnSize * 2.2)
        : center[0] + stairSide * (length * 0.5 + columnSize * 3.2)
    const stairCenterZ =
      stairPlacement === 'inside'
        ? center[2] + width * 0.18
        : center[2] + width * 0.5 + columnSize * 2.4
    const flightHeight = height / stairFlights
    const flightRun = Math.max(stairDepth * 0.72, columnSize * 5)
    const flightLength = Math.hypot(flightRun, flightHeight * 0.72)
    const flightAngle = Math.atan2(flightHeight * 0.72, flightRun)

    for (let flight = 0; flight < stairFlights; flight += 1) {
      const y = bottomY + flightHeight * (flight + 0.5)
      const direction = flight % 2 === 0 ? 1 : -1
      shapes.push(
        {
          kind: 'box',
          name: `${part.name ?? input.name ?? 'tower'} ${stairPlacement} stair flight ${flight + 1}`,
          semanticRole:
            stairPlacement === 'inside' ? 'internal_stair_flight' : 'external_stair_flight',
          sourcePartKind: 'structural_tower_frame',
          position: [sideX, y, stairCenterZ + direction * stairDepth * 0.18],
          length: stairWidth,
          width: flightLength,
          height: columnSize * 0.48,
          rotation: [direction * flightAngle, 0, 0],
          material: deckMat,
        },
        {
          kind: 'box',
          name: `${part.name ?? input.name ?? 'tower'} ${stairPlacement} stair landing ${flight + 1}`,
          semanticRole:
            stairPlacement === 'inside' ? 'internal_stair_landing' : 'external_stair_landing',
          sourcePartKind: 'structural_tower_frame',
          position: [
            sideX,
            bottomY + flightHeight * (flight + 1),
            stairCenterZ - direction * stairDepth * 0.34,
          ],
          length: stairWidth * 1.35,
          width: stairDepth * 0.45,
          height: deckThickness,
          material: deckMat,
        },
        {
          kind: 'box',
          name: `${part.name ?? input.name ?? 'tower'} ${stairPlacement} stair guard rail ${flight + 1}`,
          semanticRole:
            stairPlacement === 'inside' ? 'internal_stair_guard_rail' : 'external_stair_guard_rail',
          sourcePartKind: 'structural_tower_frame',
          position: [
            sideX + stairSide * stairWidth * 0.58,
            y + columnSize * 1.8,
            stairCenterZ + direction * stairDepth * 0.18,
          ],
          length: columnSize * 0.52,
          width: flightLength,
          height: columnSize * 0.55,
          rotation: [direction * flightAngle, 0, 0],
          material: railMat,
        },
      )
    }
  } else {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'tower'} vertical access ladder`,
      semanticRole: 'access_ladder',
      sourcePartKind: 'structural_tower_frame',
      position: [center[0] - length * 0.56, center[1], center[2] + width * 0.56],
      length: columnSize * 1.1,
      width: columnSize * 2.4,
      height: height * 0.86,
      material: railMat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeCycloneSeparatorUnit(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const height = clamp(part.height, 1.2, 0.45, 4)
  const radius = clamp(part.radius ?? part.diameter, 0.26, 0.08, 1.4)
  const coneHeight = clamp(part.depth, height * 0.28, height * 0.16, height * 0.42)
  const bodyHeight = clamp(part.bodyHeight, height * 0.48, height * 0.28, height * 0.68)
  const outletHeight = clamp(part.length, height * 0.2, height * 0.08, height * 0.34)
  const ductRadius = clamp(part.thickness, radius * 0.26, 0.025, radius * 0.5)
  const center = add(origin, part.position ?? [0, height / 2, 0])
  const bottomY = center[1] - height / 2
  const coneCenterY = bottomY + coneHeight / 2
  const bodyCenterY = bottomY + coneHeight + bodyHeight / 2
  const topY = bottomY + coneHeight + bodyHeight
  const sideSign = part.side === 'left' ? -1 : 1
  const shellMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#9ca3af', 0.38, 0.44),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#1f2937', 0.56, 0.28)
  const ductMat = material(part.metalColor ?? input.metalColor ?? '#64748b', 0.48, 0.42)
  const segments = Math.max(24, Math.round(ringSegments(input.detail) * 0.75))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'cyclone'} cylindrical cyclone body`,
      semanticRole: part.semanticRole ?? 'preheater_cyclone',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0], bodyCenterY, center[2]],
      axis: 'y',
      radius,
      height: bodyHeight,
      radialSegments: segments,
      material: shellMat,
    },
    {
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'cyclone'} conical lower hopper`,
      semanticRole: 'cyclone_cone',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0], coneCenterY, center[2]],
      axis: 'y',
      radiusTop: radius,
      radiusBottom: radius * 0.22,
      height: coneHeight,
      radialSegments: segments,
      material: shellMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'cyclone'} top outlet riser`,
      semanticRole: 'cyclone_top_outlet',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0], topY + outletHeight / 2, center[2]],
      axis: 'y',
      radius: radius * 0.46,
      height: outletHeight,
      radialSegments: Math.max(20, Math.round(segments * 0.66)),
      material: ductMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'cyclone'} tangential gas inlet`,
      semanticRole: 'preheater_gas_duct',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0] + sideSign * radius * 1.12, bodyCenterY + bodyHeight * 0.22, center[2]],
      axis: 'x',
      radius: ductRadius,
      height: radius * 1.2,
      radialSegments: 16,
      material: ductMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'cyclone'} meal drop pipe`,
      semanticRole: 'meal_drop_pipe',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0], bottomY - height * 0.18, center[2]],
      axis: 'y',
      radius: radius * 0.14,
      height: height * 0.36,
      radialSegments: 14,
      material: darkMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'cyclone'} body flange band`,
      semanticRole: 'cyclone_connection_band',
      sourcePartKind: 'cyclone_separator_unit',
      position: [center[0], topY - bodyHeight * 0.08, center[2]],
      axis: 'y',
      majorRadius: radius * 1.01,
      tubeRadius: Math.max(0.006, radius * 0.035),
      radialSegments: 8,
      tubularSegments: segments,
      material: darkMat,
    },
  ]

  return applyPartRotation(shapes, center, part.rotation)
}

function composeCouplingGuard(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.58, 0.16, 2.4)
  const radius = clamp(part.radius ?? part.diameter, 0.16, 0.04, 0.7)
  const thickness = clamp(part.thickness, 0.028, 0.006, 0.16)
  const center = add(origin, part.position ?? [0, radius, 0])
  const guardMat = partMaterial(
    part,
    material(part.color ?? input.accentColor ?? '#facc15', 0.42, 0.16),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.5, 0.16)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'half-cylinder',
      name: `${part.name ?? input.name ?? 'machine'} coupling guard cover`,
      semanticRole: part.semanticRole ?? 'coupling_guard',
      sourcePartKind: 'coupling_guard',
      position: center,
      axis: 'x',
      radius,
      height: length,
      thickness,
      radialSegments: 24,
      material: guardMat,
    },
  ]
  for (const x of [-1, 1]) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} coupling guard end flange`,
      semanticRole: 'guard_end_flange',
      sourcePartKind: 'coupling_guard',
      position: [center[0] + x * length * 0.5, center[1] - radius * 0.12, center[2]],
      length: thickness,
      width: radius * 2.05,
      height: radius * 0.18,
      material: darkMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeMotorGearboxUnit(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.05, 0.3, 4)
  const radius = clamp(part.radius ?? part.diameter, 0.18, 0.05, 0.8)
  const height = clamp(part.height, radius * 2.1, 0.12, 1.8)
  const center = add(origin, part.position ?? [0, height * 0.52, 0])
  const motorMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#64748b', 0.68, 0.22),
  )
  const gearboxMat = material(part.secondaryColor ?? input.secondaryColor ?? '#475569', 0.72, 0.2)
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#111827', 0.5, 0.18)
  const motorLength = length * 0.55
  const gearboxLength = length * 0.26
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} drive motor`,
      semanticRole: 'drive_motor',
      sourcePartKind: 'motor_gearbox_unit',
      position: [center[0] - length * 0.16, center[1], center[2]],
      axis: 'x',
      radius,
      height: motorLength,
      radialSegments: 32,
      material: motorMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} gearbox housing`,
      semanticRole: part.semanticRole ?? 'gearbox_body',
      sourcePartKind: 'motor_gearbox_unit',
      position: [center[0] + length * 0.32, center[1], center[2]],
      length: gearboxLength,
      width: radius * 1.85,
      height: height,
      cornerRadius: radius * 0.12,
      cornerSegments: 4,
      material: gearboxMat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} output shaft`,
      semanticRole: 'output_shaft',
      sourcePartKind: 'motor_gearbox_unit',
      position: [center[0] + length * 0.52, center[1], center[2]],
      axis: 'x',
      radius: radius * 0.18,
      height: length * 0.18,
      radialSegments: 20,
      material: darkMat,
    },
  ]
  for (let i = 0; i < 6; i += 1) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} motor cooling rib`,
      semanticRole: 'motor_cooling_rib',
      sourcePartKind: 'motor_gearbox_unit',
      position: [
        center[0] - length * 0.16 - motorLength * 0.32 + i * motorLength * 0.13,
        center[1] + radius,
        center[2],
      ],
      length: motorLength * 0.05,
      width: radius * 1.55,
      height: Math.max(0.015, radius * 0.08),
      material: darkMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composePipeManifold(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.2, 0.25, 6)
  const radius = clamp(part.radius ?? part.diameter, 0.065, 0.012, 0.4)
  const count = clampInt(part.count ?? part.portCount, 4, 2, 10)
  const center = add(origin, part.position ?? [0, radius * 2.2, 0])
  const pipeMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#94a3b8', 0.8, 0.22),
  )
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'machine'} manifold header`,
      semanticRole: part.semanticRole ?? 'pipe_manifold',
      sourcePartKind: 'pipe_manifold',
      position: center,
      axis: 'x',
      radius,
      height: length,
      wallThickness: Math.max(0.004, radius * 0.16),
      radialSegments: 28,
      material: pipeMat,
    },
  ]
  for (let i = 0; i < count; i += 1) {
    const x = center[0] - length * 0.38 + (length * 0.76 * i) / Math.max(1, count - 1)
    shapes.push({
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'machine'} manifold branch ${i + 1}`,
      semanticRole: 'manifold_branch',
      sourcePartKind: 'pipe_manifold',
      position: [x, center[1] + radius * 1.9, center[2]],
      axis: 'y',
      radius: radius * 0.62,
      height: radius * 3.2,
      wallThickness: Math.max(0.003, radius * 0.12),
      radialSegments: 20,
      material: pipeMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeHopperBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.9, 0.25, 4)
  const width = clamp(part.width ?? part.depth, 0.7, 0.2, 3)
  const height = clamp(part.height, 0.8, 0.25, 3.5)
  const center = add(origin, part.position ?? [0, height * 0.62, 0])
  const topLengthScale = Array.isArray(part.topScale)
    ? clamp(part.topScale[0], 1.65, 0.2, 3)
    : clamp(typeof part.topScale === 'number' ? part.topScale : part.topLengthScale, 1.65, 0.2, 3)
  const topWidthScale = Array.isArray(part.topScale)
    ? clamp(part.topScale[1], 1.45, 0.2, 3)
    : clamp(typeof part.topScale === 'number' ? part.topScale : part.topWidthScale, 1.45, 0.2, 3)
  const bodyMat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#94a3b8', 0.55, 0.14),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#374151', 0.5, 0.16)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'trapezoid-prism',
      name: `${part.name ?? input.name ?? 'machine'} tapered hopper body`,
      semanticRole: part.semanticRole ?? 'hopper_body',
      sourcePartKind: 'hopper_body',
      position: center,
      length,
      width,
      height,
      topScale: [topLengthScale, topWidthScale],
      topLengthScale,
      topWidthScale,
      material: bodyMat,
    },
    {
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'machine'} hopper outlet throat`,
      semanticRole: 'hopper_outlet',
      sourcePartKind: 'hopper_body',
      position: [center[0], center[1] - height * 0.58, center[2]],
      axis: 'y',
      radiusTop: Math.min(length, width) * 0.22,
      radiusBottom: Math.min(length, width) * 0.1,
      height: height * 0.25,
      radialSegments: 4,
      material: darkMat,
    },
  ]
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      shapes.push({
        kind: 'box',
        name: `${part.name ?? input.name ?? 'machine'} hopper support leg`,
        semanticRole: 'hopper_support_leg',
        sourcePartKind: 'hopper_body',
        position: [center[0] + x * length * 0.38, height * 0.28, center[2] + z * width * 0.36],
        length: Math.max(0.035, length * 0.035),
        width: Math.max(0.035, width * 0.04),
        height: height * 0.56,
        material: darkMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeConicalHopper(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const radiusTop = clamp(part.radiusTop ?? part.radius ?? part.width, 0.42, 0.08, 3)
  const radiusBottom = clamp(
    part.radiusBottom ?? part.outletRadius,
    radiusTop * 0.18,
    0.02,
    radiusTop,
  )
  const height = clamp(part.height, 0.82, 0.18, 5)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const mat = partMaterial(
    part,
    material(part.primaryColor ?? input.primaryColor ?? '#94a3b8', 0.52, 0.16),
  )
  const darkMat = material(part.darkColor ?? input.darkColor ?? '#374151', 0.5, 0.16)
  const role = genericPartRole(part, 'conical_hopper')
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'machine'} conical hopper`,
      semanticRole: role,
      sourcePartKind: 'conical_hopper',
      position: center,
      axis: 'y',
      radiusTop,
      radiusBottom,
      height,
      radialSegments: clampInt(part.radialSegments, 32, 4, 64),
      material: mat,
    },
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'machine'} hopper outlet collar`,
      semanticRole: 'hopper_outlet_collar',
      sourcePartKind: 'conical_hopper',
      position: [center[0], center[1] - height * 0.52, center[2]],
      axis: 'y',
      radius: radiusBottom * 1.08,
      height: Math.max(0.04, height * 0.08),
      wallThickness: Math.max(0.004, radiusBottom * 0.12),
      radialSegments: 24,
      material: darkMat,
    },
  ]
  if (part.includeSupportLegs !== false) {
    for (const angle of [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'machine'} hopper support leg`,
        semanticRole: 'support_leg',
        sourcePartKind: 'conical_hopper',
        position: [
          center[0] + Math.cos(angle) * radiusTop * 0.72,
          height * 0.25,
          center[2] + Math.sin(angle) * radiusTop * 0.72,
        ],
        axis: 'y',
        radius: Math.max(0.014, radiusTop * 0.035),
        height: height * 0.5,
        radialSegments: 8,
        material: darkMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeServicePlatform(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.2, 0.3, 6)
  const width = clamp(part.width ?? part.depth, 0.65, 0.2, 3)
  const height = clamp(part.height, 0.9, 0.2, 3.5)
  const railHeight = clamp(part.overallHeight, height * 0.42, 0.18, 1.4)
  const center = add(origin, part.position ?? [0, height, 0])
  const deckMat = partMaterial(
    part,
    material(part.metalColor ?? input.metalColor ?? '#64748b', 0.65, 0.18),
  )
  const railMat = material(part.color ?? input.accentColor ?? '#facc15', 0.42, 0.12)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'machine'} service platform deck`,
      semanticRole: part.semanticRole ?? 'service_platform',
      sourcePartKind: 'service_platform',
      position: center,
      length,
      width,
      thickness: Math.max(0.04, height * 0.06),
      cornerRadius: Math.min(length, width) * 0.025,
      cornerSegments: 2,
      material: deckMat,
    },
  ]
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'machine'} platform post`,
        semanticRole: 'platform_post',
        sourcePartKind: 'service_platform',
        position: [
          center[0] + x * length * 0.46,
          center[1] + railHeight * 0.5,
          center[2] + z * width * 0.44,
        ],
        axis: 'y',
        radius: 0.018,
        height: railHeight,
        radialSegments: 10,
        material: railMat,
      })
    }
  }
  for (const z of [-1, 1]) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'machine'} platform guard rail`,
      semanticRole: 'guard_rail',
      sourcePartKind: 'service_platform',
      position: [center[0], center[1] + railHeight * 0.85, center[2] + z * width * 0.44],
      length,
      width: 0.035,
      height: 0.035,
      material: railMat,
    })
  }
  shapes.push({
    kind: 'box',
    name: `${part.name ?? input.name ?? 'machine'} access ladder`,
    semanticRole: 'access_ladder',
    sourcePartKind: 'service_platform',
    position: [center[0] - length * 0.48, center[1] - height * 0.35, center[2]],
    length: 0.04,
    width: width * 0.35,
    height,
    material: railMat,
  })
  return applyPartRotation(shapes, center, part.rotation)
}

function composePlatformWithLadder(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const shapes = composeServicePlatform(input, part, origin)
  const center = add(origin, part.position ?? [0, clamp(part.height, 0.9, 0.2, 3.5), 0])
  const length = clamp(part.length, 1.2, 0.3, 6)
  const width = clamp(part.width ?? part.depth, 0.65, 0.2, 3)
  const height = clamp(part.height, 0.9, 0.2, 3.5)
  const railMat = material(part.color ?? input.accentColor ?? '#facc15', 0.42, 0.12)
  const rungCount = clampInt(
    part.rungCount ?? part.count,
    detailDefaultInt(input, part, { low: 4, medium: 6, high: 10 }),
    3,
    16,
  )
  const ladderX = center[0] - length * 0.52
  const ladderZ = center[2] - width * 0.18
  for (const zOffset of [-0.08, 0.08]) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} ladder side rail`,
      semanticRole: 'ladder_side_rail',
      sourcePartKind: 'platform_with_ladder',
      position: [ladderX, center[1] - height * 0.45, ladderZ + zOffset],
      axis: 'y',
      radius: 0.014,
      height,
      radialSegments: 8,
      material: railMat,
    })
  }
  for (let index = 0; index < rungCount; index += 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'machine'} ladder rung ${index + 1}`,
      semanticRole: 'ladder_rung',
      sourcePartKind: 'platform_with_ladder',
      position: [
        ladderX,
        center[1] - height * 0.88 + (height * 0.78 * index) / Math.max(1, rungCount - 1),
        ladderZ,
      ],
      axis: 'z',
      radius: 0.012,
      height: 0.22,
      radialSegments: 8,
      material: railMat,
    })
  }
  return shapes.map((shape) =>
    shape.sourcePartKind === 'service_platform'
      ? { ...shape, sourcePartKind: 'platform_with_ladder' }
      : shape,
  )
}

function kioskTotalDimensions(input: PartComposeInput) {
  const length = clamp(input.length, 1.8, 0.4, 8)
  const width = clamp(input.width ?? input.depth, 1.2, 0.3, 5)
  const height = clamp(input.height, 2.1, 0.7, 5)
  return { length, width, height }
}

function composeKioskBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const length = clamp(part.length, total.length, 0.4, 8)
  const width = clamp(part.width ?? part.depth, total.width, 0.3, 5)
  const height = clamp(part.height, total.height * 0.78, 0.4, 5)
  const center = add(origin, part.position ?? [0, height * 0.5, 0])
  const mat = partMaterial(part, material(part.primaryColor ?? input.primaryColor ?? '#d1d5db'))
  return applyPartRotation(
    [
      {
        kind: 'box',
        name: part.name ?? `${input.name ?? 'kiosk'} body`,
        semanticRole: part.semanticRole ?? 'kiosk_body',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_body',
        position: center,
        length,
        width,
        height,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, width, height) * 0.025, 0, 0.3),
        cornerSegments: part.cornerSegments ?? 3,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeKioskRoof(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const bodyHeight = total.height * 0.78
  const length = clamp(part.length, total.length * 1.16, 0.4, 9)
  const width = clamp(part.width ?? part.depth, total.width * 1.18, 0.3, 6)
  const height = clamp(part.height ?? part.thickness, total.height * 0.16, 0.04, 1.2)
  const center = add(origin, part.position ?? [0, bodyHeight + height * 0.5, 0])
  const mat = partMaterial(part, material(part.color ?? input.secondaryColor ?? '#7f1d1d'))
  return applyPartRotation(
    [
      {
        kind: part.variant === 'flat' ? 'box' : 'wedge',
        name: part.name ?? `${input.name ?? 'kiosk'} roof`,
        semanticRole: part.semanticRole ?? 'roof',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_roof',
        position: center,
        length,
        width,
        height,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeKioskOpening(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const length = clamp(part.length, total.length * 0.42, 0.08, 5)
  const panelHeight = clamp(part.height ?? part.width, total.height * 0.34, 0.08, 4)
  const thickness = clamp(part.thickness ?? part.depth, 0.035, 0.004, 0.5)
  const center = add(origin, part.position ?? [0, total.height * 0.42, total.width * 0.515])
  const mat = partMaterial(part, material(part.color ?? input.darkColor ?? '#111827', 0.58, 0.04))
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name: part.name ?? `${input.name ?? 'kiosk'} service opening`,
        semanticRole: part.semanticRole ?? 'opening',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_opening',
        position: center,
        length,
        width: panelHeight,
        thickness,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, panelHeight) * 0.05, 0, 0.25),
        cornerSegments: part.cornerSegments ?? 4,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeKioskCounter(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const length = clamp(part.length, total.length * 0.62, 0.08, 6)
  const width = clamp(part.width ?? part.depth, total.width * 0.2, 0.04, 2)
  const thickness = clamp(part.thickness ?? part.height, total.height * 0.04, 0.02, 0.6)
  const center = add(origin, part.position ?? [0, total.height * 0.27, total.width * 0.62])
  const mat = partMaterial(part, material(part.color ?? input.metalColor ?? '#9ca3af', 0.45, 0.18))
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name: part.name ?? `${input.name ?? 'kiosk'} service counter`,
        semanticRole: part.semanticRole ?? 'service_counter',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_counter',
        position: center,
        length,
        width,
        thickness,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, width) * 0.04, 0, 0.2),
        cornerSegments: part.cornerSegments ?? 4,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeKioskSign(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const length = clamp(part.length, total.length * 0.64, 0.08, 6)
  const panelHeight = clamp(part.height ?? part.width, total.height * 0.12, 0.04, 1.5)
  const thickness = clamp(part.thickness ?? part.depth, 0.035, 0.004, 0.4)
  const center = add(origin, part.position ?? [0, total.height * 0.72, total.width * 0.54])
  const mat = partMaterial(part, material(part.accentColor ?? input.accentColor ?? '#facc15', 0.32))
  return applyPartRotation(
    [
      {
        kind: 'rounded-panel',
        name: part.name ?? `${input.name ?? 'kiosk'} sign panel`,
        semanticRole: part.semanticRole ?? 'sign_panel',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_sign',
        position: center,
        length,
        width: panelHeight,
        thickness,
        cornerRadius: clamp(part.cornerRadius, Math.min(length, panelHeight) * 0.08, 0, 0.2),
        cornerSegments: part.cornerSegments ?? 4,
        material: mat,
      },
    ],
    center,
    part.rotation,
  )
}

function composeKioskAwning(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const total = kioskTotalDimensions(input)
  const length = clamp(part.length, total.length * 0.72, 0.08, 7)
  const width = clamp(part.width ?? part.depth, total.width * 0.32, 0.04, 2.4)
  const thickness = clamp(part.thickness ?? part.height, total.height * 0.04, 0.02, 0.8)
  const center = add(origin, part.position ?? [0, total.height * 0.58, total.width * 0.64])
  const mat = partMaterial(part, material(part.color ?? input.secondaryColor ?? '#ef4444', 0.48))
  return applyPartRotation(
    [
      {
        kind: 'wedge',
        name: part.name ?? `${input.name ?? 'kiosk'} front awning`,
        semanticRole: part.semanticRole ?? 'awning',
        semanticGroup: part.semanticGroup ?? 'kiosk',
        sourcePartKind: 'kiosk_awning',
        position: center,
        rotation: part.rotation ?? [0, 0, 0],
        length,
        width,
        height: thickness,
        material: mat,
      },
    ],
    center,
    undefined,
  )
}

function composeGearboxBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.34, 0])
  const length = clamp(part.length, 0.46, 0.12, 2)
  const width = clamp(part.width, 0.34, 0.08, 1.4)
  const height = clamp(part.height, 0.34, 0.08, 1.4)
  const mat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.46, 0.38))
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} gearbox housing`,
      position: center,
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.1,
      cornerSegments: 5,
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} gearbox output shaft`,
      position: [center[0] + length * 0.68, center[1], center[2]],
      axis: 'x',
      radius: height * 0.14,
      height: length * 0.34,
      radialSegments: 20,
      material: metal,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} gearbox input shaft`,
      position: [center[0] - length * 0.62, center[1] + height * 0.18, center[2]],
      axis: 'x',
      radius: height * 0.1,
      height: length * 0.24,
      radialSegments: 18,
      material: metal,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} gearbox nameplate`,
      position: [center[0], center[1] + height * 0.04, center[2] + width * 0.51],
      length: length * 0.36,
      width: height * 0.18,
      thickness: width * 0.025,
      cornerRadius: height * 0.015,
      cornerSegments: 3,
      material: material(input.metalColor ?? '#facc15', 0.24, 0.65),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeFilterVessel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.62, 0])
  const radius = clamp(part.radius, 0.18, 0.05, 1.2)
  const height = clamp(part.height ?? part.length, 0.72, 0.18, 3)
  const mat = partMaterial(part, material(input.primaryColor ?? '#94a3b8', 0.42, 0.45))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} filter vessel shell`,
      position: center,
      axis: 'y',
      radius,
      height,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} filter top cap`,
      position: [center[0], center[1] + height * 0.53, center[2]],
      radius: 1,
      scale: [radius, radius * 0.32, radius],
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} filter bottom cap`,
      position: [center[0], center[1] - height * 0.53, center[2]],
      radius: 1,
      scale: [radius, radius * 0.32, radius],
      material: mat,
    },
    ...composePipePort(
      input,
      {
        kind: 'inlet_port',
        name: `${part.name ?? input.name ?? 'object'} filter inlet`,
        position: [center[0] - radius * 0.95, center[1] + height * 0.18, center[2]],
        axis: 'x',
        side: 'left',
        radius: radius * 0.18,
        length: radius * 0.7,
      },
      [0, 0, 0],
      'inlet_port',
    ),
    ...composePipePort(
      input,
      {
        kind: 'outlet_port',
        name: `${part.name ?? input.name ?? 'object'} filter outlet`,
        position: [center[0] + radius * 0.95, center[1] - height * 0.18, center[2]],
        axis: 'x',
        side: 'right',
        radius: radius * 0.18,
        length: radius * 0.7,
      },
      [0, 0, 0],
      'outlet_port',
    ),
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeHeatExchanger(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'x')
  const center = add(origin, part.position ?? [0, 0.52, 0])
  const radius = clamp(part.radius, 0.18, 0.05, 1.2)
  const length = clamp(part.length ?? part.height, 1.0, 0.24, 5)
  const mat = partMaterial(part, material(input.primaryColor ?? '#9ca3af', 0.42, 0.5))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} heat exchanger shell`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} heat exchanger left channel head`,
      position: offsetAlongAxis(center, axis, -length * 0.55),
      axis,
      radius: radius * 1.04,
      height: length * 0.08,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} heat exchanger right channel head`,
      position: offsetAlongAxis(center, axis, length * 0.55),
      axis,
      radius: radius * 1.04,
      height: length * 0.08,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    ...[-0.36, -0.12, 0.12, 0.36].map(
      (offset): PrimitiveShapeInput => ({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} heat exchanger tube bundle`,
        position:
          axis === 'x'
            ? [center[0], center[1] + radius * offset, center[2] + radius * 0.18]
            : [center[0] + radius * offset, center[1], center[2] + radius * 0.18],
        axis,
        radius: radius * 0.035,
        height: length * 0.86,
        radialSegments: 10,
        material: material(input.metalColor ?? '#cbd5e1', 0.3, 0.75),
      }),
    ),
    ...composePipePort(
      input,
      {
        kind: 'inlet_port',
        name: `${part.name ?? input.name ?? 'object'} heat exchanger top nozzle`,
        position: [center[0] - length * 0.25, center[1] + radius * 1.15, center[2]],
        axis: 'y',
        side: 'top',
        radius: radius * 0.14,
        length: radius * 0.45,
      },
      [0, 0, 0],
      'inlet_port',
    ),
    ...composePipePort(
      input,
      {
        kind: 'outlet_port',
        name: `${part.name ?? input.name ?? 'object'} heat exchanger bottom nozzle`,
        position: [center[0] + length * 0.25, center[1] - radius * 1.15, center[2]],
        axis: 'y',
        side: 'bottom',
        radius: radius * 0.14,
        length: radius * 0.45,
      },
      [0, 0, 0],
      'outlet_port',
    ),
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeAgitatorTank(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.58, 0])
  const radius = clamp(part.radius, 0.24, 0.06, 1.5)
  const height = clamp(part.height ?? part.length, 0.7, 0.2, 3)
  const wallThickness = clamp(
    part.thickness ?? part.shellThickness,
    radius * 0.075,
    radius * 0.02,
    radius * 0.28,
  )
  const mat = partMaterial(part, material(input.primaryColor ?? '#94a3b8', 0.42, 0.46))
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const dark = material(part.motorColor ?? input.darkColor ?? '#1f2937', 0.56, 0.24)
  const legStyle = String(part.legStyle ?? '').toLowerCase()
  const bottomStyle = String(part.bottomStyle ?? '').toLowerCase()
  const legCount = clampInt(part.legCount ?? part.count, legStyle === 'splayed' ? 3 : 4, 3, 4)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator tank shell`,
      semanticRole: part.semanticRole ?? 'reactor_vessel_shell',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: center,
      axis: 'y',
      radius,
      height,
      wallThickness,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} agitator top dished head`,
      semanticRole: 'vessel_head',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] + height * 0.52, center[2]],
      radius: 1,
      scale: [radius, radius * 0.32, radius],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} agitator bottom dished head`,
      semanticRole: 'vessel_head',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] - height * 0.52, center[2]],
      radius: 1,
      scale: [radius, radius * 0.26, radius],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} agitator top seam ring`,
      semanticRole: 'vessel_seam',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] + height * 0.5, center[2]],
      axis: 'y',
      majorRadius: radius * 1.01,
      tubeRadius: wallThickness * 0.45,
      radialSegments: 10,
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.7)),
      material: metal,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator motor`,
      semanticRole: 'agitator_motor',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] + height * 0.66, center[2]],
      axis: 'y',
      radius: radius * 0.22,
      height: radius * 0.38,
      radialSegments: 24,
      material: dark,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator shaft`,
      semanticRole: 'agitator_shaft',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] + height * 0.05, center[2]],
      axis: 'y',
      radius: radius * 0.035,
      height: height * 0.9,
      radialSegments: 12,
      material: metal,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator hub`,
      semanticRole: 'agitator_hub',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] - height * 0.22, center[2]],
      axis: 'y',
      radius: radius * 0.12,
      height: radius * 0.16,
      radialSegments: 18,
      material: metal,
    },
  ]
  if (bottomStyle === 'conical') {
    shapes.push({
      kind: 'frustum',
      name: `${part.name ?? input.name ?? 'object'} conical discharge bottom`,
      semanticRole: 'conical_discharge_bottom',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0], center[1] - height * 0.52 - radius * 0.18, center[2]],
      axis: 'y',
      radiusTop: radius * 0.42,
      radiusBottom: radius * 0.12,
      height: radius * 0.36,
      radialSegments: ringSegments(input.detail),
      material: mat,
    })
  }
  for (let i = 0; i < 3; i += 1) {
    const angle = (i * Math.PI * 2) / 3
    shapes.push({
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} agitator blade ${i + 1}`,
      semanticRole: 'reactor_impeller',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [
        center[0] + Math.cos(angle) * radius * 0.22,
        center[1] - height * 0.22,
        center[2] + Math.sin(angle) * radius * 0.22,
      ],
      rotation: [0, 0, angle],
      axis: 'x',
      radius: radius * 0.035,
      height: radius * 0.55,
      radialSegments: 10,
      capSegments: 3,
      material: metal,
    })
  }
  shapes.push(
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator side inlet nozzle`,
      semanticRole: 'feed_nozzle',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0] - radius * 1.06, center[1] + height * 0.16, center[2]],
      axis: 'x',
      radius: radius * 0.13,
      height: radius * 0.48,
      wallThickness: wallThickness * 0.65,
      radialSegments: 20,
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator manway flange`,
      semanticRole: 'manway_flange',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      position: [center[0] + radius * 1.04, center[1] + height * 0.1, center[2]],
      axis: 'x',
      radius: radius * 0.2,
      height: wallThickness * 3,
      radialSegments: 28,
      material: dark,
    },
  )
  for (let i = 0; i < legCount; i += 1) {
    const angle =
      legCount === 3 ? -Math.PI / 2 + (i * Math.PI * 2) / 3 : Math.PI / 4 + (i * Math.PI * 2) / 4
    const topRadius = radius * 0.58
    const footRadius = legStyle === 'splayed' ? radius * 0.86 : radius * 0.62
    const topY = center[1] - height * 0.5 - radius * 0.02
    const bottomY = center[1] - height * 0.5 - radius * 0.5
    const start: Vec3 = [
      center[0] + Math.cos(angle) * topRadius,
      topY,
      center[2] + Math.sin(angle) * topRadius,
    ]
    const end: Vec3 = [
      center[0] + Math.cos(angle) * footRadius,
      bottomY,
      center[2] + Math.sin(angle) * footRadius,
    ]
    shapes.push({
      ...tubeBetween(
        `${part.name ?? input.name ?? 'object'} agitator support leg`,
        start,
        end,
        radius * 0.04,
        dark,
      ),
      semanticRole: 'support_leg',
      sourcePartKind: part.sourcePartKind ?? 'agitator_tank',
      radialSegments: 12,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composePipeRack(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.45, 0])
  const length = clamp(part.length, 1.4, 0.3, 6)
  const width = clamp(part.width, 0.5, 0.12, 2.5)
  const height = clamp(part.height, 0.7, 0.2, 3)
  const pipeCount = clampInt(part.count, 3, 1, 8)
  const r = clamp(part.radius ?? part.wireRadius, 0.025, 0.006, 0.12)
  const steel = partMaterial(part, material(input.metalColor ?? '#94a3b8', 0.34, 0.72))
  const pipeMat = material(input.primaryColor ?? '#64748b', 0.45, 0.42)
  const shapes: PrimitiveShapeInput[] = []
  for (const x of [-length / 2, length / 2]) {
    for (const z of [-width / 2, width / 2]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} pipe rack column`,
        position: [center[0] + x, center[1], center[2] + z],
        axis: 'y',
        radius: r,
        height,
        radialSegments: 12,
        material: steel,
      })
    }
  }
  for (const z of [-width / 2, width / 2]) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} pipe rack beam`,
      position: [center[0], center[1] + height / 2, center[2] + z],
      length,
      width: r * 1.6,
      height: r * 1.6,
      material: steel,
    })
  }
  for (let i = 0; i < pipeCount; i += 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} rack pipe ${i + 1}`,
      position: [
        center[0],
        center[1] + height * 0.55,
        center[2] + (i - (pipeCount - 1) / 2) * ((width * 0.72) / Math.max(1, pipeCount - 1)),
      ],
      axis: 'x',
      radius: r * 0.85,
      height: length * 1.08,
      radialSegments: 16,
      material: pipeMat,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composePlatformLadder(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.75, 0])
  const length = clamp(part.length, 0.72, 0.2, 3)
  const width = clamp(part.width, 0.48, 0.12, 2)
  const height = clamp(part.height, 0.9, 0.25, 4)
  const r = clamp(part.radius ?? part.wireRadius, 0.018, 0.004, 0.08)
  const steel = partMaterial(part, material(input.metalColor ?? '#94a3b8', 0.34, 0.72))
  const defaultRungCount = detailDefaultInt(input, part, {
    low: Math.max(4, Math.round(height / 0.26)),
    medium: Math.max(5, Math.round(height / 0.18)),
    high: Math.max(7, Math.round(height / 0.14)),
  })
  const rungCount = clampInt(part.rungCount ?? part.count, defaultRungCount, 4, 16)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} access platform deck`,
      semanticRole: part.semanticRole ?? 'access_platform',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [center[0], center[1] + height * 0.18, center[2]],
      length,
      width,
      height: r * 0.8,
      material: steel,
    },
  ]
  for (let i = 1; i < 4; i += 1) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} platform deck grating ${i}`,
      semanticRole: 'platform_grating',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [
        center[0],
        center[1] + height * 0.185,
        center[2] - width * 0.35 + i * width * 0.18,
      ],
      length: length * 0.92,
      width: r * 0.36,
      height: r * 0.9,
      material: steel,
    })
  }
  for (const x of [-length / 2, length / 2]) {
    for (const z of [-width / 2, width / 2]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} platform support post`,
        semanticRole: 'platform_post',
        sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
        position: [center[0] + x, center[1] - height * 0.25, center[2] + z],
        axis: 'y',
        radius: r,
        height,
        radialSegments: 12,
        material: steel,
      })
    }
  }
  for (const [name, z] of [
    ['front', width / 2],
    ['back', -width / 2],
  ] as const) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} platform guard rail ${name}`,
      semanticRole: 'guard_rail',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [center[0], center[1] + height * 0.42, center[2] + z],
      axis: 'x',
      radius: r,
      height: length,
      radialSegments: 12,
      material: steel,
    })
  }
  for (const [name, x] of [
    ['left', -length / 2],
    ['right', length / 2],
  ] as const) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} platform side guard rail ${name}`,
      semanticRole: 'guard_rail',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [center[0] + x, center[1] + height * 0.42, center[2]],
      axis: 'z',
      radius: r,
      height: width,
      radialSegments: 12,
      material: steel,
    })
  }
  for (const z of [center[2] - width * 0.68, center[2] - width * 0.48]) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ladder side rail`,
      semanticRole: 'ladder_side_rail',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [center[0] - length * 0.62, center[1] - height * 0.1, z],
      axis: 'y',
      radius: r,
      height: height * 0.92,
      radialSegments: 10,
      material: steel,
    })
  }
  for (let i = 0; i < rungCount; i += 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ladder rung ${i + 1}`,
      semanticRole: 'ladder_rung',
      sourcePartKind: part.sourcePartKind ?? 'platform_ladder',
      position: [
        center[0] - length * 0.62,
        center[1] - height * 0.55 + ((i + 1) * (height * 0.82)) / (rungCount + 1),
        center[2] - width * 0.58,
      ],
      axis: 'z',
      radius: r * 0.65,
      height: width * 0.42,
      radialSegments: 10,
      material: steel,
    })
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeNameplate(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.45, 0.21])
  const length = clamp(part.length, 0.18, 0.04, 0.8)
  const width = clamp(part.width ?? part.height, 0.08, 0.02, 0.4)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} nameplate`,
      position: center,
      length,
      width,
      thickness: clamp(part.depth, 0.008, 0.002, 0.04),
      cornerRadius: Math.min(length, width) * 0.08,
      cornerSegments: 3,
      material: partMaterial(part, material(input.metalColor ?? '#facc15', 0.24, 0.65)),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeWarningLabel(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0.08, 0.5, 0.215])
  const length = clamp(part.length, 0.14, 0.04, 0.6)
  const width = clamp(part.width ?? part.height, 0.07, 0.02, 0.3)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} warning label`,
      position: center,
      length,
      width,
      thickness: clamp(part.depth, 0.006, 0.001, 0.03),
      cornerRadius: Math.min(length, width) * 0.06,
      cornerSegments: 3,
      material: partMaterial(part, material('#f59e0b', 0.5, 0.02)),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeSeamRing(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'z')
  const center = add(origin, part.position ?? [0, 0.5, 0])
  const radius = clamp(part.radius, 0.2, 0.02, 2)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} seam ring`,
      position: center,
      axis,
      majorRadius: radius,
      tubeRadius: clamp(part.wireRadius, radius * 0.018, 0.002, 0.03),
      radialSegments: 8,
      tubularSegments: ringSegments(input.detail),
      material: partMaterial(part, material(input.darkColor ?? '#334155', 0.5, 0.18)),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeDeskTop(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.2, 0.35, 4)
  const width = clamp(part.width ?? part.depth, 0.6, 0.2, 2)
  const thickness = clamp(part.height ?? part.depth, 0.055, 0.02, 0.18)
  const center = add(origin, part.position ?? [0, 0.74, 0])
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} desk top`,
      position: center,
      length,
      width,
      thickness,
      cornerRadius: Math.min(length, width) * 0.035,
      cornerSegments: 5,
      material: partMaterial(part, material(input.primaryColor ?? '#b7794b', 0.62, 0.02)),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeLegSet(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 1.08, 0.25, 4)
  const width = clamp(part.width ?? part.depth, 0.5, 0.15, 2)
  const height = clamp(part.height, 0.7, 0.12, 1.4)
  const radius = clamp(part.radius, 0.025, 0.008, 0.09)
  const center = add(origin, part.position ?? [0, height / 2, 0])
  const insetX = Math.max(radius * 2.2, length * 0.08)
  const insetZ = Math.max(radius * 2.2, width * 0.1)
  const legMat = partMaterial(part, material(input.metalColor ?? '#9ca3af', 0.36, 0.68))
  const shapes: PrimitiveShapeInput[] = []

  for (const x of [-length / 2 + insetX, length / 2 - insetX]) {
    for (const z of [-width / 2 + insetZ, width / 2 - insetZ]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} desk leg`,
        position: [center[0] + x, center[1], center[2] + z],
        axis: 'y',
        radius,
        height,
        radialSegments: 16,
        material: legMat,
      })
    }
  }

  shapes.push({
    kind: 'cylinder',
    name: `${part.name ?? input.name ?? 'object'} rear stretcher`,
    position: [center[0], center[1] + height * 0.2, center[2] - width / 2 + insetZ],
    axis: 'x',
    radius: radius * 0.6,
    height: length - insetX * 2,
    radialSegments: 10,
    material: legMat,
  })

  return applyPartRotation(shapes, center, part.rotation)
}

function composeDrawerStack(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.34, 0.14, 1.2)
  const width = clamp(part.width ?? part.depth, 0.44, 0.12, 1)
  const height = clamp(part.height, 0.52, 0.16, 1.1)
  const drawerCount = clampInt(part.count, 3, 1, 6)
  const center = add(origin, part.position ?? [0.38, 0.46, 0])
  const mat = partMaterial(part, material(input.primaryColor ?? '#a16207', 0.58, 0.03))
  const faceMat = material(input.secondaryColor ?? '#c08457', 0.56, 0.02)
  const metal = material(input.metalColor ?? '#d1d5db', 0.26, 0.72)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} drawer stack cabinet`,
      position: center,
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.045,
      cornerSegments: 4,
      material: mat,
    },
  ]

  for (let i = 0; i < drawerCount; i += 1) {
    const y = center[1] + height / 2 - ((i + 0.5) * height) / drawerCount
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} drawer front ${i + 1}`,
      position: [center[0], y, center[2] + width * 0.51],
      length: length * 0.88,
      width: width * 0.035,
      height: (height / drawerCount) * 0.72,
      cornerRadius: Math.min(length, height / drawerCount) * 0.035,
      cornerSegments: 3,
      material: faceMat,
    })
    shapes.push({
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} drawer handle ${i + 1}`,
      position: [center[0], y, center[2] + width * 0.545],
      axis: 'x',
      radius: length * 0.018,
      height: length * 0.34,
      radialSegments: 10,
      capSegments: 3,
      material: metal,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composeElectricalCabinet(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const length = clamp(part.length, 0.55, 0.18, 2)
  const width = clamp(part.width ?? part.depth, 0.22, 0.08, 1)
  const height = clamp(part.height, 0.95, 0.32, 3)
  const center = add(origin, part.position ?? [0, height / 2, 0])
  const bodyMat = partMaterial(part, material(input.primaryColor ?? '#d1d5db', 0.48, 0.22))
  const dark = material(input.darkColor ?? '#334155', 0.48, 0.22)
  const warning = material('#f59e0b', 0.5, 0.02)
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.74)
  const doorCount = clampInt(part.doorCount, 1, 1, 4)
  const frontNormal: Vec3 = [0, 0, 1]
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet body`,
      position: center,
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.035,
      bevelRadius: Math.min(length, width, height) * 0.035,
      cornerSegments: 4,
      cutouts: [
        {
          id: 'cabinet_door_recess',
          kind: 'rectangular',
          semanticRole: 'access_door',
          position: [center[0], center[1], center[2] + width * 0.51],
          normal: frontNormal,
          axis: 'z',
          length: length * 0.92,
          height: height * 0.86,
          depth: width * 0.035,
          bevelRadius: Math.min(length, height) * 0.02,
        },
        {
          id: 'cabinet_nameplate_recess',
          kind: 'rectangular',
          semanticRole: 'nameplate',
          position: [
            center[0] - length * 0.22,
            center[1] - height * 0.22,
            center[2] + width * 0.56,
          ],
          normal: frontNormal,
          axis: 'z',
          length: length * 0.24,
          height: height * 0.055,
          depth: width * 0.02,
          bevelRadius: length * 0.008,
        },
        {
          id: 'cabinet_vent_opening',
          kind: 'slot',
          semanticRole: 'vent',
          position: [center[0], center[1] - height * 0.28, center[2] + width * 0.56],
          normal: frontNormal,
          axis: 'z',
          length: length * 0.42,
          height: height * 0.16,
          depth: width * 0.02,
          bevelRadius: height * 0.006,
        },
      ],
      ports: [
        {
          id: 'cabinet_access_front',
          kind: 'access',
          semanticRole: 'access_door',
          position: [center[0], center[1], center[2] + width * 0.56],
          normal: frontNormal,
          axis: 'z',
          width: length * 0.92,
          height: height * 0.86,
          direction: 'bidirectional',
        },
      ],
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet door panel`,
      position: [center[0], center[1], center[2] + width * 0.515],
      length: length * 0.92,
      width: width * 0.035,
      height: height * 0.86,
      cornerRadius: Math.min(length, height) * 0.02,
      cornerSegments: 3,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet warning label`,
      position: [center[0] - length * 0.22, center[1] + height * 0.22, center[2] + width * 0.57],
      length: length * 0.2,
      width: width * 0.02,
      height: height * 0.08,
      cornerRadius: length * 0.01,
      cornerSegments: 3,
      material: warning,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet nameplate`,
      position: [center[0] - length * 0.22, center[1] - height * 0.22, center[2] + width * 0.57],
      length: length * 0.24,
      width: width * 0.02,
      height: height * 0.055,
      cornerRadius: length * 0.008,
      cornerSegments: 3,
      material: metal,
    },
  ]

  for (let i = 1; i < doorCount; i += 1) {
    const x = center[0] - length * 0.46 + (length * 0.92 * i) / doorCount
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet door seam ${i}`,
      position: [x, center[1], center[2] + width * 0.54],
      length: length * 0.012,
      width: width * 0.015,
      height: height * 0.82,
      material: dark,
    })
  }

  for (let i = 0; i < doorCount; i += 1) {
    const doorCenterX = center[0] - length * 0.46 + (length * 0.92 * (i + 0.5)) / doorCount
    shapes.push({
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet handle ${i + 1}`,
      position: [
        doorCenterX + (length * 0.28) / doorCount,
        center[1] + height * 0.03,
        center[2] + width * 0.565,
      ],
      axis: 'y',
      radius: length * 0.018,
      height: height * 0.2,
      radialSegments: 10,
      capSegments: 3,
      material: metal,
    })
  }

  const slatCount = clampInt(part.slatCount ?? part.count, 5, 2, 10)
  for (let i = 0; i < slatCount; i += 1) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet vent slat ${i + 1}`,
      position: [
        center[0],
        center[1] - height * 0.34 + i * height * 0.028,
        center[2] + width * 0.575,
      ],
      length: length * 0.42,
      width: width * 0.018,
      height: height * 0.008,
      material: dark,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function composePipeRun(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'x')
  const length = clamp(part.length ?? part.height, 1, 0.08, 8)
  const radius = clamp(part.radius, 0.055, 0.008, 0.45)
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const pipeMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.42, 0.42))
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.75)
  const wallThickness = clamp(part.depth, radius * 0.18, radius * 0.05, radius * 0.45)
  const start = offsetAlongAxis(center, axis, -length / 2)
  const end = offsetAlongAxis(center, axis, length / 2)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} pipe run`,
      position: center,
      axis,
      radius,
      height: length,
      wallThickness,
      radialSegments: 24,
      duct: {
        crossSection: 'round',
        radius,
        wallThickness,
      },
      ports: [
        {
          id: 'pipe_start',
          kind: 'inlet',
          semanticRole: 'pipe_start',
          position: start,
          normal: axisNormal(axis, -1),
          axis,
          radius,
          direction: 'in',
        },
        {
          id: 'pipe_end',
          kind: 'outlet',
          semanticRole: 'pipe_end',
          position: end,
          normal: axisNormal(axis, 1),
          axis,
          radius,
          direction: 'out',
        },
      ],
      material: pipeMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} pipe run left coupling`,
      position: start,
      axis,
      majorRadius: radius,
      tubeRadius: radius * 0.12,
      radialSegments: 8,
      tubularSegments: 24,
      material: metal,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} pipe run right coupling`,
      position: end,
      axis,
      majorRadius: radius,
      tubeRadius: radius * 0.12,
      radialSegments: 8,
      tubularSegments: 24,
      material: metal,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composePipeElbow(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const radius = clamp(part.radius, 0.055, 0.008, 0.45)
  const bendRadius = clamp(
    part.bendRadius ?? part.length ?? part.depth,
    radius * 4.2,
    radius * 1.4,
    2,
  )
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const mat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.42, 0.42))
  const start: Vec3 = [center[0] - bendRadius, center[1], center[2]]
  const end: Vec3 = [center[0], center[1], center[2] + bendRadius]
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'sweep',
      name: `${part.name ?? input.name ?? 'object'} pipe elbow`,
      position: center,
      path: [
        [-bendRadius, 0, 0],
        [-bendRadius * 0.72, 0, bendRadius * 0.55],
        [-bendRadius * 0.28, 0, bendRadius * 0.9],
        [0, 0, bendRadius],
      ],
      radius,
      radialSegments: 16,
      tubularSegments: 32,
      duct: {
        crossSection: 'round',
        radius,
        wallThickness: radius * 0.18,
      },
      ports: [
        {
          id: 'elbow_start',
          kind: 'inlet',
          semanticRole: 'pipe_start',
          position: start,
          normal: [-1, 0, 0],
          axis: 'x',
          radius,
          direction: 'in',
        },
        {
          id: 'elbow_end',
          kind: 'outlet',
          semanticRole: 'pipe_end',
          position: end,
          normal: [0, 0, 1],
          axis: 'z',
          radius,
          direction: 'out',
        },
      ],
      material: mat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} elbow start rim`,
      position: start,
      axis: 'x',
      majorRadius: radius,
      tubeRadius: radius * 0.12,
      radialSegments: 8,
      tubularSegments: 24,
      material: material(input.metalColor ?? '#cbd5e1', 0.28, 0.75),
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} elbow end rim`,
      position: end,
      axis: 'z',
      majorRadius: radius,
      tubeRadius: radius * 0.12,
      radialSegments: 8,
      tubularSegments: 24,
      material: material(input.metalColor ?? '#cbd5e1', 0.28, 0.75),
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeCableTray(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.72, 0])
  const length = clamp(part.length, 1.2, 0.24, 6)
  const width = clamp(part.width ?? part.depth, 0.26, 0.08, 1.2)
  const railHeight = clamp(part.height, 0.08, 0.025, 0.4)
  const thickness = clamp(part.radius ?? part.wireRadius, 0.018, 0.004, 0.08)
  const slatCount = clampInt(part.slatCount ?? part.count, 7, 2, 18)
  const mat = partMaterial(part, material(input.metalColor ?? '#94a3b8', 0.34, 0.72))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} cable tray left rail`,
      position: [center[0], center[1], center[2] - width / 2],
      length,
      width: thickness,
      height: railHeight,
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} cable tray right rail`,
      position: [center[0], center[1], center[2] + width / 2],
      length,
      width: thickness,
      height: railHeight,
      material: mat,
    },
  ]

  for (let i = 0; i < slatCount; i += 1) {
    shapes.push({
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} cable tray rung ${i + 1}`,
      position: [
        center[0] - length / 2 + ((i + 0.5) * length) / slatCount,
        center[1] - railHeight * 0.42,
        center[2],
      ],
      length: thickness * 1.2,
      width,
      height: thickness * 0.65,
      material: mat,
    })
  }

  return applyPartRotation(shapes, center, part.rotation)
}

function partCenter(part: PartComposePartInput, kind: PartComposeKind | null): Vec3 {
  if (part.position) return part.position
  switch (kind) {
    case 'circular_base': {
      const height = clamp(part.height ?? part.depth, 0.08, 0.01, 0.4)
      return [0, height / 2, 0]
    }
    case 'vertical_pole': {
      const height = clamp(part.height ?? part.length, 1, 0.05, 50)
      return [0, height / 2 + 0.08, 0]
    }
    case 'motor_housing':
    case 'fan_blade':
    case 'radial_blades':
    case 'protective_grill':
      return [0, 1.18, kind === 'motor_housing' ? -0.024 : 0.04]
    case 'wheel':
    case 'wheel_set':
      return [0, clamp(part.radius ?? part.wheelRadius, 0.14, 0.025, 1.2), 0]
    case 'window_panel':
    case 'window_strip':
      return [0, 0.55, 0.02]
    case 'propeller_blade_set':
    case 'mixer_blades':
    case 'airfoil_blade':
      return [0, 0.4, 0]
    case 'ellipsoid_shell':
      return [0, clamp(part.height, 0.18, 0.02, 3) * 0.56, 0]
    case 'curved_lens_panel':
      return [0, 0.45, 0]
    case 'ergonomic_shell':
      return [0, clamp(part.height, 0.036, 0.01, 0.6) * 0.72, 0]
    case 'streamlined_body':
      return [0, clamp(part.height, 0.22, 0.02, 2.5) * 0.55, 0]
    case 'lofted_panel':
      return [0, clamp(part.height, 0.12, 0.01, 1.8) * 0.7, 0]
    case 'support_bracket':
      return [0, 1.08, 0]
    case 'control_knob':
      return [0, 0.22, 0.2]
    case 'skid_base':
      return [0, 0.06, 0]
    case 'support_roller_pair':
      return [0, 0.22, 0]
    case 'structural_tower_frame':
      return [0, clamp(part.height, 5, 1, 16) / 2, 0]
    case 'cyclone_separator_unit':
      return [0, clamp(part.height, 1.2, 0.3, 4) / 2, 0]
    case 'rounded_machine_body':
      return [0, 0.45, 0]
    case 'flange_ring':
    case 'bolt_pattern':
      return [0, 0.55, 0.5]
    case 'inlet_port':
    case 'outlet_port':
    case 'pipe_port':
      return [0, 0.55, 0.45]
    case 'volute_casing':
      return [0, 0.55, 0.18]
    case 'control_box':
      return [0.32, 0.62, 0.24]
    case 'ribbed_motor_body':
    case 'gearbox_body':
      return [kind === 'ribbed_motor_body' ? -0.24 : 0, 0.42, 0]
    case 'conveyor_frame':
      return [0, 0.38, 0]
    case 'roller_array':
      return [0, 0.52, 0]
    case 'belt_surface':
      return [0, 0.56, 0]
    case 'desk_top':
      return [0, 0.74, 0]
    case 'leg_set':
      return [0, clamp(part.height, 0.7, 0.12, 1.4) / 2, 0]
    case 'drawer_stack':
      return [0.38, 0.46, 0]
    case 'electrical_cabinet':
      return [0, clamp(part.height, 0.95, 0.32, 3) / 2, 0]
    case 'pipe_run':
    case 'pipe_elbow':
      return [0, 0.55, 0]
    case 'valve_body':
      return [0, 0.38, 0]
    case 'handwheel':
      return [0, 0.62, 0]
    case 'cable_tray':
      return [0, 0.72, 0]
    default:
      return [0, 0, 0]
  }
}

function partHalfExtents(part: PartComposePartInput, kind: PartComposeKind | null): Vec3 {
  const axis = partAxis(part.axis, kind === 'outlet_port' ? 'x' : 'z')
  const radius = clamp(
    part.radius,
    kind === 'flange_ring' ? 0.12 : kind === 'valve_body' ? 0.12 : 0.08,
    0.01,
    2,
  )
  const length = clamp(
    part.length ?? part.depth ?? part.height,
    kind === 'flange_ring' ? 0.035 : kind === 'valve_body' ? 0.46 : 0.26,
    0.004,
    6,
  )
  const axisExtents = (alongAxis: number, radial: number): Vec3 => {
    switch (axis) {
      case 'x':
        return [alongAxis, radial, radial]
      case 'y':
        return [radial, alongAxis, radial]
      default:
        return [radial, radial, alongAxis]
    }
  }

  switch (kind) {
    case 'circular_base': {
      const baseRadius = clamp(part.radius, 0.28, 0.05, 2)
      const baseHeight = clamp(part.height ?? part.depth, 0.08, 0.01, 0.4)
      return [baseRadius, baseHeight / 2, baseRadius]
    }
    case 'vertical_pole': {
      const poleRadius = clamp(part.radius, 0.025, 0.005, 2)
      const poleHeight = clamp(part.height ?? part.length, 1, 0.05, 50)
      return [poleRadius, poleHeight / 2, poleRadius]
    }
    case 'motor_housing': {
      const motorRadius = clamp(part.radius, 0.11, 0.03, 0.5)
      const motorDepth = clamp(part.depth ?? part.length ?? part.height, 0.16, 0.03, 0.8)
      return [motorRadius, motorRadius, motorDepth / 2]
    }
    case 'fan_blade': {
      const bladeLength = clamp(part.length ?? part.bladeRadius ?? part.radius, 0.24, 0.04, 1.2)
      const bladeWidth = clamp(part.bladeWidth ?? part.width, bladeLength * 0.24, 0.012, 0.55)
      const bladeDepth = clamp(part.thickness ?? part.depth ?? part.height, 0.018, 0.003, 0.08)
      const hubRadius = clamp(part.wireRadius, bladeLength * 0.22, 0.01, bladeLength * 0.45)
      return [hubRadius + bladeLength, bladeWidth / 2, bladeDepth / 2]
    }
    case 'radial_blades': {
      const bladeRadius = clamp(part.bladeRadius ?? part.radius, 0.28, 0.05, 1.4)
      const bladeThickness = clamp(part.height ?? part.thickness, 0.012, 0.003, 0.05)
      return [bladeRadius, bladeRadius, bladeThickness / 2]
    }
    case 'propeller_blade_set':
    case 'mixer_blades': {
      const bladeLength = clamp(part.bladeRadius ?? part.radius ?? part.length, 0.34, 0.08, 1.2)
      const bladeWidth = clamp(part.bladeWidth ?? part.width, 0.13, 0.04, 0.45)
      const bladeDepth = clamp(part.depth ?? part.height, 0.028, 0.01, 0.09)
      const hubRadius = clamp(part.wireRadius, bladeLength * 0.12, 0.015, bladeLength * 0.32)
      return [hubRadius + bladeLength, bladeDepth / 2, hubRadius + bladeLength + bladeWidth / 2]
    }
    case 'wheel':
    case 'wheel_set': {
      const wheelRadius = clamp(part.radius ?? part.wheelRadius, 0.14, 0.025, 1.2)
      const wheelWidth = clamp(part.wheelWidth ?? part.depth, wheelRadius * 0.42, 0.012, 0.6)
      const length = clamp(part.length, 0.95, 0, 8)
      const width = clamp(part.width, 0.54, 0, 4)
      return [Math.max(length / 2, wheelRadius), wheelRadius, Math.max(width / 2, wheelWidth / 2)]
    }
    case 'window_panel':
      return [
        clamp(part.length ?? part.width, 0.32, 0.02, 4) / 2,
        clamp(part.height, 0.18, 0.015, 2) / 2,
        clamp(part.thickness ?? part.depth, 0.01, 0.002, 0.12) / 2,
      ]
    case 'window_strip':
      return [
        clamp(part.length, 1.2, 0.08, 12) / 2,
        clamp(part.height, 0.09, 0.01, 0.5) / 2,
        clamp(part.thickness ?? part.depth, 0.01, 0.002, 0.12) / 2,
      ]
    case 'airfoil_blade': {
      const bladeLength = clamp(part.length ?? part.bladeRadius ?? part.radius, 0.46, 0.06, 2.5)
      const rootWidth = clamp(part.rootWidth ?? part.bladeWidth ?? part.width, 0.13, 0.015, 0.8)
      const thickness = clamp(part.thickness ?? part.depth ?? part.height, 0.025, 0.003, 0.16)
      const hubRadius = clamp(part.wireRadius, bladeLength * 0.12, 0.01, bladeLength * 0.35)
      return [hubRadius + bladeLength, rootWidth / 2, hubRadius + bladeLength]
    }
    case 'ellipsoid_shell':
      return [
        clamp(part.length, 0.48, 0.04, 6) / 2,
        clamp(part.height, 0.18, 0.02, 3) / 2,
        clamp(part.width ?? part.depth, 0.28, 0.025, 4) / 2,
      ]
    case 'curved_lens_panel':
      return [
        clamp(part.width ?? part.length, 0.32, 0.04, 2) / 2,
        clamp(part.height, 0.18, 0.025, 1.2) / 2,
        clamp(part.thickness ?? part.depth, 0.012, 0.002, 0.08) / 2,
      ]
    case 'ergonomic_shell':
      return [
        clamp(part.length, 0.12, 0.04, 2) / 2,
        clamp(part.height, 0.036, 0.01, 0.6) / 2,
        clamp(part.width ?? part.depth, 0.065, 0.02, 1) / 2,
      ]
    case 'streamlined_body':
      return [
        clamp(part.length, 1.2, 0.08, 8) / 2,
        clamp(part.height, 0.22, 0.02, 2.5) / 2,
        clamp(part.width ?? part.depth, 0.36, 0.03, 3) / 2,
      ]
    case 'aircraft_fuselage':
      return [
        clamp(part.length, 1.12, 0.4, 8) / 2,
        clamp(part.height, clamp(part.width ?? part.depth, 0.14, 0.05, 1.4) * 1.08, 0.04, 1.2) / 2,
        clamp(part.width ?? part.depth, 0.14, 0.05, 1.4) / 2,
      ]
    case 'aircraft_wing':
      return [
        clamp(part.width ?? part.depth, 0.18, 0.04, 1.2) / 2,
        clamp(part.thickness ?? part.height, 0.018, 0.004, 0.12) / 2,
        clamp(part.length, 0.95, 0.2, 5) / 2,
      ]
    case 'aircraft_engine': {
      const engineRadius = clamp(part.radius, 0.065, 0.018, 0.5)
      const engineLength = clamp(part.length ?? part.depth, 0.24, 0.05, 1.4)
      const engineSpacing = clamp(part.width, 0.46, engineRadius * 3, 2)
      return [engineLength / 2, engineRadius, engineSpacing / 2 + engineRadius]
    }
    case 'aircraft_vertical_stabilizer':
      return [
        clamp(part.length, 0.22, 0.04, 1.5) / 2,
        clamp(part.height, 0.28, 0.04, 1.4) / 2,
        clamp(part.width ?? part.thickness, 0.025, 0.004, 0.16) / 2,
      ]
    case 'aircraft_horizontal_stabilizer':
      return [
        clamp(part.width ?? part.depth, 0.1, 0.03, 0.8) / 2,
        clamp(part.thickness ?? part.height, 0.014, 0.003, 0.08) / 2,
        clamp(part.length, 0.42, 0.08, 2.5) / 2,
      ]
    case 'aircraft_landing_gear': {
      const gearRadius = clamp(part.radius ?? part.wheelRadius, 0.035, 0.012, 0.2)
      return [
        clamp(part.length, 0.62, gearRadius * 5, 2.5) / 2,
        gearRadius * 2.8,
        clamp(part.width, 0.32, gearRadius * 3, 1.4) / 2 + gearRadius,
      ]
    }
    case 'generic_body':
      return [
        clamp(part.length, 1, 0.08, 8) / 2,
        clamp(part.height, 0.8, 0.05, 5) / 2,
        clamp(part.width ?? part.depth, 0.65, 0.05, 5) / 2,
      ]
    case 'generic_base':
      return [
        clamp(part.length, 1.08, 0.08, 8) / 2,
        clamp(part.thickness ?? part.height, 0.08, 0.01, 0.8) / 2,
        clamp(part.width ?? part.depth, 0.72, 0.05, 5) / 2,
      ]
    case 'generic_panel':
    case 'generic_control_panel':
    case 'generic_display':
    case 'generic_opening':
    case 'generic_detail_accent':
      return [
        clamp(part.length, 0.3, 0.02, 4) / 2,
        clamp(part.height ?? part.width, 0.22, 0.02, 3) / 2,
        clamp(part.thickness ?? part.depth, 0.025, 0.002, 0.4) / 2,
      ]
    case 'generic_handle':
      return [
        clamp(part.length, 0.22, 0.03, 2) / 2,
        clamp(part.radius, 0.018, 0.004, 0.12),
        clamp(part.depth ?? part.width, 0.05, 0.01, 0.5) / 2,
      ]
    case 'generic_spout':
      return [
        clamp(part.radius, 0.035, 0.004, 0.2),
        clamp(part.radius, 0.035, 0.004, 0.2),
        clamp(part.length ?? part.depth ?? part.height, 0.2, 0.02, 1.2) / 2,
      ]
    case 'generic_foot_set':
      return [
        clamp(part.length, 0.9, 0.08, 8) / 2,
        clamp(part.height, 0.08, 0.02, 0.8) / 2,
        clamp(part.width ?? part.depth, 0.55, 0.05, 5) / 2,
      ]
    case 'kiosk_body':
      return [
        clamp(part.length, 1.8, 0.4, 8) / 2,
        clamp(part.height, 1.7, 0.4, 5) / 2,
        clamp(part.width ?? part.depth, 1.2, 0.3, 5) / 2,
      ]
    case 'kiosk_roof':
      return [
        clamp(part.length, 2.1, 0.4, 9) / 2,
        clamp(part.height ?? part.thickness, 0.28, 0.04, 1.2) / 2,
        clamp(part.width ?? part.depth, 1.45, 0.3, 6) / 2,
      ]
    case 'kiosk_opening':
      return [
        clamp(part.length, 0.8, 0.08, 5) / 2,
        clamp(part.height ?? part.width, 0.75, 0.08, 4) / 2,
        clamp(part.thickness ?? part.depth, 0.035, 0.004, 0.5) / 2,
      ]
    case 'kiosk_counter':
      return [
        clamp(part.length, 1, 0.08, 6) / 2,
        clamp(part.thickness ?? part.height, 0.08, 0.02, 0.6) / 2,
        clamp(part.width ?? part.depth, 0.28, 0.04, 2) / 2,
      ]
    case 'kiosk_sign':
      return [
        clamp(part.length, 1, 0.08, 6) / 2,
        clamp(part.height ?? part.width, 0.26, 0.04, 1.5) / 2,
        clamp(part.thickness ?? part.depth, 0.035, 0.004, 0.4) / 2,
      ]
    case 'kiosk_awning':
      return [
        clamp(part.length, 1.25, 0.08, 7) / 2,
        clamp(part.thickness ?? part.height, 0.08, 0.02, 0.8) / 2,
        clamp(part.width ?? part.depth, 0.45, 0.04, 2.4) / 2,
      ]
    case 'lofted_panel':
      return [
        clamp(part.length, 0.8, 0.08, 6) / 2,
        clamp(part.height, 0.12, 0.01, 1.8) / 2,
        clamp(part.width ?? part.depth, 0.28, 0.02, 2) / 2,
      ]
    case 'protective_grill': {
      const grillRadius = clamp(part.radius, 0.36, 0.08, 2)
      const grillDepth = clamp(part.depth, 0.12, 0.005, 0.6)
      return [grillRadius, grillRadius, grillDepth / 2]
    }
    case 'support_bracket':
      return [
        clamp(part.width ?? part.length, 0.22, 0.04, 1) / 2,
        clamp(part.height, 0.16, 0.03, 0.8) / 2,
        clamp(part.depth, 0.045, 0.01, 0.3) / 2,
      ]
    case 'control_knob': {
      const knobRadius = clamp(part.radius, 0.045, 0.01, 0.2)
      const knobDepth = clamp(part.depth ?? part.height, 0.025, 0.004, 0.12)
      return [knobRadius, knobRadius, knobDepth / 2]
    }
    case 'pyramid':
      return [
        clamp(part.length ?? part.width ?? part.diameter, 0.6, 0.02, 20) / 2,
        clamp(part.height ?? part.depth, 0.8, 0.02, 20) / 2,
        clamp(part.width ?? part.length ?? part.diameter, 0.6, 0.02, 20) / 2,
      ]
    case 'skid_base':
      return [
        clamp(part.length ?? part.depth, 1.1, 0.25, 5) / 2,
        clamp(part.height, 0.08, 0.02, 0.35) / 2,
        clamp(part.width, 0.46, 0.12, 2) / 2,
      ]
    case 'flange_ring':
    case 'bolt_pattern':
      return axisExtents(length / 2, radius)
    case 'pipe_port':
    case 'inlet_port':
    case 'outlet_port':
      return axisExtents(length / 2, radius)
    case 'valve_body':
      return axisExtents(length / 2, radius)
    case 'volute_casing': {
      const r = clamp(part.radius, 0.28, 0.06, 2)
      const d = clamp(part.depth ?? part.width, r * 0.48, 0.03, 1)
      return [r, r, d / 2]
    }
    case 'rounded_machine_body':
    case 'control_box':
    case 'gearbox_body':
    case 'ribbed_motor_body':
    case 'body_shell':
    case 'electrical_cabinet':
    case 'conveyor_frame':
    case 'roller_array':
    case 'belt_surface':
      if (kind === 'ribbed_motor_body') {
        return axisExtents(
          clamp(part.length ?? part.depth, 0.48, 0.12, 3) / 2,
          clamp(part.radius, 0.18, 0.04, 1),
        )
      }
      if (kind === 'conveyor_frame') {
        return [
          clamp(part.length, 1.4, 0.3, 6) / 2,
          clamp(part.height, 0.42, 0.12, 2) / 2,
          clamp(part.width, 0.42, 0.12, 2) / 2,
        ]
      }
      if (kind === 'roller_array') {
        return [
          clamp(part.length, 1.2, 0.2, 6) / 2,
          clamp(part.radius, 0.035, 0.008, 0.18),
          clamp(part.width, 0.46, 0.08, 2) / 2,
        ]
      }
      if (kind === 'belt_surface') {
        return [
          clamp(part.length, 1.35, 0.2, 6) / 2,
          clamp(part.height ?? part.depth, 0.025, 0.004, 0.12) / 2,
          clamp(part.width, 0.46, 0.08, 2) / 2,
        ]
      }
      if (kind === 'control_box') {
        return [
          clamp(part.width ?? part.length, 0.24, 0.04, 1.5) / 2,
          clamp(part.height, 0.32, 0.06, 1.5) / 2,
          clamp(part.depth, 0.11, 0.025, 0.7) / 2,
        ]
      }
      return [
        clamp(
          part.length,
          kind === 'body_shell' ? 1.2 : kind === 'electrical_cabinet' ? 0.55 : 0.6,
          0.1,
          6,
        ) / 2,
        clamp(part.height, kind === 'electrical_cabinet' ? 0.95 : 0.34, 0.05, 3) / 2,
        clamp(part.width ?? part.depth, kind === 'electrical_cabinet' ? 0.22 : 0.34, 0.05, 3) / 2,
      ]
    case 'desk_top':
      return [
        clamp(part.length, 1.2, 0.35, 4) / 2,
        clamp(part.height ?? part.depth, 0.055, 0.02, 0.18) / 2,
        clamp(part.width ?? part.depth, 0.6, 0.2, 2) / 2,
      ]
    case 'leg_set':
      return [
        clamp(part.length, 1.08, 0.25, 4) / 2,
        clamp(part.height, 0.7, 0.12, 1.4) / 2,
        clamp(part.width ?? part.depth, 0.5, 0.15, 2) / 2,
      ]
    case 'drawer_stack':
      return [
        clamp(part.length, 0.34, 0.14, 1.2) / 2,
        clamp(part.height, 0.52, 0.16, 1.1) / 2,
        clamp(part.width ?? part.depth, 0.44, 0.12, 1) / 2,
      ]
    case 'cable_tray':
      return [
        clamp(part.length, 1.2, 0.24, 6) / 2,
        clamp(part.height, 0.08, 0.025, 0.4) / 2,
        clamp(part.width ?? part.depth, 0.26, 0.08, 1.2) / 2,
      ]
    case 'pipe_run': {
      const pipeAxis = partAxis(part.axis, 'x')
      const pipeLength = clamp(part.length ?? part.height, 1, 0.08, 8)
      const pipeRadius = clamp(part.radius, 0.055, 0.008, 0.45)
      return pipeAxis === 'x'
        ? [pipeLength / 2, pipeRadius, pipeRadius]
        : pipeAxis === 'y'
          ? [pipeRadius, pipeLength / 2, pipeRadius]
          : [pipeRadius, pipeRadius, pipeLength / 2]
    }
    case 'pipe_elbow': {
      const pipeRadius = clamp(part.radius, 0.055, 0.008, 0.45)
      const bendRadius = clamp(
        part.bendRadius ?? part.length ?? part.depth,
        pipeRadius * 4.2,
        pipeRadius * 1.4,
        2,
      )
      return [bendRadius / 2 + pipeRadius, pipeRadius, bendRadius / 2 + pipeRadius]
    }
    case 'cylindrical_tank':
    case 'chimney_stack':
    case 'heat_exchanger': {
      const r = clamp(part.radius, 0.2, 0.04, 2)
      const l = clamp(part.length ?? part.height, 0.9, 0.1, 6) / 2
      if (kind === 'chimney_stack') {
        const h = clamp(part.height ?? part.length, 6, 0.6, 80)
        const chimneyRadius = clamp(part.radius ?? part.width ?? part.diameter, h * 0.055, 0.05, 6)
        return [chimneyRadius * 1.42, h / 2, chimneyRadius * 1.42]
      }
      return partAxis(part.axis, 'x') === 'x' ? [l, r, r] : [r, l, r]
    }
    default:
      return [0.1, 0.1, 0.1]
  }
}

function anchorOffset(anchor: unknown, extents: Vec3): Vec3 {
  switch (anchor) {
    case 'left':
      return [-extents[0], 0, 0]
    case 'right':
      return [extents[0], 0, 0]
    case 'top':
      return [0, extents[1], 0]
    case 'bottom':
      return [0, -extents[1], 0]
    case 'front':
      return [0, 0, extents[2]]
    case 'back':
      return [0, 0, -extents[2]]
    default:
      return [0, 0, 0]
  }
}

function connectionPointOffset(
  part: PartComposePartInput,
  kind: PartComposeKind | null,
  point: unknown,
): Vec3 {
  const normalizedPoint =
    typeof point === 'string'
      ? point
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
      : ''
  const extents = partHalfExtents(part, kind)
  const axis = partAxis(part.axis, kind === 'outlet_port' ? 'x' : 'z')
  const radius = clamp(part.radius, 0.08, 0.01, 2)
  const length = clamp(
    part.length ?? part.depth ?? part.height,
    kind === 'flange_ring' ? 0.035 : 0.26,
    0.004,
    6,
  )
  const side = partSide(part.side)
  const sideSign = signForSide(side, axis)
  const axisOffset = (distance: number) =>
    sub(offsetAlongAxis([0, 0, 0], axis, distance), [0, 0, 0])

  switch (kind) {
    case 'circular_base':
      if (
        normalizedPoint === 'top' ||
        normalizedPoint === 'mount' ||
        normalizedPoint === 'center'
      ) {
        return [0, extents[1], 0]
      }
      if (normalizedPoint === 'bottom' || normalizedPoint === 'floor') return [0, -extents[1], 0]
      break
    case 'vertical_pole':
      if (normalizedPoint === 'top' || normalizedPoint === 'head' || normalizedPoint === 'mount') {
        return [0, extents[1], 0]
      }
      if (
        normalizedPoint === 'bottom' ||
        normalizedPoint === 'foot' ||
        normalizedPoint === 'base'
      ) {
        return [0, -extents[1], 0]
      }
      if (normalizedPoint === 'shaft' || normalizedPoint === 'center') return [0, 0, 0]
      break
    case 'motor_housing':
    case 'radial_blades':
    case 'protective_grill':
      if (
        normalizedPoint === 'front' ||
        normalizedPoint === 'face' ||
        normalizedPoint === 'blade_face' ||
        normalizedPoint === 'grill_face'
      ) {
        return [0, 0, extents[2]]
      }
      if (
        normalizedPoint === 'back' ||
        normalizedPoint === 'rear' ||
        normalizedPoint === 'motor_side' ||
        normalizedPoint === 'mount'
      ) {
        return [0, 0, -extents[2]]
      }
      if (
        normalizedPoint === 'hub' ||
        normalizedPoint === 'shaft' ||
        normalizedPoint === 'center'
      ) {
        return [0, 0, 0]
      }
      break
    case 'pipe_port':
    case 'inlet_port':
    case 'outlet_port':
      if (
        normalizedPoint === 'open' ||
        normalizedPoint === 'mouth' ||
        normalizedPoint === 'port' ||
        normalizedPoint === 'nozzle' ||
        normalizedPoint === 'front' ||
        normalizedPoint === 'outlet' ||
        normalizedPoint === 'inlet'
      ) {
        return axisOffset((length / 2) * sideSign)
      }
      if (normalizedPoint === 'base' || normalizedPoint === 'back' || normalizedPoint === 'rear') {
        return axisOffset((-length / 2) * sideSign)
      }
      break
    case 'pipe_run': {
      const pipeAxis = partAxis(part.axis, 'x')
      const pipeLength = clamp(part.length ?? part.height, 1, 0.08, 8)
      const pipeSideSign = signForSide(side, pipeAxis)
      const pipeAxisOffset = (distance: number) =>
        sub(offsetAlongAxis([0, 0, 0], pipeAxis, distance), [0, 0, 0])
      if (
        normalizedPoint === 'open' ||
        normalizedPoint === 'mouth' ||
        normalizedPoint === 'port' ||
        normalizedPoint === 'nozzle' ||
        normalizedPoint === 'front' ||
        normalizedPoint === 'outlet' ||
        normalizedPoint === 'end' ||
        normalizedPoint === 'right'
      ) {
        return pipeAxisOffset((pipeLength / 2) * pipeSideSign)
      }
      if (
        normalizedPoint === 'base' ||
        normalizedPoint === 'back' ||
        normalizedPoint === 'rear' ||
        normalizedPoint === 'start' ||
        normalizedPoint === 'left' ||
        normalizedPoint === 'inlet'
      ) {
        return pipeAxisOffset((-pipeLength / 2) * pipeSideSign)
      }
      break
    }
    case 'pipe_elbow': {
      const elbowRadius = clamp(part.radius, 0.055, 0.008, 0.45)
      const bendRadius = clamp(
        part.bendRadius ?? part.length ?? part.depth,
        elbowRadius * 4.2,
        elbowRadius * 1.4,
        2,
      )
      if (
        normalizedPoint === 'start' ||
        normalizedPoint === 'inlet' ||
        normalizedPoint === 'left'
      ) {
        return [-bendRadius, 0, 0]
      }
      if (
        normalizedPoint === 'end' ||
        normalizedPoint === 'outlet' ||
        normalizedPoint === 'front' ||
        normalizedPoint === 'open'
      ) {
        return [0, 0, bendRadius]
      }
      break
    }
    case 'desk_top':
      if (
        normalizedPoint === 'leg_mount' ||
        normalizedPoint === 'under' ||
        normalizedPoint === 'underside'
      ) {
        return [0, -extents[1], 0]
      }
      break
    case 'electrical_cabinet':
      if (normalizedPoint === 'front' || normalizedPoint === 'door') return [0, 0, extents[2]]
      if (normalizedPoint === 'cable_entry' || normalizedPoint === 'top') return [0, extents[1], 0]
      if (normalizedPoint === 'bottom' || normalizedPoint === 'base') return [0, -extents[1], 0]
      break
    case 'cable_tray':
      if (normalizedPoint === 'left' || normalizedPoint === 'start') return [-extents[0], 0, 0]
      if (normalizedPoint === 'right' || normalizedPoint === 'end') return [extents[0], 0, 0]
      if (normalizedPoint === 'bottom') return [0, -extents[1], 0]
      break
    case 'flange_ring':
    case 'bolt_pattern':
    case 'seam_ring':
      if (normalizedPoint === 'front' || normalizedPoint === 'face' || normalizedPoint === 'open') {
        return axisOffset(length / 2)
      }
      if (normalizedPoint === 'back' || normalizedPoint === 'rear' || normalizedPoint === 'mount') {
        return axisOffset(-length / 2)
      }
      break
    case 'volute_casing': {
      const r = clamp(part.radius, 0.28, 0.06, 2)
      const depth = clamp(part.depth ?? part.width, r * 0.48, 0.03, 1)
      const outletAngle = clamp(part.outletAngle, Math.atan2(0.34, 0.72), -Math.PI, Math.PI)
      if (
        normalizedPoint === 'inlet' ||
        normalizedPoint === 'suction' ||
        normalizedPoint === 'front'
      ) {
        return [0, 0, depth * 0.54]
      }
      if (normalizedPoint === 'outlet' || normalizedPoint === 'discharge') {
        return [Math.cos(outletAngle) * r * 1.06, Math.sin(outletAngle) * r * 1.06, 0]
      }
      break
    }
    case 'ribbed_motor_body':
    case 'gearbox_body': {
      const motorAxis = partAxis(part.axis, 'x')
      const bodyLength = clamp(
        part.length ?? part.depth,
        kind === 'gearbox_body' ? 0.46 : 0.48,
        0.12,
        3,
      )
      if (
        normalizedPoint === 'shaft' ||
        normalizedPoint === 'output' ||
        normalizedPoint === 'front'
      ) {
        return sub(offsetAlongAxis([0, 0, 0], motorAxis, bodyLength * 0.72), [0, 0, 0])
      }
      if (normalizedPoint === 'input' || normalizedPoint === 'back' || normalizedPoint === 'rear') {
        return sub(offsetAlongAxis([0, 0, 0], motorAxis, -bodyLength * 0.62), [0, 0, 0])
      }
      break
    }
    case 'valve_body':
      if (normalizedPoint === 'inlet' || normalizedPoint === 'left') return axisOffset(-length / 2)
      if (normalizedPoint === 'outlet' || normalizedPoint === 'right') return axisOffset(length / 2)
      if (normalizedPoint === 'stem' || normalizedPoint === 'top') return [0, radius * 1.8, 0]
      break
    case 'cylindrical_tank':
    case 'heat_exchanger': {
      const vesselAxis = partAxis(part.axis, 'x')
      const vesselLength = clamp(
        part.length ?? part.height,
        kind === 'heat_exchanger' ? 1 : 0.9,
        0.1,
        6,
      )
      const vesselRadius = clamp(part.radius, 0.2, 0.04, 2)
      if (normalizedPoint === 'left' || normalizedPoint === 'inlet') {
        return sub(offsetAlongAxis([0, 0, 0], vesselAxis, -vesselLength / 2), [0, 0, 0])
      }
      if (normalizedPoint === 'right' || normalizedPoint === 'outlet') {
        return sub(offsetAlongAxis([0, 0, 0], vesselAxis, vesselLength / 2), [0, 0, 0])
      }
      if (normalizedPoint === 'top' || normalizedPoint === 'nozzle') return [0, vesselRadius, 0]
      break
    }
  }

  return anchorOffset(point, extents)
}

function alignAbovePosition(
  parent: PartComposePartInput,
  parentKind: PartComposeKind | null,
  child: PartComposePartInput,
  childKind: PartComposeKind | null,
): Vec3 {
  const parentCenter = partCenter(parent, parentKind)
  const parentExtents = partHalfExtents(parent, parentKind)
  const childExtents = partHalfExtents(child, childKind)
  const gap = clamp(child.relationGap, 0, 0, 2)
  return [
    parentCenter[0],
    parentCenter[1] + parentExtents[1] + childExtents[1] + gap,
    parentCenter[2],
  ]
}

function centeredOnPosition(
  parent: PartComposePartInput,
  parentKind: PartComposeKind | null,
  child: PartComposePartInput,
  childKind: PartComposeKind | null,
): Vec3 {
  const parentCenter = partCenter(parent, parentKind)
  const childCenter = partCenter(child, childKind)
  return [parentCenter[0], childCenter[1], parentCenter[2]]
}

function alignBesidePosition(
  parent: PartComposePartInput,
  parentKind: PartComposeKind | null,
  child: PartComposePartInput,
  childKind: PartComposeKind | null,
): Vec3 {
  const parentCenter = partCenter(parent, parentKind)
  const parentExtents = partHalfExtents(parent, parentKind)
  const childExtents = partHalfExtents(child, childKind)
  const side = partSide(child.side) ?? partSide(child.anchor) ?? 'right'
  const gap = clamp(child.relationGap, 0, 0, 2)
  switch (side) {
    case 'left':
      return [
        parentCenter[0] - parentExtents[0] - childExtents[0] - gap,
        parentCenter[1],
        parentCenter[2],
      ]
    case 'front':
      return [
        parentCenter[0],
        parentCenter[1],
        parentCenter[2] + parentExtents[2] + childExtents[2] + gap,
      ]
    case 'back':
      return [
        parentCenter[0],
        parentCenter[1],
        parentCenter[2] - parentExtents[2] - childExtents[2] - gap,
      ]
    case 'top':
      return alignAbovePosition(parent, parentKind, child, childKind)
    case 'bottom':
      return [
        parentCenter[0],
        parentCenter[1] - parentExtents[1] - childExtents[1] - gap,
        parentCenter[2],
      ]
    default:
      return [
        parentCenter[0] + parentExtents[0] + childExtents[0] + gap,
        parentCenter[1],
        parentCenter[2],
      ]
  }
}

function aroundPosition(
  parent: PartComposePartInput,
  parentKind: PartComposeKind | null,
  child: PartComposePartInput,
  childKind: PartComposeKind | null,
): Vec3 {
  const parentCenter = partCenter(parent, parentKind)
  const parentExtents = partHalfExtents(parent, parentKind)
  const childCenter = partCenter(child, childKind)
  const childExtents = partHalfExtents(child, childKind)
  const gap = clamp(child.relationGap, 0, 0, 2)
  if (child.cornerPattern) {
    const count = clampInt(child.aroundCount ?? child.count, 4, 1, 128)
    const index = clampInt(child.aroundIndex, 0, 0, Math.max(0, count - 1))
    const cornerIndex = index % 4
    const inset = clamp(child.cornerInset, 0, 0, 20)
    const xSign = cornerIndex === 0 || cornerIndex === 3 ? -1 : 1
    const zSign = cornerIndex === 0 || cornerIndex === 1 ? -1 : 1
    return [
      parentCenter[0] + xSign * Math.max(0, parentExtents[0] - childExtents[0] - inset),
      childCenter[1],
      parentCenter[2] + zSign * Math.max(0, parentExtents[2] - childExtents[2] - inset),
    ]
  }
  const radius = clamp(
    child.aroundRadius,
    Math.max(parentExtents[0], parentExtents[2]) + Math.max(childExtents[0], childExtents[2]) + gap,
    0,
    20,
  )
  const count = clampInt(child.aroundCount ?? child.count, 1, 1, 128)
  const index = clampInt(child.aroundIndex, 0, 0, Math.max(0, count - 1))
  const angle =
    typeof child.aroundAngle === 'number' && Number.isFinite(child.aroundAngle)
      ? child.aroundAngle
      : clamp(child.aroundStartAngle, 0, -Math.PI * 2, Math.PI * 2) + (Math.PI * 2 * index) / count
  const axis = partAxis(child.aroundAxis, 'y')
  const cos = Math.cos(angle) * radius
  const sin = Math.sin(angle) * radius

  switch (axis) {
    case 'x':
      return [childCenter[0], parentCenter[1] + cos, parentCenter[2] + sin]
    case 'z':
      return [parentCenter[0] + cos, parentCenter[1] + sin, childCenter[2]]
    default:
      return [parentCenter[0] + cos, childCenter[1], parentCenter[2] + sin]
  }
}

function positionWithArrayOffset(part: PartComposePartInput, position: Vec3): Vec3 {
  const axis = partAxis(part.arrayAxis, 'x')
  const offset = clamp(part.arrayOffset, 0, -50, 50)
  if (offset === 0) return position
  return offsetAlongAxis(position, axis, offset)
}

function expandArrayParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  const expanded: PartComposePartInput[] = []
  for (const part of parts) {
    const count = clampInt(part.array?.count, 1, 1, 128)
    const spacing = clamp(part.array?.spacing, 0, 0, 20)
    if (!part.array || count <= 1 || spacing === 0) {
      expanded.push(part)
      continue
    }
    const axis = partAxis(part.array.axis, 'x')
    const centerOffset = ((count - 1) * spacing) / 2
    const originalId = part.id
    for (let index = 0; index < count; index += 1) {
      expanded.push({
        ...part,
        id: originalId ? `${originalId}_${index + 1}` : undefined,
        // Preserve original id as alias so findParent can resolve references to it
        sourcePartId: part.sourcePartId ?? originalId,
        name: part.name
          ? `${part.name} ${index + 1}`
          : part.partName
            ? `${part.partName} ${index + 1}`
            : undefined,
        partName: part.partName ? `${part.partName} ${index + 1}` : undefined,
        array: undefined,
        arrayAxis: axis,
        arrayOffset: index * spacing - centerOffset,
      })
    }
  }
  return expanded
}

function expandAroundDistributedParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  const expanded: PartComposePartInput[] = []
  for (const part of parts) {
    const kind = normalizedPartKind(part)
    if (kind === 'propeller_blade_set' || kind === 'mixer_blades') {
      expanded.push({
        ...part,
        around: undefined,
        aroundCount: undefined,
        aroundIndex: undefined,
        aroundAngle: undefined,
      })
      continue
    }
    const defaultCount = part.cornerPattern ? 4 : 1
    const count = clampInt(part.aroundCount, defaultCount, 1, 128)
    if (part.around == null || part.aroundIndex != null || count <= 1) {
      expanded.push(part)
      continue
    }
    const originalId = part.id
    for (let index = 0; index < count; index += 1) {
      expanded.push({
        ...part,
        id: originalId ? `${originalId}_${index + 1}` : undefined,
        sourcePartId: part.sourcePartId ?? originalId,
        name: part.name
          ? `${part.name} ${index + 1}`
          : part.partName
            ? `${part.partName} ${index + 1}`
            : undefined,
        partName: part.partName ? `${part.partName} ${index + 1}` : undefined,
        aroundIndex: index,
      })
    }
  }
  return expanded
}

function resolveConnectedParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  const resolved: PartComposePartInput[] = []
  const hasRelationPlacement = (part: PartComposePartInput) =>
    part.connectTo != null ||
    part.alignAbove != null ||
    part.alignBeside != null ||
    part.offsetFrom != null ||
    part.centeredOn != null ||
    part.around != null
  const findParent = (connectTo: string | number | undefined): PartComposePartInput | undefined => {
    if (typeof connectTo === 'number') return resolved[connectTo]
    if (typeof connectTo !== 'string') return undefined
    const normalized = normalizePartKind(connectTo)
    return resolved.find(
      (part) =>
        part.id === connectTo ||
        part.sourcePartId === connectTo ||
        part.name === connectTo ||
        part.kind === connectTo ||
        part.partType === connectTo ||
        (normalized !== null && normalizedPartKind(part) === normalized),
    )
  }

  parts.forEach((part) => {
    const kind = normalizedPartKind(part)
    if (part.position && !hasRelationPlacement(part)) {
      resolved.push({
        ...part,
        position: positionWithArrayOffset(part, part.position),
      })
      return
    }

    const connectionParent = findParent(part.connectTo)
    if (connectionParent) {
      const parentKind = normalizedPartKind(connectionParent)
      const parentCenter = partCenter(connectionParent, parentKind)
      const parentPoint = part.connectPoint ?? part.anchor ?? 'front'
      const childPoint = part.childPoint ?? part.childAnchor ?? 'back'
      resolved.push({
        ...part,
        position: positionWithArrayOffset(
          part,
          add(
            add(parentCenter, connectionPointOffset(connectionParent, parentKind, parentPoint)),
            negate(connectionPointOffset(part, kind, childPoint)),
          ),
        ),
      })
      return
    }

    const aboveParent = findParent(part.alignAbove)
    if (aboveParent) {
      const side = partSide(part.side)
      resolved.push({
        ...part,
        position: positionWithArrayOffset(
          part,
          side === 'bottom'
            ? alignBesidePosition(
                aboveParent,
                normalizedPartKind(aboveParent),
                { ...part, side },
                kind,
              )
            : alignAbovePosition(aboveParent, normalizedPartKind(aboveParent), part, kind),
        ),
      })
      return
    }

    const besideParent = findParent(part.alignBeside)
    if (besideParent) {
      resolved.push({
        ...part,
        position: positionWithArrayOffset(
          part,
          alignBesidePosition(besideParent, normalizedPartKind(besideParent), part, kind),
        ),
      })
      return
    }

    const offsetParent = findParent(part.offsetFrom)
    if (offsetParent) {
      resolved.push({
        ...part,
        side: part.offsetDirection ?? part.side,
        relationGap: (part.relationGap ?? 0) + (part.offsetDistance ?? 0),
        position: positionWithArrayOffset(
          part,
          alignBesidePosition(
            offsetParent,
            normalizedPartKind(offsetParent),
            {
              ...part,
              side: part.offsetDirection ?? part.side,
              relationGap: (part.relationGap ?? 0) + (part.offsetDistance ?? 0),
            },
            kind,
          ),
        ),
      })
      return
    }

    const centerParent = findParent(part.centeredOn)
    if (centerParent) {
      resolved.push({
        ...part,
        position: positionWithArrayOffset(
          part,
          centeredOnPosition(centerParent, normalizedPartKind(centerParent), part, kind),
        ),
      })
      return
    }

    const aroundParent = findParent(part.around)
    if (aroundParent) {
      resolved.push({
        ...part,
        position: positionWithArrayOffset(
          part,
          aroundPosition(aroundParent, normalizedPartKind(aroundParent), part, kind),
        ),
      })
      return
    }

    resolved.push(part)
  })

  return resolved
}

export interface PartRelationshipLayoutInput {
  parts: PartComposePartInput[]
}

export interface BoundingBox {
  min: Vec3
  max: Vec3
  size: Vec3
}

export interface LayoutAnchor {
  id: string
  role: string
  position: Vec3
}

export interface PartPlacement {
  partId: string
  kind: string
  semanticRole?: string
  anchorId?: string
  position: Vec3
}

export interface LayoutPlan {
  family: FamilyId | string
  layoutFamily?: LayoutFamilyId
  anchors: LayoutAnchor[]
  placements: PartPlacement[]
  bounds: BoundingBox
  parts: PartComposePartInput[]
}

export interface LayoutProfileInput {
  family: FamilyId | string
  layoutFamily?: LayoutFamilyId
  primarySemanticRole?: string
}

export interface LayoutDimensions {
  length?: number
  width?: number
  height?: number
  diameter?: number
}

export function resolvePlacedParts(plan: PartRelationshipLayoutInput): PartComposePartInput[] {
  return resolveConnectedParts(expandArrayParts(expandAroundDistributedParts(plan.parts)))
}

function layoutNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function layoutKind(part: PartComposePartInput) {
  return String(part.kind ?? part.partType ?? part.type ?? part.id ?? 'part')
}

function layoutRole(part: PartComposePartInput) {
  return typeof part.semanticRole === 'string' && part.semanticRole.trim()
    ? part.semanticRole.trim()
    : layoutKind(part)
}

function normalizeLayoutAnchor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (normalized === 'center') return 'shell_center'
  return normalized
}

function layoutOffset(value: unknown): Vec3 {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value
    return [
      typeof x === 'number' && Number.isFinite(x) ? x : 0,
      typeof y === 'number' && Number.isFinite(y) ? y : 0,
      typeof z === 'number' && Number.isFinite(z) ? z : 0,
    ]
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [value, 0, 0]
  return [0, 0, 0]
}

function addLayoutOffset(position: Vec3, offset: unknown): Vec3 {
  return add(position, layoutOffset(offset))
}

function arrayAlongAxis(value: unknown): PartAxis | undefined {
  const normalized = normalizeLayoutAnchor(value)
  if (normalized === 'x' || normalized === 'length') return 'x'
  if (normalized === 'y' || normalized === 'height' || normalized === 'vertical') return 'y'
  if (normalized === 'z' || normalized === 'width' || normalized === 'depth') return 'z'
  return undefined
}

function layoutAxisSize(axis: PartAxis, dimensions: Required<LayoutDimensions>) {
  if (axis === 'x') return dimensions.length
  if (axis === 'y') return dimensions.height
  return dimensions.width
}

function distributeArrayAlong(
  part: PartComposePartInput,
  position: Vec3,
  dimensions: Required<LayoutDimensions>,
) {
  const axis = arrayAlongAxis(part.arrayAlong)
  const count = axis ? clampInt(part.count, 1, 1, 64) : 1
  if (!axis || count <= 1) return [{ part, position }]
  const spacing = clamp(
    part.array?.spacing ?? part.arrayOffset,
    (layoutAxisSize(axis, dimensions) * 0.72) / Math.max(1, count - 1),
    0.02,
    100,
  )
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  return Array.from({ length: count }, (_, index) => {
    const nextPosition: Vec3 = [...position]
    nextPosition[axisIndex] += (index - (count - 1) / 2) * spacing
    return {
      part: {
        ...part,
        id: part.id ? `${part.id}_${index + 1}` : undefined,
        sourcePartId: part.sourcePartId ? `${part.sourcePartId}_${index + 1}` : undefined,
        count: undefined,
        arrayAlong: undefined,
        arrayOffset: undefined,
      },
      position: nextPosition,
    }
  })
}

function inferLayoutFamily(profile: LayoutProfileInput): LayoutFamilyId | undefined {
  if (profile.layoutFamily) return profile.layoutFamily
  switch (profile.family) {
    case 'pump':
    case 'compressor':
    case 'fan':
    case 'fluid_machine':
      return 'rotating_machine_layout'
    case 'tank':
    case 'reactor':
    case 'process_equipment':
    case 'heat_exchanger':
      return 'vessel_layout'
    case 'conveyor':
    case 'grate_cooler':
    case 'material_handling':
      return 'linear_transport_layout'
    case 'machine_tool':
    case 'electrical':
    case 'kiosk':
    case 'forming_machine':
      return 'box_enclosure_layout'
    default:
      return undefined
  }
}

function anchorForRole(layoutFamily: LayoutFamilyId | undefined, role: string) {
  const normalized = role.toLowerCase()
  if (layoutFamily === 'rotating_machine_layout') {
    if (/base|skid|support/.test(normalized)) return 'base'
    if (/motor|drive/.test(normalized)) return 'drive'
    if (/casing|volute|body|compressor/.test(normalized)) return 'process_body'
    if (/inlet|suction/.test(normalized)) return 'inlet'
    if (/outlet|discharge/.test(normalized)) return 'outlet'
  }
  if (layoutFamily === 'vessel_layout') {
    if (/shell|vessel|tank|reactor|body/.test(normalized)) return 'shell'
    if (/support|base|skid/.test(normalized)) return 'support'
    if (/top|inlet|feed|manway/.test(normalized)) return 'top_nozzle'
    if (/drain|outlet|discharge/.test(normalized)) return 'side_nozzle'
    if (/ladder|platform|access/.test(normalized)) return 'access'
  }
  if (layoutFamily === 'linear_transport_layout') {
    if (/frame|support|leg/.test(normalized)) return 'frame'
    if (/roller|flight|slat/.test(normalized)) return 'repeaters'
    if (/belt|surface|trough|cover/.test(normalized)) return 'surface'
    if (/motor|drive/.test(normalized)) return 'drive'
  }
  if (layoutFamily === 'box_enclosure_layout' || layoutFamily === 'generic_industrial_layout') {
    if (/base|skid|foot/.test(normalized)) return 'base'
    if (/body|enclosure|cabinet|chamber|frame/.test(normalized)) return 'body'
    if (/control|display|screen/.test(normalized)) return 'controls'
    if (/panel|door|window|opening|plate/.test(normalized)) return 'front_panel'
    if (/vent|label|nameplate|warning/.test(normalized)) return 'details'
  }
  return 'body'
}

function layoutAnchors(
  layoutFamily: LayoutFamilyId | undefined,
  dimensions: Required<LayoutDimensions>,
) {
  const length = dimensions.length
  const width = dimensions.width
  const height = dimensions.height
  const internal: LayoutAnchor[] = [
    { id: 'shell_center', role: 'shell_center', position: [0, height * 0.52, 0] },
    { id: 'top', role: 'top', position: [0, height, 0] },
    { id: 'bottom', role: 'bottom', position: [0, 0, 0] },
    { id: 'front', role: 'front', position: [0, height * 0.52, width * 0.52] },
    { id: 'back', role: 'back', position: [0, height * 0.52, -width * 0.52] },
    { id: 'left', role: 'left', position: [-length * 0.52, height * 0.52, 0] },
    { id: 'right', role: 'right', position: [length * 0.52, height * 0.52, 0] },
    { id: 'drive_side', role: 'drive_side', position: [-length * 0.42, height * 0.42, 0] },
    { id: 'service_side', role: 'service_side', position: [0, height * 0.55, width * 0.58] },
  ]
  const rotating: LayoutAnchor[] = [
    { id: 'base', role: 'support_base', position: [0, height * 0.08, 0] },
    { id: 'drive', role: 'drive_motor', position: [-length * 0.28, height * 0.42, 0] },
    { id: 'process_body', role: 'main_casing', position: [length * 0.18, height * 0.42, 0] },
    { id: 'inlet', role: 'inlet_port', position: [length * 0.35, height * 0.42, width * 0.45] },
    { id: 'outlet', role: 'outlet_port', position: [length * 0.22, height * 0.68, 0] },
    { id: 'shell_center', role: 'shell_center', position: [0, height * 0.48, 0] },
    { id: 'drive_side', role: 'drive_side', position: [-length * 0.42, height * 0.36, 0] },
    {
      id: 'service_side',
      role: 'service_side',
      position: [length * 0.18, height * 0.72, width * 0.55],
    },
  ]
  const vessel: LayoutAnchor[] = [
    { id: 'shell', role: 'vessel_shell', position: [0, height * 0.52, 0] },
    { id: 'shell_center', role: 'shell_center', position: [0, height * 0.52, 0] },
    { id: 'support', role: 'support_base', position: [0, height * 0.08, 0] },
    { id: 'top_nozzle', role: 'top_nozzle', position: [0, height * 1.03, 0] },
    { id: 'side_nozzle', role: 'side_nozzle', position: [0, height * 0.48, width * 0.56] },
    {
      id: 'access',
      role: 'access_platform',
      position: [-length * 0.44, height * 0.5, width * 0.52],
    },
    { id: 'drive_side', role: 'drive_side', position: [-length * 0.45, height * 0.22, 0] },
    {
      id: 'service_side',
      role: 'service_side',
      position: [-length * 0.44, height * 0.5, width * 0.52],
    },
  ]
  const linear: LayoutAnchor[] = [
    { id: 'frame', role: 'transport_frame', position: [0, height * 0.42, 0] },
    { id: 'repeaters', role: 'repeating_elements', position: [0, height * 0.7, 0] },
    { id: 'surface', role: 'transport_surface', position: [0, height * 0.75, 0] },
    { id: 'drive', role: 'drive_motor', position: [-length * 0.44, height * 0.42, 0] },
    { id: 'shell_center', role: 'shell_center', position: [0, height * 0.48, 0] },
    { id: 'drive_side', role: 'drive_side', position: [-length * 0.48, height * 0.42, 0] },
    { id: 'service_side', role: 'service_side', position: [0, height * 0.68, width * 0.55] },
  ]
  const box: LayoutAnchor[] = [
    { id: 'base', role: 'support_base', position: [0, height * 0.06, 0] },
    { id: 'body', role: 'enclosure_body', position: [0, height * 0.52, 0] },
    { id: 'shell_center', role: 'shell_center', position: [0, height * 0.52, 0] },
    { id: 'front_panel', role: 'front_panel', position: [0, height * 0.55, width * 0.51] },
    {
      id: 'controls',
      role: 'control_panel',
      position: [length * 0.32, height * 0.58, width * 0.53],
    },
    {
      id: 'details',
      role: 'detail_elements',
      position: [-length * 0.3, height * 0.68, width * 0.53],
    },
    { id: 'drive_side', role: 'drive_side', position: [-length * 0.46, height * 0.38, 0] },
    {
      id: 'service_side',
      role: 'service_side',
      position: [length * 0.46, height * 0.58, width * 0.52],
    },
  ]
  const mergeInternal = (anchors: LayoutAnchor[]) => {
    const ids = new Set(anchors.map((anchor) => anchor.id))
    return [...anchors, ...internal.filter((anchor) => !ids.has(anchor.id))]
  }
  switch (layoutFamily) {
    case 'rotating_machine_layout':
      return mergeInternal(rotating)
    case 'vessel_layout':
      return mergeInternal(vessel)
    case 'linear_transport_layout':
      return mergeInternal(linear)
    case 'box_enclosure_layout':
    case 'generic_industrial_layout':
      return mergeInternal(box)
    default:
      return mergeInternal(box)
  }
}

function sideAnchorForPart(part: PartComposePartInput) {
  return normalizeLayoutAnchor(part.anchor) ?? normalizeLayoutAnchor(part.side)
}

function roleKey(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
}

function attachRolePosition(
  part: PartComposePartInput,
  parent: PartPlacement | undefined,
  parentPart: PartComposePartInput | undefined,
  dimensions: Required<LayoutDimensions>,
): Vec3 | undefined {
  if (!parent || !parentPart) return undefined
  const anchor = sideAnchorForPart(part) ?? 'shell_center'
  const parentExtents = partHalfExtents(parentPart, normalizedPartKind(parentPart))
  const childExtents = partHalfExtents(part, normalizedPartKind(part))
  const center = parent.position
  const along = (axis: PartAxis, sign: 1 | -1) => {
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const next: Vec3 = [...center]
    next[index] += sign * (parentExtents[index] + childExtents[index] * 0.5)
    return next
  }
  switch (anchor) {
    case 'top':
      return along('y', 1)
    case 'bottom':
      return along('y', -1)
    case 'front':
      return along('z', 1)
    case 'back':
      return along('z', -1)
    case 'left':
      return along('x', -1)
    case 'right':
      return along('x', 1)
    case 'drive_side':
      return [center[0] - dimensions.length * 0.36, center[1], center[2]]
    case 'service_side':
      return [center[0], center[1], center[2] + dimensions.width * 0.58]
    default:
      return center
  }
}

function resolveLayoutPlan(
  profile: LayoutProfileInput,
  parts: readonly PartComposePartInput[],
  dimensions: LayoutDimensions = {},
): LayoutPlan {
  const resolvedDimensions: Required<LayoutDimensions> = {
    length: layoutNumber(dimensions.length, layoutNumber(dimensions.diameter, 1.6)),
    width: layoutNumber(dimensions.width, layoutNumber(dimensions.diameter, 0.8)),
    height: layoutNumber(dimensions.height, 1.1),
    diameter: layoutNumber(dimensions.diameter, layoutNumber(dimensions.width, 0.8)),
  }
  const layoutFamily = inferLayoutFamily(profile)
  const anchors = layoutAnchors(layoutFamily, resolvedDimensions)
  const anchorMap = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const placements: PartPlacement[] = []
  const placedParts: PartComposePartInput[] = []
  const rolePlacements = new Map<string, { placement: PartPlacement; part: PartComposePartInput }>()
  const registerPlacement = (
    part: PartComposePartInput,
    index: number,
    anchorId: string,
    position: Vec3,
  ) => {
    const role = layoutRole(part)
    const placement: PartPlacement = {
      partId: String(part.id ?? `${layoutKind(part)}-${index + 1}`),
      kind: layoutKind(part),
      semanticRole: role,
      anchorId,
      position,
    }
    placements.push(placement)
    placedParts.push({ ...part, position })
    const semanticKey = roleKey(role)
    if (semanticKey && !rolePlacements.has(semanticKey))
      rolePlacements.set(semanticKey, { placement, part })
    const kindKey = roleKey(layoutKind(part))
    if (kindKey && !rolePlacements.has(kindKey)) rolePlacements.set(kindKey, { placement, part })
  }
  parts.forEach((part, index) => {
    const role = layoutRole(part)
    const explicitAnchorId = sideAnchorForPart(part)
    const anchorId =
      explicitAnchorId && anchorMap.has(explicitAnchorId)
        ? explicitAnchorId
        : anchorForRole(layoutFamily, role)
    const anchor = anchorMap.get(anchorId) ?? anchors[0]
    const explicitPosition = Array.isArray(part.position) ? (part.position as Vec3) : undefined
    const attachKey = roleKey(part.attachToRole)
    const attached = attachKey ? rolePlacements.get(attachKey) : undefined
    const attachedPosition = attachRolePosition(
      part,
      attached?.placement,
      attached?.part,
      resolvedDimensions,
    )
    const basePosition = addLayoutOffset(
      explicitPosition ??
        attachedPosition ??
        anchor?.position ?? [0, resolvedDimensions.height / 2, 0],
      part.offset,
    )
    for (const expanded of distributeArrayAlong(part, basePosition, resolvedDimensions)) {
      registerPlacement(expanded.part, placedParts.length, anchorId, expanded.position)
    }
  })
  return {
    family: profile.family,
    layoutFamily,
    anchors,
    placements,
    bounds: {
      min: [-resolvedDimensions.length / 2, 0, -resolvedDimensions.width / 2],
      max: [resolvedDimensions.length / 2, resolvedDimensions.height, resolvedDimensions.width / 2],
      size: [resolvedDimensions.length, resolvedDimensions.height, resolvedDimensions.width],
    },
    parts: placedParts,
  }
}

export function resolveLayout(plan: PartRelationshipLayoutInput): PartComposePartInput[]
export function resolveLayout(
  profile: LayoutProfileInput,
  parts: readonly PartComposePartInput[],
  dimensions?: LayoutDimensions,
): LayoutPlan
export function resolveLayout(
  first: PartRelationshipLayoutInput | LayoutProfileInput,
  parts?: readonly PartComposePartInput[],
  dimensions?: LayoutDimensions,
): PartComposePartInput[] | LayoutPlan {
  if (Array.isArray(parts)) return resolveLayoutPlan(first as LayoutProfileInput, parts, dimensions)
  return resolvePlacedParts(first as PartRelationshipLayoutInput)
}

function familySpecForParts(present: PartComposeKind[]): PartFamilySpec {
  const has = (kind: PartComposeKind) => present.includes(kind)
  const group = (
    label: string,
    anyOf: PartComposeKind[],
    defaultPart: PartComposePartInput,
  ): PartRequirementGroup => ({ label, anyOf, defaultPart })

  if (has('desk_top') || has('leg_set') || has('drawer_stack')) {
    return {
      family: 'desk',
      required: [
        group('desktop', ['desk_top'], { kind: 'desk_top' }),
        group('legs/supports', ['leg_set', 'drawer_stack'], { kind: 'leg_set' }),
      ],
      optional: ['drawer_stack'],
      recommendedDetails: [group('drawer stack', ['drawer_stack'], { kind: 'drawer_stack' })],
    }
  }

  if (has('electrical_cabinet') || has('cable_tray')) {
    return {
      family: 'electrical',
      required: [group('cabinet', ['electrical_cabinet'], { kind: 'electrical_cabinet' })],
      optional: ['cable_tray', 'nameplate', 'warning_label', 'vent_slats'],
      recommendedDetails: [
        group('cable tray', ['cable_tray'], {
          kind: 'cable_tray',
          position: [0, 1.08, -0.32],
          length: 1.1,
        }),
        group('nameplate', ['nameplate'], {
          kind: 'nameplate',
          position: [-0.12, 0.36, 0.13],
          length: 0.16,
          width: 0.05,
        }),
        group('warning label', ['warning_label'], {
          kind: 'warning_label',
          position: [-0.12, 0.7, 0.13],
          length: 0.13,
          width: 0.06,
        }),
      ],
    }
  }

  if (has('pipe_run') || has('pipe_elbow')) {
    return {
      family: 'pipe_system',
      required: [group('straight pipe run', ['pipe_run'], { kind: 'pipe_run' })],
      optional: ['pipe_elbow', 'flange_ring', 'valve_body'],
      recommendedDetails: [
        group('elbow/bend', ['pipe_elbow'], {
          kind: 'pipe_elbow',
          position: [0.55, 0.55, 0],
          radius: 0.055,
        }),
        group('flange', ['flange_ring'], {
          kind: 'flange_ring',
          connectTo: 'pipe_run',
          connectPoint: 'open',
          childPoint: 'back',
          axis: 'x',
          radius: 0.09,
        }),
      ],
    }
  }

  if (has('volute_casing') || has('impeller_blades') || has('inlet_port') || has('outlet_port')) {
    return {
      family: 'pump',
      required: [
        group('base/skid', ['skid_base'], { kind: 'skid_base' }),
        group('motor/body', ['ribbed_motor_body', 'rounded_machine_body', 'motor_housing'], {
          kind: 'ribbed_motor_body',
          position: [-0.28, 0.42, 0],
          length: 0.48,
        }),
        group('volute casing', ['volute_casing'], { kind: 'volute_casing' }),
        group('inlet port', ['inlet_port'], {
          kind: 'inlet_port',
          position: [0.22, 0.55, 0.4],
          axis: 'z',
          radius: 0.07,
        }),
        group('outlet port', ['outlet_port'], {
          kind: 'outlet_port',
          position: [0.47, 0.62, 0.12],
          axis: 'x',
          radius: 0.06,
        }),
        group('flange', ['flange_ring'], {
          kind: 'flange_ring',
          position: [0.22, 0.55, 0.54],
          axis: 'z',
          radius: 0.12,
        }),
      ],
      optional: ['impeller_blades', 'control_box', 'vent_slats', 'bolt_pattern'],
      recommendedDetails: [
        group('impeller', ['impeller_blades'], {
          kind: 'impeller_blades',
          position: [0.22, 0.55, 0.24],
          count: 7,
          radius: 0.14,
        }),
        group('nameplate', ['nameplate'], { kind: 'nameplate', position: [-0.28, 0.5, 0.19] }),
        group('warning label', ['warning_label'], {
          kind: 'warning_label',
          position: [0.04, 0.62, 0.22],
        }),
      ],
    }
  }

  if (has('mixer_blades') || has('propeller_blade_set')) {
    return {
      family: 'unknown',
      required: [],
      optional: [],
      recommendedDetails: [],
    }
  }

  if (has('fan_blade') || has('radial_blades') || has('protective_grill')) {
    return {
      family: 'fan',
      required: [
        group('base', ['circular_base'], { kind: 'circular_base' }),
        group('pole', ['vertical_pole'], { kind: 'vertical_pole' }),
        group('support bracket', ['support_bracket'], { kind: 'support_bracket' }),
        group('motor housing', ['motor_housing'], { kind: 'motor_housing' }),
        group('editable fan blades', ['fan_blade', 'radial_blades'], {
          kind: 'fan_blade',
          count: 3,
        }),
        group('protective grill', ['protective_grill'], { kind: 'protective_grill' }),
      ],
      optional: ['control_knob'],
      recommendedDetails: [group('control knob', ['control_knob'], { kind: 'control_knob' })],
    }
  }

  if (has('conveyor_frame') || has('roller_array') || has('belt_surface')) {
    return {
      family: 'conveyor',
      required: [
        group('frame', ['conveyor_frame'], { kind: 'conveyor_frame' }),
        group('rollers', ['roller_array'], { kind: 'roller_array' }),
        group('belt', ['belt_surface'], { kind: 'belt_surface' }),
      ],
      optional: ['ribbed_motor_body', 'gearbox_body', 'warning_label'],
      recommendedDetails: [
        group('drive motor', ['ribbed_motor_body'], {
          kind: 'ribbed_motor_body',
          position: [0.72, 0.5, 0.36],
          radius: 0.08,
          length: 0.24,
        }),
        group('warning label', ['warning_label'], {
          kind: 'warning_label',
          position: [0, 0.6, 0.24],
        }),
      ],
    }
  }

  if (
    has('tube_frame') ||
    has('chain_loop') ||
    (has('wheel_set') && (has('handlebar') || has('saddle') || has('fork')))
  ) {
    return {
      family: 'bicycle',
      required: [
        group('wheels', ['wheel_set', 'wheel'], {
          kind: 'wheel_set',
          count: 2,
          semanticRole: 'bicycle_tire',
        }),
        group('frame', ['tube_frame'], { kind: 'tube_frame', semanticRole: 'bicycle_frame' }),
        group('fork', ['fork'], { kind: 'fork', semanticRole: 'bicycle_fork' }),
        group('handlebar', ['handlebar'], { kind: 'handlebar' }),
        group('saddle', ['saddle'], { kind: 'saddle' }),
        group('chain', ['chain_loop'], { kind: 'chain_loop' }),
      ],
      optional: [],
      recommendedDetails: [],
    }
  }

  if (
    has('aircraft_fuselage') ||
    has('aircraft_wing') ||
    has('aircraft_engine') ||
    has('aircraft_vertical_stabilizer') ||
    has('aircraft_horizontal_stabilizer') ||
    has('aircraft_landing_gear')
  ) {
    return {
      family: 'aircraft',
      required: [
        group('fuselage', ['aircraft_fuselage', 'streamlined_body'], {
          kind: 'aircraft_fuselage',
          id: 'fuselage',
        }),
        group('main wings', ['aircraft_wing', 'lofted_panel', 'airfoil_blade'], {
          kind: 'aircraft_wing',
          id: 'main-wings',
        }),
        group('aft engines', ['aircraft_engine'], { kind: 'aircraft_engine', id: 'engines' }),
        group('vertical stabilizer', ['aircraft_vertical_stabilizer'], {
          kind: 'aircraft_vertical_stabilizer',
          id: 'vertical-stabilizer',
        }),
        group('horizontal stabilizer', ['aircraft_horizontal_stabilizer'], {
          kind: 'aircraft_horizontal_stabilizer',
          id: 'horizontal-stabilizer',
        }),
        group('landing gear', ['aircraft_landing_gear'], {
          kind: 'aircraft_landing_gear',
          id: 'landing-gear',
        }),
      ],
      optional: ['window_strip', 'window_panel'],
      recommendedDetails: [],
    }
  }

  if (
    has('body_shell') ||
    (has('wheel_set') && (has('window_strip') || has('light_pair') || has('bar_pair')))
  ) {
    return {
      family: 'vehicle',
      required: [
        group('body', ['body_shell'], { kind: 'body_shell', semanticRole: 'vehicle_body' }),
        group('wheels', ['wheel_set'], {
          kind: 'wheel_set',
          count: 4,
          semanticRole: 'vehicle_tire',
        }),
        group('windows', ['window_strip'], {
          kind: 'window_strip',
          semanticRole: 'vehicle_window',
          variant: 'vehicle_glasshouse',
        }),
        group('lights', ['light_pair'], { kind: 'light_pair', semanticRole: 'headlight' }),
        group('bumper', ['bar_pair'], { kind: 'bar_pair' }),
      ],
      optional: ['seam_ring', 'nameplate'],
      recommendedDetails: [
        group('panel seam', ['seam_ring'], { kind: 'seam_ring', axis: 'x', radius: 0.18 }),
      ],
    }
  }

  if (has('valve_body') || has('handwheel')) {
    return {
      family: 'valve',
      required: [
        group('valve body', ['valve_body'], { kind: 'valve_body' }),
        group('handwheel', ['handwheel'], {
          kind: 'handwheel',
          connectTo: 'valve_body',
          connectPoint: 'stem',
          childPoint: 'center',
        }),
      ],
      optional: ['flange_ring', 'bolt_pattern'],
      recommendedDetails: [
        group('flanged ends', ['flange_ring'], { kind: 'flange_ring', radius: 0.12 }),
      ],
    }
  }

  return { family: 'unknown', required: [], optional: [], recommendedDetails: [] }
}

function partKinds(parts: PartComposePartInput[]): PartComposeKind[] {
  return Array.from(
    new Set(parts.map((part) => normalizedPartKind(part)).filter(Boolean)),
  ) as PartComposeKind[]
}

const singletonBlueprintParts = new Set<PartComposeKind>([
  'wheel_set',
  'tube_frame',
  'fork',
  'handlebar',
  'saddle',
  'chain_loop',
  'body_shell',
  'window_strip',
  'light_pair',
  'bar_pair',
])

function dedupeSingletonBlueprintParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  const seen = new Set<PartComposeKind>()
  return parts.filter((part) => {
    const kind = normalizedPartKind(part)
    if (!kind || !singletonBlueprintParts.has(kind)) return true
    if (seen.has(kind)) return false
    seen.add(kind)
    return true
  })
}

function hasAnyPart(present: PartComposeKind[], group: PartRequirementGroup): boolean {
  return group.anyOf.some((kind) => present.includes(kind))
}

const aircraftRequiredPartKinds: PartComposeKind[] = [
  'aircraft_fuselage',
  'aircraft_wing',
  'aircraft_engine',
  'aircraft_vertical_stabilizer',
  'aircraft_horizontal_stabilizer',
  'aircraft_landing_gear',
]

function isAircraftPartKind(kind: PartComposeKind): boolean {
  return (
    aircraftRequiredPartKinds.includes(kind) ||
    kind === 'streamlined_body' ||
    kind === 'lofted_panel' ||
    kind === 'airfoil_blade'
  )
}

function aircraftDefaultParts(input: PartComposeInput): PartComposePartInput[] {
  const dimensions = partInputDimensions(input)
  const fuselageLength = clamp(dimensions.length ?? dimensions.depth, 1.12, 0.4, 20)
  const scale = fuselageLength / 1.12
  const fuselageWidth = clamp(dimensions.width ?? dimensions.diameter, 0.13 * scale, 0.04, 3)
  const fuselageHeight = clamp(dimensions.height, 0.145 * scale, 0.04, 3)
  const gearRadius = clamp(undefined, 0.035 * scale, 0.012, 0.2)
  const engineRadius = clamp(undefined, 0.032 * scale, 0.018, 0.34)
  const verticalTailHeight = clamp(undefined, 0.21 * scale, 0.04, 1.15)
  const fuselageCenterY = gearRadius * 3.8 + fuselageHeight * 0.6
  const wingY = fuselageCenterY - fuselageHeight * 0.18
  const engineY = wingY - Math.max(engineRadius * 1.1, fuselageHeight * 0.22)
  const verticalTailY = fuselageCenterY + fuselageHeight * 0.48
  const horizontalTailY = verticalTailY + verticalTailHeight * 0.46
  const gearY = gearRadius * 1.08

  return [
    {
      kind: 'aircraft_fuselage',
      id: 'fuselage',
      name: 'Boeing 717 fuselage',
      position: [0, fuselageCenterY, 0],
      length: fuselageLength,
      width: fuselageWidth,
      height: fuselageHeight,
      primaryColor: input.primaryColor ?? '#f8fafc',
      accentColor: input.accentColor ?? '#0f8fb3',
      noseRoundness: 0.42,
      count: 14,
    },
    {
      kind: 'aircraft_wing',
      id: 'main-wings',
      name: 'low mounted swept wings',
      position: [0.02 * scale, wingY, 0],
      length: 0.95 * scale,
      width: 0.14 * scale,
      thickness: 0.009 * scale,
      bladeSweep: 0.18,
    },
    {
      kind: 'aircraft_engine',
      id: 'underwing-engines',
      name: 'underwing turbofan engines',
      position: [0.08 * scale, engineY, 0],
      length: 0.16 * scale,
      radius: engineRadius,
      width: 0.36 * scale,
    },
    {
      kind: 'aircraft_vertical_stabilizer',
      id: 'vertical-stabilizer',
      name: 'swept vertical fin',
      position: [-0.48 * scale, verticalTailY, 0],
      length: 0.18 * scale,
      height: verticalTailHeight,
      width: 0.018 * scale,
    },
    {
      kind: 'aircraft_horizontal_stabilizer',
      id: 't-tail',
      name: 'T-tail horizontal stabilizer',
      position: [-0.53 * scale, horizontalTailY, 0],
      length: 0.3 * scale,
      width: 0.07 * scale,
      thickness: 0.008 * scale,
    },
    {
      kind: 'aircraft_landing_gear',
      id: 'landing-gear',
      name: 'tricycle landing gear',
      position: [0.02 * scale, gearY, 0],
      length: 0.62 * scale,
      width: 0.32 * scale,
      radius: gearRadius,
    },
  ]
}

function requestedDetails(input: PartComposeInput): boolean {
  const text = `${input.name ?? ''}`.toLowerCase()
  return /(detail|detailed|realistic|真实|细节|精细|铭牌|警示|螺栓|接缝|散热|label|nameplate|warning|bolt|seam)/i.test(
    text,
  )
}

function isAircraftIntent(input: PartComposeInput): boolean {
  const text = [
    input.name,
    input.partName,
    input.geometryBrief,
    ...(input.parts ?? []).map(partIdentityText),
  ]
    .map(textOf)
    .join(' ')
    .toLowerCase()
  return /aircraft|airplane|airliner|plane|jet|boeing|airbus|fuselage|wing|t-tail|飞机|客机|波音|空客|机翼|机身/.test(
    text,
  )
}

export function assessPartVisualDetails(input: PartComposeInput = {}): PartVisualAssessment {
  const present = partKinds(input.parts ?? [])
  const blueprint = assessPartBlueprint(input)
  const detailSet = new Set<PartComposeKind>([
    ...blueprint.recommendedDetails,
    'nameplate',
    'warning_label',
    'seam_ring',
    'bolt_pattern',
    'vent_slats',
  ])

  const familySpecific: Partial<Record<PartBlueprintAssessment['family'], PartComposeKind[]>> = {
    pump: ['impeller_blades', 'nameplate', 'warning_label', 'flange_ring'],
    fan: ['control_knob', 'protective_grill'],
    conveyor: ['ribbed_motor_body', 'warning_label'],
    vehicle: ['window_strip', 'light_pair', 'bar_pair', 'seam_ring'],
    valve: ['flange_ring', 'handwheel'],
    bicycle: ['chain_loop'],
    desk: ['drawer_stack'],
    pipe_system: ['pipe_elbow', 'flange_ring', 'valve_body'],
    electrical: ['cable_tray', 'nameplate', 'warning_label', 'vent_slats'],
    aircraft: [
      'aircraft_fuselage',
      'aircraft_wing',
      'aircraft_engine',
      'aircraft_vertical_stabilizer',
      'aircraft_horizontal_stabilizer',
      'aircraft_landing_gear',
    ],
  }

  for (const kind of familySpecific[blueprint.family] ?? []) detailSet.add(kind)

  const expected = Array.from(detailSet)
  const missingDetails = expected.filter((kind) => !present.includes(kind))
  const presentDetails = expected.filter((kind) => present.includes(kind))
  const score =
    expected.length === 0 ? 1 : Number((presentDetails.length / expected.length).toFixed(4))
  return {
    family: blueprint.family,
    score,
    presentDetails,
    missingDetails,
    recommendations: missingDetails.map((kind) => `Add visual detail ${kind}.`),
  }
}

function enhancePartBlueprintWithVisualDetails(
  parts: PartComposePartInput[],
  input: PartComposeInput,
): PartComposePartInput[] {
  if (isRegistryPartPlanInput(input)) return parts
  if (input.autoComplete === false) return parts
  if (input.enhanceVisualDetails === false) return parts
  const shouldEnhance = input.enhanceVisualDetails === true || requestedDetails(input)
  if (!shouldEnhance) return parts

  const completed = [...parts]
  const present = () => partKinds(completed)
  const has = (kind: PartComposeKind) => present().includes(kind)
  const addIfMissing = (part: PartComposePartInput) => {
    const kind = normalizedPartKind(part)
    if (kind && !has(kind)) completed.push(part)
  }
  const spec = familySpecForParts(present())
  if (spec.family === 'vehicle' && isAircraftIntent(input)) return parts

  switch (spec.family) {
    case 'pump':
      addIfMissing({
        kind: 'impeller_blades',
        position: [0.22, 0.55, 0.24],
        count: 7,
        radius: 0.14,
      })
      addIfMissing({ kind: 'nameplate', position: [-0.28, 0.5, 0.19] })
      addIfMissing({ kind: 'warning_label', position: [0.04, 0.62, 0.22] })
      break
    case 'fan':
      addIfMissing({ kind: 'control_knob' })
      break
    case 'conveyor':
      addIfMissing({
        kind: 'ribbed_motor_body',
        position: [0.72, 0.5, 0.36],
        radius: 0.08,
        length: 0.24,
      })
      addIfMissing({ kind: 'warning_label', position: [0, 0.6, 0.24] })
      break
    case 'vehicle':
      addIfMissing({ kind: 'seam_ring', axis: 'x', radius: 0.18 })
      addIfMissing({ kind: 'nameplate', position: [-0.42, 0.36, 0.28], length: 0.12, width: 0.05 })
      break
    case 'valve':
      addIfMissing({
        kind: 'flange_ring',
        connectTo: 'valve_body',
        connectPoint: 'inlet',
        childPoint: 'back',
        axis: 'x',
        radius: 0.12,
      })
      break
    case 'desk':
      addIfMissing({ kind: 'drawer_stack' })
      break
    case 'pipe_system':
      addIfMissing({ kind: 'pipe_elbow', position: [0.55, 0.55, 0], radius: 0.055 })
      addIfMissing({
        kind: 'flange_ring',
        connectTo: 'pipe_run',
        connectPoint: 'open',
        childPoint: 'back',
        axis: 'x',
        radius: 0.09,
      })
      break
    case 'electrical':
      addIfMissing({ kind: 'cable_tray', position: [0, 1.08, -0.32], length: 1.1 })
      addIfMissing({ kind: 'nameplate', position: [-0.12, 0.36, 0.13], length: 0.16, width: 0.05 })
      addIfMissing({
        kind: 'warning_label',
        position: [-0.12, 0.7, 0.13],
        length: 0.13,
        width: 0.06,
      })
      break
  }

  return completed
}

export function assessPartBlueprint(input: PartComposeInput = {}): PartBlueprintAssessment {
  const present = partKinds(input.parts ?? [])
  const spec = familySpecForParts(present)
  const required = spec.required.map(
    (requirement) => requirement.defaultPart.kind as PartComposeKind,
  )
  const missing = spec.required
    .filter((requirement) => !hasAnyPart(present, requirement))
    .map((requirement) => requirement.defaultPart.kind as PartComposeKind)
  const recommendedDetails = spec.recommendedDetails.map(
    (requirement) => requirement.defaultPart.kind as PartComposeKind,
  )
  const missingDetails = spec.recommendedDetails
    .filter((requirement) => !hasAnyPart(present, requirement))
    .map((requirement) => requirement.defaultPart.kind as PartComposeKind)
  const requiredScore =
    spec.required.length === 0 ? 1 : (spec.required.length - missing.length) / spec.required.length
  const detailScore =
    spec.recommendedDetails.length === 0
      ? 1
      : (spec.recommendedDetails.length - missingDetails.length) / spec.recommendedDetails.length
  const score = Number((requiredScore * 0.82 + detailScore * 0.18).toFixed(4))
  const recommendations = [
    ...missing.map((kind) => `Add required ${kind}.`),
    ...missingDetails.map((kind) => `Consider adding detail ${kind}.`),
  ]
  return {
    family: spec.family,
    required,
    present,
    missing,
    optional: spec.optional,
    recommendedDetails,
    missingDetails,
    score,
    recommendations,
  }
}

function completePartBlueprint(
  parts: PartComposePartInput[],
  autoComplete: boolean | undefined,
  input: PartComposeInput,
): PartComposePartInput[] {
  const completed = dedupeSingletonBlueprintParts(parts)
  const ballValve =
    isBallValveIntent(input) || completed.some((part) => isBallValveIntent(input, part))
  const tuneValveDefaults = () => {
    if (!ballValve) return
    for (let i = 0; i < completed.length; i += 1) {
      const part = completed[i]
      if (!part) continue
      const kind = normalizedPartKind(part)
      if (kind === 'valve_body' && !part.valveStyle && !part.style && !part.variant) {
        completed[i] = { ...part, valveStyle: 'ball' }
      }
      if (kind === 'handwheel' && !part.handleStyle && !part.style && !part.variant) {
        completed[i] = { ...part, handleStyle: 'lever' }
      }
    }
  }
  if (isRegistryPartPlanInput(input)) {
    tuneValveDefaults()
    return completed
  }
  if (autoComplete === false) return completed

  if (isAircraftIntent(input)) {
    const present = partKinds(completed)
    const hasSpecificAircraftPart = present.some(
      (kind) => aircraftRequiredPartKinds.includes(kind) || kind === 'aircraft_landing_gear',
    )
    const hasGenericAircraftPart = present.some(isAircraftPartKind)
    const defaults = aircraftDefaultParts(input)
    if (!hasGenericAircraftPart) {
      completed.push(...defaults)
    } else if (hasSpecificAircraftPart) {
      for (let index = 0; index < completed.length; index += 1) {
        const part = completed[index]
        if (!part) continue
        const kind = normalizedPartKind(part)
        const defaultPart = defaults.find((candidate) => normalizedPartKind(candidate) === kind)
        if (defaultPart) completed[index] = { ...defaultPart, ...part }
      }
      const refreshedPresent = partKinds(completed)
      for (const defaultPart of defaults) {
        const defaultKind = normalizedPartKind(defaultPart)
        if (
          defaultKind &&
          aircraftRequiredPartKinds.includes(defaultKind) &&
          !refreshedPresent.includes(defaultKind)
        ) {
          completed.push(defaultPart)
        }
      }
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const present = partKinds(completed)
    const spec = familySpecForParts(present)
    if (spec.family === 'unknown') break
    if (spec.family === 'vehicle' && isAircraftIntent(input)) break

    for (const requirement of spec.required) {
      if (!hasAnyPart(present, requirement)) completed.push(requirement.defaultPart)
    }
  }
  tuneValveDefaults()

  const completedKinds = partKinds(completed)
  const completedFlangeCount = completed.filter(
    (part) => normalizedPartKind(part) === 'flange_ring',
  ).length
  if (familySpecForParts(completedKinds).family === 'valve' && completedFlangeCount < 2) {
    if (completedFlangeCount === 0) {
      completed.push(
        {
          id: 'flange_inlet',
          name: 'flange_inlet',
          kind: 'flange_ring',
          connectTo: 'valve_body',
          connectPoint: 'inlet',
          childPoint: 'front',
          axis: 'x',
          radius: 0.14,
        },
        {
          id: 'flange_outlet',
          name: 'flange_outlet',
          kind: 'flange_ring',
          connectTo: 'valve_body',
          connectPoint: 'outlet',
          childPoint: 'back',
          axis: 'x',
          radius: 0.14,
        },
      )
    } else {
      completed.push({
        id: 'flange_outlet',
        name: 'flange_outlet',
        kind: 'flange_ring',
        connectTo: 'valve_body',
        connectPoint: 'outlet',
        childPoint: 'back',
        axis: 'x',
        radius: 0.14,
      })
    }
  }

  return completed
}

function semanticRoleForPartShape(kind: PartComposeKind, shape: PrimitiveShapeInput): string {
  const name = shape.name?.toLowerCase() ?? ''

  switch (kind) {
    case 'body_shell':
      if (name.includes('body shell')) return 'vehicle_body'
      if (name.includes('cabin')) return 'vehicle_cabin'
      if (name.includes('pillar')) return 'vehicle_pillar'
      if (name.includes('roof')) return 'vehicle_roof'
      if (name.includes('deck')) return 'vehicle_deck'
      if (name.includes('rocker')) return 'vehicle_rocker'
      return 'vehicle_body_detail'
    case 'wheel_set':
    case 'wheel':
      if (name.includes('bicycle') && name.includes('tire')) return 'bicycle_tire'
      if ((name.includes('vehicle') || name.includes('car')) && name.includes('tire'))
        return 'vehicle_tire'
      if (name.includes('tire')) return 'wheel_tire'
      if (name.includes('hub')) return 'wheel_hub'
      return 'wheel_detail'
    case 'window_panel':
      return name.includes('vehicle') ? 'vehicle_window' : 'window_panel'
    case 'window_strip':
      return name.includes('vehicle') ? 'vehicle_window' : 'window_panel'
    case 'light_pair':
      return 'headlight'
    case 'pyramid':
      return 'pyramid'
    case 'chimney_stack':
      if (name.includes('base')) return 'chimney_base'
      if (name.includes('rim')) return 'chimney_top_rim'
      if (name.includes('seam')) return 'chimney_seam_ring'
      if (name.includes('warning band')) return 'chimney_warning_band'
      if (name.includes('door')) return 'access_door'
      return 'chimney_body'
    case 'bar_pair':
      if (name.includes('front')) return 'front_bumper'
      if (name.includes('rear')) return 'rear_bumper'
      return 'bumper'
    case 'tube_frame':
      return name.includes('bicycle') || name.includes('bike') ? 'bicycle_frame' : 'tube_frame'
    case 'fork':
      return name.includes('bicycle') || name.includes('bike') ? 'bicycle_fork' : 'fork'
    case 'handlebar':
      return 'handlebar'
    case 'saddle':
      return 'saddle'
    case 'chain_loop':
      return 'chain_loop'
    case 'radial_blades':
      return name.includes('blade root') ? 'fan_blade_root' : 'fan_blade'
    case 'fan_blade':
      return name.includes('hub') ? 'fan_hub' : 'fan_blade'
    case 'propeller_blade_set':
      if (name.includes('hub')) return 'propeller_hub'
      return 'propeller_blade'
    case 'mixer_blades':
      if (name.includes('root')) return 'mixer_blade_root'
      if (name.includes('tip') || name.includes('edge')) return 'mixer_blade_edge'
      return 'mixer_blade'
    case 'airfoil_blade':
      if (name.includes('hub')) return 'airfoil_hub'
      return 'airfoil_blade'
    case 'ellipsoid_shell':
      if (name.includes('top access')) return 'ellipsoid_shell_top_opening'
      if (name.includes('opening')) return 'ellipsoid_shell_opening'
      if (name.includes('rim')) return 'ellipsoid_shell_rim'
      return 'ellipsoid_shell'
    case 'curved_lens_panel':
      if (name.includes('rim')) return 'lens_rim'
      return 'curved_lens'
    case 'ergonomic_shell':
      if (name.includes('button')) return 'mouse_button'
      if (name.includes('scroll')) return 'scroll_wheel'
      if (name.includes('nose')) return 'ergonomic_shell_nose'
      if (name.includes('tail')) return 'ergonomic_shell_tail'
      if (name.includes('base')) return 'ergonomic_shell_base'
      return 'ergonomic_shell'
    case 'aircraft_fuselage':
      if (name.includes('cockpit')) return 'cockpit_window'
      if (name.includes('window')) return 'cabin_window'
      if (name.includes('stripe')) return 'aircraft_livery_stripe'
      if (name.includes('nose')) return 'aircraft_nose'
      if (name.includes('tail')) return 'aircraft_tail'
      return 'aircraft_fuselage'
    case 'aircraft_wing':
      return 'aircraft_wing'
    case 'aircraft_engine':
      if (name.includes('fan')) return 'engine_fan'
      if (name.includes('intake')) return 'engine_intake'
      return 'engine_nacelle'
    case 'aircraft_vertical_stabilizer':
      return 'vertical_stabilizer'
    case 'aircraft_horizontal_stabilizer':
      return 'horizontal_stabilizer'
    case 'aircraft_landing_gear':
      if (name.includes('nose')) return 'aircraft_landing_gear_nose'
      if (name.includes('main')) return 'aircraft_landing_gear_main'
      return 'landing_gear_wheel'
    case 'generic_body':
      return name.includes('building')
        ? 'building_body'
        : name.includes('furniture')
          ? 'furniture_body'
          : 'main_body'
    case 'generic_base':
      return name.includes('cup') ? 'cup_platform' : 'support_base'
    case 'generic_panel':
      return 'panel'
    case 'generic_handle':
      return 'handle'
    case 'generic_spout':
      return 'spout'
    case 'generic_control_panel':
      return 'control_detail'
    case 'generic_display':
      return 'display'
    case 'generic_foot_set':
      return 'support_foot'
    case 'generic_opening':
      return 'opening'
    case 'generic_detail_accent':
      return 'detail_accent'
    case 'manway_lid':
      if (name.includes('gasket')) return 'manway_gasket'
      if (name.includes('handle')) return 'manway_handle'
      if (name.includes('bolt')) return 'manway_bolt'
      return 'manway_lid'
    case 'sanitary_nozzle':
      if (name.includes('bead')) return 'sanitary_clamp_bead'
      return 'sanitary_nozzle'
    case 'jacket_shell':
      if (name.includes('seam')) return 'jacket_seam'
      return 'jacket_shell'
    case 'sight_glass':
      if (name.includes('rim')) return 'sight_glass_rim'
      return 'sight_glass'
    case 'sample_valve':
      if (name.includes('handle')) return 'sample_valve_handle'
      if (name.includes('body')) return 'sample_valve_body'
      return 'sample_valve'
    case 'instrument_port':
      if (name.includes('gauge')) return 'instrument_gauge'
      return 'instrument_port'
    case 'stainless_highlight_panel':
      return 'stainless_highlight_panel'
    case 'mobile_platform_chassis':
      if (name.includes('skirt')) return 'lower_bumper_skirt'
      if (name.includes('deck')) return 'cargo_platform'
      if (name.includes('status')) return 'status_light_strip'
      return 'vehicle_body'
    case 'lidar_sensor':
      return name.includes('lens') ? 'sensor_lens' : 'navigation_sensor'
    case 'emergency_stop_button':
      if (name.includes('base')) return 'emergency_stop_base'
      if (name.includes('guard')) return 'emergency_stop_guard'
      return 'emergency_stop_button'
    case 'status_light_strip':
      return 'status_light_strip'
    case 'operator_panel':
      if (name.includes('screen')) return 'display_screen'
      if (name.includes('button')) return 'control_button'
      return 'control_panel'
    case 'guard_fence':
      if (name.includes('post')) return 'guard_fence_post'
      return 'safety_barrier'
    case 'pallet_table':
      if (name.includes('leg')) return 'support_leg'
      return 'pallet_table'
    case 'bearing_block':
      if (name.includes('base')) return 'bearing_base'
      if (name.includes('ring')) return 'bearing_ring'
      if (name.includes('bore')) return 'bearing_bore'
      if (name.includes('bolt')) return 'mounting_bolt'
      return 'bearing_block'
    case 'structural_tower_frame':
      if (name.includes('platform')) return 'multi_level_platform'
      if (name.includes('rail')) return 'platform_guard_rail'
      if (name.includes('internal stair flight')) return 'internal_stair_flight'
      if (name.includes('internal stair landing')) return 'internal_stair_landing'
      if (name.includes('stair flight')) return 'external_stair_flight'
      if (name.includes('stair landing')) return 'external_stair_landing'
      if (name.includes('diagonal') || name.includes('cross brace')) return 'tower_diagonal_brace'
      if (name.includes('ladder')) return 'access_ladder'
      if (name.includes('column')) return 'tower_column'
      if (name.includes('beam')) return 'tower_beam'
      return 'preheater_tower_body'
    case 'cyclone_separator_unit':
      if (name.includes('hopper') || name.includes('cone')) return 'cyclone_cone'
      if (name.includes('outlet')) return 'cyclone_top_outlet'
      if (name.includes('inlet') || name.includes('duct')) return 'preheater_gas_duct'
      if (name.includes('drop pipe')) return 'meal_drop_pipe'
      if (name.includes('band')) return 'cyclone_connection_band'
      return 'preheater_cyclone'
    case 'coupling_guard':
      if (name.includes('flange')) return 'guard_end_flange'
      return 'coupling_guard'
    case 'motor_gearbox_unit':
      if (name.includes('motor')) return 'drive_motor'
      if (name.includes('shaft')) return 'output_shaft'
      if (name.includes('rib')) return 'motor_cooling_rib'
      return 'gearbox_body'
    case 'pipe_manifold':
      if (name.includes('branch')) return 'manifold_branch'
      return 'pipe_manifold'
    case 'hopper_body':
      if (name.includes('outlet')) return 'hopper_outlet'
      if (name.includes('leg')) return 'hopper_support_leg'
      return 'hopper_body'
    case 'conical_hopper':
      if (name.includes('outlet')) return 'hopper_outlet_collar'
      if (name.includes('leg')) return 'support_leg'
      return 'conical_hopper'
    case 'service_platform':
      if (name.includes('post')) return 'platform_post'
      if (name.includes('rail')) return 'guard_rail'
      if (name.includes('ladder')) return 'access_ladder'
      return 'service_platform'
    case 'platform_with_ladder':
      if (name.includes('rung')) return 'ladder_rung'
      if (name.includes('side rail')) return 'ladder_side_rail'
      if (name.includes('post')) return 'platform_post'
      if (name.includes('rail')) return 'guard_rail'
      if (name.includes('ladder')) return 'access_ladder'
      return 'service_platform'
    case 'kiosk_body':
      return 'kiosk_body'
    case 'kiosk_roof':
      return 'roof'
    case 'kiosk_opening':
      return 'opening'
    case 'kiosk_counter':
      return 'service_counter'
    case 'kiosk_sign':
      return 'sign_panel'
    case 'kiosk_awning':
      return 'awning'
    case 'streamlined_body':
      if (name.includes('nose')) return 'streamlined_nose'
      if (name.includes('tail')) return 'streamlined_tail'
      if (name.includes('roof')) return 'streamlined_roof_arc'
      return 'streamlined_body'
    case 'lofted_panel':
      if (name.includes('root')) return 'lofted_panel_root'
      if (name.includes('tip')) return 'lofted_panel_tip'
      if (name.includes('seam')) return 'lofted_panel_section'
      return 'lofted_panel_segment'
    case 'protective_grill':
      return 'protective_grill'
    case 'volute_casing':
      return 'volute_casing'
    case 'inlet_port':
      return 'inlet_port'
    case 'outlet_port':
      return 'outlet_port'
    case 'flange_ring':
      if (name.includes('flange_inlet') || name.includes('inlet')) {
        if (name.includes('gasket')) return 'flange_gasket'
        return name.includes('bolt') ? 'flange_inlet_bolt' : 'flange_inlet'
      }
      if (name.includes('flange_outlet') || name.includes('outlet')) {
        if (name.includes('gasket')) return 'flange_gasket'
        return name.includes('bolt') ? 'flange_outlet_bolt' : 'flange_outlet'
      }
      return name.includes('bolt') ? 'flange_bolt' : 'flange_ring'
    case 'flanged_nozzle':
      if (name.includes('flange'))
        return name.includes('bolt') ? 'nozzle_flange_bolt' : 'nozzle_flange'
      if (name.includes('neck')) return 'flanged_nozzle'
      return 'flanged_nozzle'
    case 'inspection_hatch':
      if (name.includes('hinge')) return 'hatch_hinge'
      if (name.includes('handle')) return 'hatch_handle'
      return 'inspection_hatch'
    case 'valve_body':
      if (name.includes('seat ring')) return 'seat_ring'
      if (name.includes('ball bore')) return 'valve_bore'
      if (name.includes('valve ball')) return 'valve_ball'
      if (name.includes('bonnet bolt')) return 'bonnet_bolts'
      if (name.includes('bonnet')) return 'bonnet'
      if (name.includes('stem')) return 'stem'
      if (name.includes('gate wedge')) return 'gate_wedge'
      if (name.includes('yoke')) return 'yoke'
      return 'valve_body'
    case 'cylindrical_tank':
      if (name.includes('nozzle')) return 'inlet_port'
      if (name.includes('dished end')) return 'vessel_head'
      return 'vessel_shell'
    case 'agitator_tank':
      if (name.includes('motor')) return 'agitator_motor'
      if (name.includes('shaft')) return 'agitator_shaft'
      if (name.includes('hub')) return 'reactor_impeller_hub'
      if (name.includes('blade')) return 'reactor_impeller'
      return 'reactor_vessel_shell'
    case 'heat_exchanger':
      if (name.includes('top nozzle')) return 'inlet_port'
      if (name.includes('bottom nozzle')) return 'outlet_port'
      if (name.includes('tube bundle')) return 'tube_bundle'
      if (name.includes('channel head')) return 'heat_exchanger_channel_head'
      return 'heat_exchanger_shell'
    default:
      return kind
  }
}

function normalizedRoleToken(role: unknown): string {
  return typeof role === 'string'
    ? role
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    : ''
}

function shouldPreferPartShapeRole(
  kind: PartComposeKind,
  partRole: string,
  inferredRole: string,
): boolean {
  if (!partRole || partRole === inferredRole) return false
  switch (kind) {
    case 'tube_frame':
      return (
        inferredRole === 'bicycle_frame' &&
        ['frame', 'bike_frame', 'bicycle', 'bike', 'complete_bicycle'].includes(partRole)
      )
    case 'fork':
      return (
        inferredRole === 'bicycle_fork' &&
        ['fork', 'front_fork', 'bike_fork', 'bicycle', 'bike', 'complete_bicycle'].includes(
          partRole,
        )
      )
    case 'handlebar':
      return [
        'bike_handlebar',
        'bike_handlebars',
        'bicycle_handlebar',
        'bicycle_handlebars',
      ].includes(partRole)
    case 'saddle':
      return [
        'seat',
        'bike_seat',
        'bicycle_seat',
        'bike_saddle',
        'bicycle_saddle',
        'bicycle',
        'bike',
      ].includes(partRole)
    case 'chain_loop':
      return [
        'chain',
        'bicycle_chain',
        'crank',
        'bicycle_crank',
        'chainring',
        'bicycle_chainring',
        'pedal',
        'pedals',
        'bicycle_pedals',
      ].includes(partRole)
    case 'cylindrical_tank':
    case 'agitator_tank':
    case 'heat_exchanger':
      return true
    default:
      return false
  }
}

function semanticRoleForTaggedPartShape(
  kind: PartComposeKind,
  shape: PrimitiveShapeInput,
  part: PartComposePartInput,
): string {
  const inferredRole = semanticRoleForPartShape(kind, shape)
  const partRole = normalizedRoleToken(part.semanticRole)
  if (shouldPreferPartShapeRole(kind, partRole, inferredRole)) return inferredRole
  return partRole || inferredRole
}

function tagGeneratedPartShapes(
  shapes: PrimitiveShapeInput[],
  startIndex: number,
  kind: PartComposeKind,
  part: PartComposePartInput,
  index: number,
) {
  const sourcePartId = part.id ?? part.name ?? part.partName ?? `${kind}-${index + 1}`
  for (let i = startIndex; i < shapes.length; i += 1) {
    const shape = shapes[i]
    if (!shape) continue
    shape.sourcePartKind ??= part.sourcePartKind ?? kind
    shape.sourcePartId ??= sourcePartId
    shape.semanticGroup ??= part.semanticGroup ?? sourcePartId
    shape.semanticRole ??=
      kind === 'body_shell'
        ? semanticRoleForPartShape(kind, shape)
        : semanticRoleForTaggedPartShape(kind, shape, part)
  }
}

export function composePartPrimitives(input: PartComposeInput = {}): PrimitiveShapeInput[] {
  input = normalizePartComposeInput(input)
  const origin = input.position ?? [0, 0, 0]
  const requestedParts = applyMixerPartDefaults(input.parts ?? [], input)
  const completedBlueprintParts = completePartBlueprint(requestedParts, input.autoComplete, input)
  const completedParts = applyContextualPartDefaults(
    applyBicycleLayoutDefaults(applyVehicleLayoutDefaults(completedBlueprintParts, input), input),
    input,
  )
  const detailedParts = applyMixerPartDefaults(
    enhancePartBlueprintWithVisualDetails(completedParts, input),
    input,
  )
  const parts = resolveLayout({
    parts: applyMixerPartDefaults(
      applyBicycleLayoutDefaults(
        applyContextualPartDefaults(applyVehicleLayoutDefaults(detailedParts, input), input),
        input,
      ),
      input,
    ),
  })
  const shapes: PrimitiveShapeInput[] = []

  parts.forEach((part, index) => {
    const kind = normalizedPartKind(part)
    if (!kind) return

    const startIndex = shapes.length
    switch (kind) {
      case 'circular_base':
        shapes.push(...composeCircularBase(input, part, origin, index))
        break
      case 'vertical_pole':
        shapes.push(...composeVerticalPole(input, part, origin, index))
        break
      case 'motor_housing':
        shapes.push(...composeMotorHousing(input, part, origin, index))
        break
      case 'fan_blade':
        shapes.push(...composeFanBladeArray(input, part, origin))
        break
      case 'radial_blades':
        shapes.push(...composeRadialBlades(input, part, origin))
        break
      case 'protective_grill':
        shapes.push(...composeProtectiveGrill(input, part, origin))
        break
      case 'pyramid':
        shapes.push(...composePyramid(input, part, origin))
        break
      case 'support_bracket':
        shapes.push(...composeSupportBracket(input, part, origin))
        break
      case 'control_knob':
        shapes.push(...composeControlKnob(input, part, origin, index))
        break
      case 'vent_slats':
      case 'vent_grill':
        shapes.push(...composeVentSlats(input, part, origin, kind))
        break
      case 'skid_base':
        shapes.push(...composeSkidBase(input, part, origin))
        break
      case 'rounded_machine_body':
        shapes.push(...composeRoundedMachineBody(input, part, origin))
        break
      case 'volute_casing':
        shapes.push(...composeVoluteCasing(input, part, origin))
        break
      case 'impeller_blades':
        shapes.push(...composeImpellerBlades(input, part, origin))
        break
      case 'propeller_blade_set':
        shapes.push(...composePropellerBladeSet(input, part, origin))
        break
      case 'mixer_blades':
        shapes.push(...composeMixerBlades(input, part, origin))
        break
      case 'airfoil_blade':
        shapes.push(...composeAirfoilBlade(input, part, origin))
        break
      case 'ellipsoid_shell':
        shapes.push(...composeEllipsoidShell(input, part, origin))
        break
      case 'curved_lens_panel':
        shapes.push(...composeCurvedLensPanel(input, part, origin))
        break
      case 'ergonomic_shell':
        shapes.push(...composeErgonomicShell(input, part, origin))
        break
      case 'streamlined_body':
        shapes.push(...composeStreamlinedBody(input, part, origin))
        break
      case 'aircraft_fuselage':
        shapes.push(...composeAircraftFuselage(input, part, origin))
        break
      case 'aircraft_wing':
        shapes.push(...composeAircraftWing(input, part, origin))
        break
      case 'aircraft_engine':
        shapes.push(...composeAircraftEngine(input, part, origin))
        break
      case 'aircraft_vertical_stabilizer':
        shapes.push(...composeAircraftVerticalStabilizer(input, part, origin))
        break
      case 'aircraft_horizontal_stabilizer':
        shapes.push(...composeAircraftHorizontalStabilizer(input, part, origin))
        break
      case 'aircraft_landing_gear':
        shapes.push(...composeAircraftLandingGear(input, part, origin))
        break
      case 'generic_body':
        shapes.push(...composeGenericBody(input, part, origin))
        break
      case 'generic_base':
        shapes.push(...composeGenericBase(input, part, origin))
        break
      case 'generic_panel':
      case 'generic_control_panel':
      case 'generic_display':
      case 'generic_opening':
      case 'generic_detail_accent':
        shapes.push(...composeGenericPanel(input, part, origin, kind))
        break
      case 'generic_handle':
        shapes.push(...composeGenericHandle(input, part, origin))
        break
      case 'generic_spout':
        shapes.push(...composeGenericSpout(input, part, origin))
        break
      case 'generic_foot_set':
        shapes.push(...composeGenericFootSet(input, part, origin))
        break
      case 'mobile_platform_chassis':
        shapes.push(...composeMobilePlatformChassis(input, part, origin))
        break
      case 'lidar_sensor':
        shapes.push(...composeLidarSensor(input, part, origin))
        break
      case 'emergency_stop_button':
        shapes.push(...composeEmergencyStopButton(input, part, origin))
        break
      case 'status_light_strip':
        shapes.push(...composeStatusLightStrip(input, part, origin))
        break
      case 'operator_panel':
        shapes.push(...composeOperatorPanel(input, part, origin))
        break
      case 'guard_fence':
        shapes.push(...composeGuardFence(input, part, origin))
        break
      case 'pallet_table':
        shapes.push(...composePalletTable(input, part, origin))
        break
      case 'bearing_block':
        shapes.push(...composeBearingBlock(input, part, origin))
        break
      case 'support_roller_pair':
        shapes.push(...composeSupportRollerPair(input, part, origin))
        break
      case 'structural_tower_frame':
        shapes.push(...composeStructuralTowerFrame(input, part, origin))
        break
      case 'cyclone_separator_unit':
        shapes.push(...composeCycloneSeparatorUnit(input, part, origin))
        break
      case 'coupling_guard':
        shapes.push(...composeCouplingGuard(input, part, origin))
        break
      case 'motor_gearbox_unit':
        shapes.push(...composeMotorGearboxUnit(input, part, origin))
        break
      case 'pipe_manifold':
        shapes.push(...composePipeManifold(input, part, origin))
        break
      case 'hopper_body':
        shapes.push(...composeHopperBody(input, part, origin))
        break
      case 'conical_hopper':
        shapes.push(...composeConicalHopper(input, part, origin))
        break
      case 'service_platform':
        shapes.push(...composeServicePlatform(input, part, origin))
        break
      case 'platform_with_ladder':
        shapes.push(...composePlatformWithLadder(input, part, origin))
        break
      case 'kiosk_body':
        shapes.push(...composeKioskBody(input, part, origin))
        break
      case 'kiosk_roof':
        shapes.push(...composeKioskRoof(input, part, origin))
        break
      case 'kiosk_opening':
        shapes.push(...composeKioskOpening(input, part, origin))
        break
      case 'kiosk_counter':
        shapes.push(...composeKioskCounter(input, part, origin))
        break
      case 'kiosk_sign':
        shapes.push(...composeKioskSign(input, part, origin))
        break
      case 'kiosk_awning':
        shapes.push(...composeKioskAwning(input, part, origin))
        break
      case 'lofted_panel':
        shapes.push(...composeLoftedPanel(input, part, origin))
        break
      case 'pipe_port':
        shapes.push(...composePipePort(input, part, origin, 'pipe_port'))
        break
      case 'inlet_port':
        shapes.push(...composePipePort(input, part, origin, 'inlet_port'))
        break
      case 'outlet_port':
        shapes.push(...composePipePort(input, part, origin, 'outlet_port'))
        break
      case 'flange_ring':
        shapes.push(...composeFlangeRing(input, part, origin))
        break
      case 'flanged_nozzle':
        shapes.push(...composeFlangedNozzle(input, part, origin))
        break
      case 'manway_lid':
        shapes.push(...composeManwayLid(input, part, origin))
        break
      case 'inspection_hatch':
        shapes.push(...composeInspectionHatch(input, part, origin))
        break
      case 'sanitary_nozzle':
        shapes.push(...composeSanitaryNozzle(input, part, origin))
        break
      case 'jacket_shell':
        shapes.push(...composeJacketShell(input, part, origin))
        break
      case 'sight_glass':
        shapes.push(...composeSightGlass(input, part, origin))
        break
      case 'sample_valve':
        shapes.push(...composeSampleValve(input, part, origin))
        break
      case 'instrument_port':
        shapes.push(...composeInstrumentPort(input, part, origin))
        break
      case 'stainless_highlight_panel':
        shapes.push(...composeStainlessHighlightPanel(input, part, origin))
        break
      case 'bolt_pattern':
        shapes.push(...composeBoltPattern(input, part, origin))
        break
      case 'control_box':
        shapes.push(...composeControlBox(input, part, origin))
        break
      case 'ribbed_motor_body':
        shapes.push(...composeRibbedMotorBody(input, part, origin))
        break
      case 'conveyor_frame':
        shapes.push(...composeConveyorFrame(input, part, origin))
        break
      case 'roller_array':
        shapes.push(...composeRollerArray(input, part, origin))
        break
      case 'belt_surface':
        shapes.push(...composeBeltSurface(input, part, origin))
        break
      case 'cylindrical_tank':
        shapes.push(...composeCylindricalTank(input, part, origin))
        break
      case 'chimney_stack':
        shapes.push(...composeChimneyStack(input, part, origin))
        break
      case 'valve_body':
        shapes.push(...composeValveBody(input, part, origin))
        break
      case 'handwheel':
        shapes.push(...composeHandwheel(input, part, origin))
        break
      case 'wheel':
      case 'wheel_set': {
        const partName =
          `${part.id ?? ''} ${part.name ?? ''} ${part.partName ?? ''} ${part.kind ?? ''}`.toLowerCase()
        const role = normalizedRoleToken(part.semanticRole)
        const completeBicycleContext = isCompleteBicycleParts(input.parts ?? [])
        const hasExplicitCount =
          typeof part.count === 'number' && Number.isFinite(part.count) && part.count > 0
        const forceSingleWheel =
          !completeBicycleContext &&
          !hasExplicitCount &&
          (kind === 'wheel' ||
            role === 'wheel' ||
            role === 'vehicle_wheel' ||
            role === 'car_wheel' ||
            role === 'bicycle_wheel' ||
            role === 'bike_wheel')
        const wheelPart = { ...part, count: forceSingleWheel ? 1 : part.count }
        const tireRole = wheelTireRole(input, wheelPart, partName)
        shapes.push(
          ...(tireRole === 'bicycle_tire'
            ? composeBicycleWheels(input, wheelPart, origin)
            : composeWheelSet(input, wheelPart, origin)),
        )
        break
      }
      case 'tube_frame':
        shapes.push(...composeBicycleFrame(input, part, origin))
        break
      case 'fork':
        shapes.push(...composeBicycleFork(input, part, origin))
        break
      case 'handlebar':
        shapes.push(...composeHandlebar(input, part, origin))
        break
      case 'saddle':
        shapes.push(...composeSaddle(input, part, origin))
        break
      case 'chain_loop':
        shapes.push(...composeChainLoop(input, part, origin))
        break
      case 'body_shell':
        shapes.push(...composeVehicleBody(input, part, origin))
        break

      case 'window_panel':
        shapes.push(...composeWindowPanel(input, part, origin))
        break
      case 'window_strip':
        shapes.push(...composeWindowStrip(input, part, origin))
        break
      case 'light_pair':
        shapes.push(...composeHeadlights(input, part, origin))
        break
      case 'bar_pair':
        shapes.push(...composeBumper(input, part, origin))
        break
      case 'gearbox_body':
        shapes.push(...composeGearboxBody(input, part, origin))
        break
      case 'filter_vessel':
        shapes.push(...composeFilterVessel(input, part, origin))
        break
      case 'heat_exchanger':
        shapes.push(...composeHeatExchanger(input, part, origin))
        break
      case 'agitator_tank':
        shapes.push(...composeAgitatorTank(input, part, origin))
        break
      case 'pipe_rack':
        shapes.push(...composePipeRack(input, part, origin))
        break
      case 'platform_ladder':
        shapes.push(...composePlatformLadder(input, part, origin))
        break
      case 'desk_top':
        shapes.push(...composeDeskTop(input, part, origin))
        break
      case 'leg_set':
        shapes.push(...composeLegSet(input, part, origin))
        break
      case 'drawer_stack':
        shapes.push(...composeDrawerStack(input, part, origin))
        break
      case 'electrical_cabinet':
        shapes.push(...composeElectricalCabinet(input, part, origin))
        break
      case 'pipe_run':
        shapes.push(...composePipeRun(input, part, origin))
        break
      case 'pipe_elbow':
        shapes.push(...composePipeElbow(input, part, origin))
        break
      case 'cable_tray':
        shapes.push(...composeCableTray(input, part, origin))
        break
      case 'nameplate':
        shapes.push(...composeNameplate(input, part, origin))
        break
      case 'warning_label':
        shapes.push(...composeWarningLabel(input, part, origin))
        break
      case 'seam_ring':
        shapes.push(...composeSeamRing(input, part, origin))
        break
    }
    tagGeneratedPartShapes(shapes, startIndex, kind, part, index)
  })

  return shapes
}
