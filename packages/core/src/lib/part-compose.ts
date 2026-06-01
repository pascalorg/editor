import type {
  PrimitiveGeometryBrief,
  PrimitiveMaterialInput,
  PrimitiveShapeInput,
  Vec3,
} from './primitive-compose'

type PartAxis = 'x' | 'y' | 'z'
type PartSide = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back'

export type PartComposeKind =
  | 'circular_base'
  | 'vertical_pole'
  | 'motor_housing'
  | 'radial_blades'
  | 'protective_grill'
  | 'support_bracket'
  | 'control_knob'
  | 'vent_slats'
  | 'skid_base'
  | 'rounded_machine_body'
  | 'volute_casing'
  | 'impeller_blades'
  | 'pipe_port'
  | 'inlet_port'
  | 'outlet_port'
  | 'flange_ring'
  | 'bolt_pattern'
  | 'control_box'
  | 'ribbed_motor_body'
  | 'conveyor_frame'
  | 'roller_array'
  | 'belt_surface'
  | 'cylindrical_tank'
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

export type PartComposeDetail = 'low' | 'medium' | 'high'

export interface PartComposePartInput {
  kind?: PartComposeKind | string
  partType?: PartComposeKind | string
  type?: PartComposeKind | string
  id?: string
  name?: string
  partName?: string
  position?: Vec3
  rotation?: Vec3
  connectTo?: string | number
  connectPoint?: string
  childPoint?: string
  anchor?: string
  childAnchor?: string
  axis?: PartAxis | string
  side?: PartSide | string
  outletAngle?: number
  radius?: number
  height?: number
  width?: number
  depth?: number
  domeDepth?: number
  length?: number
  cornerRadius?: number
  cornerSegments?: number
  count?: number
  ringCount?: number
  spokeCount?: number
  wireRadius?: number
  wheelRadius?: number
  wheelWidth?: number
  frontX?: number
  rearX?: number
  frontZ?: number
  rearZ?: number
  overallHeight?: number
  bodyHeight?: number
  cabinHeight?: number
  bladeRadius?: number
  bladeWidth?: number
  bladePitch?: number
  bladeSweep?: number
  slatCount?: number
  boltCount?: number
  includeBolts?: boolean
  material?: PrimitiveMaterialInput
  materialPreset?: string
  color?: string
}

export interface PartComposeInput {
  name?: string
  partName?: string
  geometryBrief?: PrimitiveGeometryBrief
  position?: Vec3
  detail?: PartComposeDetail | string
  primaryColor?: string
  secondaryColor?: string
  metalColor?: string
  darkColor?: string
  accentColor?: string
  autoComplete?: boolean
  enhanceVisualDetails?: boolean
  parts?: PartComposePartInput[]
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
    case 'fan_blades':
    case 'radial_blades':
      return 'radial_blades'
    case 'grill':
    case 'grille':
    case 'cage':
    case 'protective_grill':
    case 'protective_grille':
      return 'protective_grill'
    case 'bracket':
    case 'yoke':
    case 'support_bracket':
      return 'support_bracket'
    case 'knob':
    case 'control_knob':
      return 'control_knob'
    case 'vents':
    case 'slats':
    case 'vent_slats':
      return 'vent_slats'
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
    case 'pipe':
    case 'pipe_stub':
    case 'pipe_port':
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
      return 'flange_ring'
    case 'bolts':
    case 'bolt_pattern':
    case 'bolt_circle':
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
    case 'belt':
    case 'belt_surface':
    case 'conveyor_belt':
      return 'belt_surface'
    case 'tank':
    case 'vessel':
    case 'cylindrical_tank':
    case 'pressure_vessel':
      return 'cylindrical_tank'
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
      return 'bicycle_wheels'
    case 'bicycle_frame':
    case 'bike_frame':
      return 'bicycle_frame'
    case 'bicycle_fork':
    case 'front_fork':
    case 'bike_fork':
      return 'bicycle_fork'
    case 'handlebar':
    case 'handlebars':
    case 'bike_handlebar':
      return 'handlebar'
    case 'saddle':
    case 'seat':
    case 'bike_seat':
      return 'saddle'
    case 'chain':
    case 'chain_loop':
    case 'bike_chain':
      return 'chain_loop'
    case 'vehicle_body':
    case 'car_body':
    case 'auto_body':
      return 'vehicle_body'
    case 'vehicle_wheels':
    case 'car_wheels':
    case 'wheel_set':
      return 'vehicle_wheels'
    case 'vehicle_windows':
    case 'car_windows':
    case 'windows':
      return 'vehicle_windows'
    case 'headlights':
    case 'head_lights':
    case 'lamps':
      return 'headlights'
    case 'bumper':
    case 'bumpers':
    case 'car_bumper':
      return 'bumper'
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

function normalizePartInput(part: PartComposePartInput): PartComposePartInput {
  const kind = normalizedPartKind(part)
  return {
    ...part,
    ...(kind ? { kind } : {}),
    name: part.name ?? part.partName,
  }
}

function normalizePartComposeInput(input: PartComposeInput): PartComposeInput {
  return {
    ...input,
    name: input.name ?? input.partName,
    parts: input.parts?.map(normalizePartInput),
  }
}

function vehicleLength(part: PartComposePartInput): number {
  return clamp(part.length ?? part.depth, 1.35, 0.3, 5)
}

function vehicleWidth(part: PartComposePartInput): number {
  return clamp(part.width, 0.58, 0.12, 2.5)
}

function vehicleOverallHeight(
  part: PartComposePartInput,
  length = vehicleLength(part),
  width = vehicleWidth(part),
): number {
  return clamp(
    part.overallHeight ?? part.height,
    Math.max(width * 0.72, length * 0.26, 0.46),
    0.22,
    1.8,
  )
}

function vehicleWheelRadius(
  part: PartComposePartInput,
  length: number,
  width: number,
  overallHeight: number,
): number {
  return clamp(
    part.radius ?? part.wheelRadius,
    Math.min(length * 0.08, width * 0.2, overallHeight * 0.24),
    0.04,
    0.6,
  )
}

function applyVehicleLayoutDefaults(parts: PartComposePartInput[]): PartComposePartInput[] {
  const body = parts.find((part) => normalizedPartKind(part) === 'vehicle_body')
  if (!body) return parts

  const bodyLength = vehicleLength(body)
  const bodyWidth = vehicleWidth(body)
  const overallHeight = vehicleOverallHeight(body, bodyLength, bodyWidth)
  const bodyCenter = body.position ?? [0, Math.max(0.34, overallHeight * 0.58), 0]
  const baseY = bodyCenter[1] - overallHeight / 2
  const wheelRadius = vehicleWheelRadius(body, bodyLength, bodyWidth, overallHeight)

  return parts.map((part) => {
    const kind = normalizedPartKind(part)
    switch (kind) {
      case 'vehicle_body':
        return {
          ...part,
          length: bodyLength,
          width: bodyWidth,
          height: overallHeight,
          position: bodyCenter,
        }
      case 'vehicle_wheels': {
        const longitudinal = Math.abs(
          Number(part.frontX ?? part.frontZ ?? bodyLength * 0.36) -
            Number(part.rearX ?? part.rearZ ?? -bodyLength * 0.36),
        )
        return {
          ...part,
          length:
            Number.isFinite(longitudinal) && longitudinal > 0 ? longitudinal : bodyLength * 0.72,
          width: part.width ?? bodyWidth * 0.9,
          radius: part.radius ?? part.wheelRadius ?? wheelRadius,
          wheelWidth: part.wheelWidth ?? part.depth ?? wheelRadius * 0.55,
          position: [bodyCenter[0], baseY + wheelRadius, bodyCenter[2]] as Vec3,
        }
      }
      case 'vehicle_windows':
        return {
          ...part,
          length: part.length ?? bodyLength * 0.4,
          width: part.width ?? bodyWidth * 0.78,
          height: part.height ?? overallHeight * 0.24,
          position: [
            bodyCenter[0] - bodyLength * 0.04,
            baseY + overallHeight * 0.72,
            bodyCenter[2],
          ] as Vec3,
        }
      case 'headlights':
        return {
          ...part,
          width: part.width ?? bodyWidth,
          radius: part.radius ?? Math.min(bodyWidth * 0.045, overallHeight * 0.055),
          position: [
            bodyCenter[0] + bodyLength * 0.49,
            baseY + overallHeight * 0.36,
            bodyCenter[2],
          ] as Vec3,
        }
      case 'bumper':
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
  const radius = clamp(part.radius, 0.025, 0.005, 0.15)
  const height = clamp(part.height ?? part.length, 1, 0.05, 5)
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
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} blade ${i + 1}`,
      position: radialPoint(
        center,
        angle,
        bladeCenterRadius,
        Math.sin(i * 1.7) * bladeDepth * 0.25,
      ),
      rotation: [pitch, 0, angle],
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

function composeProtectiveGrill(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 1.18, 0.04])
  const radius = clamp(part.radius, 0.36, 0.08, 2)
  const cageDepth = clamp(part.depth, 0.12, 0.005, 0.6)
  const domeDepth = clamp(part.domeDepth, cageDepth * 0.72, 0.005, radius * 0.85)
  const ringCount = clampInt(part.ringCount ?? part.count, input.detail === 'low' ? 3 : 4, 1, 8)
  const spokeCount = clampInt(part.spokeCount, input.detail === 'high' ? 24 : 18, 6, 36)
  const wireRadius = clamp(part.wireRadius, radius * 0.018, 0.002, 0.05)
  const grillMat = partMaterial(part, material(input.metalColor ?? '#d1d5db', 0.38, 0.62))
  const shapes: PrimitiveShapeInput[] = []
  const frontZForRatio = (ratio: number) => center[2] + domeDepth * (1 - ratio * ratio)

  for (let i = 0; i < ringCount; i += 1) {
    const ratio = ringCount === 1 ? 1 : 0.22 + (i / (ringCount - 1)) * 0.78
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} grill front ring ${i + 1}`,
      position: [center[0], center[1], frontZForRatio(ratio)],
      axis: 'z',
      majorRadius: radius * ratio,
      tubeRadius: wireRadius,
      radialSegments: Math.max(12, Math.round(ringSegments(input.detail) * 0.35)),
      tubularSegments: ringSegments(input.detail),
      material: grillMat,
    })
  }

  shapes.push({
    kind: 'torus',
    name: `${part.name ?? input.name ?? 'object'} grill rear outer ring`,
    position: [center[0], center[1], center[2] - cageDepth],
    axis: 'z',
    majorRadius: radius,
    tubeRadius: wireRadius,
    radialSegments: Math.max(12, Math.round(ringSegments(input.detail) * 0.35)),
    tubularSegments: ringSegments(input.detail),
    material: grillMat,
  })

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
    const angle = (i * Math.PI * 2) / spokeCount
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

  const sideRibCount = Math.max(6, Math.min(18, Math.round(spokeCount / 2)))
  for (let i = 0; i < sideRibCount; i += 1) {
    const angle = (i * Math.PI * 2) / sideRibCount
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
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.5, 0.02])
  const count = clampInt(part.slatCount ?? part.count, 6, 2, 20)
  const width = clamp(part.width ?? part.length, 0.5, 0.05, 3)
  const height = clamp(part.height, 0.018, 0.004, 0.08)
  const spacing = clamp(part.depth, 0.055, 0.01, 0.3)
  const slatMat = partMaterial(part, material(input.darkColor ?? '#4b5563', 0.62, 0.08))
  return Array.from({ length: count }, (_, i) => ({
    kind: 'box' as const,
    name: `${part.name ?? input.name ?? 'object'} vent slat ${i + 1}`,
    position: [center[0], center[1] + (i - (count - 1) / 2) * spacing, center[2]] as Vec3,
    length: width,
    width: height,
    height,
    cornerRadius: height * 0.3,
    cornerSegments: 3,
    material: slatMat,
  }))
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
  const bodyMat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.48, 0.28))
  return [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} rounded machine body`,
      position: center,
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.12,
      cornerSegments: 6,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} access cover plate`,
      position: [center[0], center[1] + height * 0.02, center[2] + width * 0.51],
      length: length * 0.72,
      width: width * 0.04,
      height: height * 0.58,
      cornerRadius: Math.min(length, height) * 0.025,
      cornerSegments: 3,
      material: material(input.secondaryColor ?? '#334155', 0.55, 0.18),
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
    const angle = (i * Math.PI * 2) / count
    shapes.push({
      kind: 'extrude',
      name: `${part.name ?? input.name ?? 'object'} impeller vane ${i + 1}`,
      position: radialPoint(center, angle, radius * 0.42, 0),
      rotation: [0, 0, angle],
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
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ${label.replace('_', ' ')}`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: Math.max(20, Math.round(ringSegments(input.detail) * 0.55)),
      wallThickness: radius * 0.18,
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
  const side = partSide(part.side)
  const axis = side ? axisForSide(side, 'z') : partAxis(part.axis, 'z')
  const center = add(origin, part.position ?? [0, 0.55, 0.5])
  const radius = clamp(part.radius, 0.12, 0.02, 1)
  const thickness = clamp(part.depth ?? part.height, 0.035, 0.006, 0.3)
  const boltCount = clampInt(part.boltCount ?? part.count, 6, 3, 20)
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
      radialSegments: ringSegments(input.detail),
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
      tubularSegments: Math.max(24, Math.round(ringSegments(input.detail) * 0.65)),
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
  const shapes = Array.from({ length: count }, (_, i) => {
    const angle = (i * Math.PI * 2) / count
    return {
      kind: 'cylinder' as const,
      name: `${part.name ?? input.name ?? 'object'} bolt ${i + 1}`,
      position: radialPointOnAxis(center, axis, angle, radius),
      axis,
      radius: boltRadius,
      height: boltDepth,
      radialSegments: 12,
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

  for (const x of [-0.42, 0.42]) {
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
  const length = clamp(part.length ?? part.height, 0.9, 0.16, 6)
  const mat = partMaterial(part, material(input.primaryColor ?? '#94a3b8', 0.42, 0.48))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} cylindrical tank shell`,
      position: center,
      axis,
      radius,
      height: length,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} tank left dished end`,
      position: offsetAlongAxis(center, axis, -length * 0.52),
      radius: 1,
      scale: axis === 'x' ? [radius * 0.36, radius, radius] : [radius, radius * 0.36, radius],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} tank right dished end`,
      position: offsetAlongAxis(center, axis, length * 0.52),
      radius: 1,
      scale: axis === 'x' ? [radius * 0.36, radius, radius] : [radius, radius * 0.36, radius],
      widthSegments: ringSegments(input.detail),
      heightSegments: Math.max(16, Math.round(ringSegments(input.detail) * 0.5)),
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} tank top nozzle`,
      position: [center[0], center[1] + radius * 1.08, center[2]],
      axis: 'y',
      radius: radius * 0.16,
      height: radius * 0.35,
      radialSegments: 20,
      wallThickness: radius * 0.035,
      material: mat,
    },
  ]
  return applyPartRotation(shapes, center, part.rotation)
}

function composeValveBody(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const axis = partAxis(part.axis, 'x')
  const center = add(origin, part.position ?? [0, 0.38, 0])
  const radius = clamp(part.radius, 0.12, 0.03, 0.8)
  const length = clamp(part.length ?? part.depth, 0.46, 0.12, 2)
  const mat = partMaterial(part, material(input.primaryColor ?? '#475569', 0.45, 0.45))
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const darkMat = material(input.darkColor ?? '#1f2937', 0.42, 0.5)
  const bonnetY = center[1] + radius * 1.16
  const yokeBaseY = center[1] + radius * 1.72
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
  const axis = partAxis(part.axis, 'y')
  const center = add(origin, part.position ?? [0, 0.62, 0])
  const radius = clamp(part.radius, 0.11, 0.025, 0.6)
  const wire = clamp(part.wireRadius, radius * 0.08, 0.002, 0.04)
  const spokeCount = clampInt(part.spokeCount ?? part.count, 4, 3, 8)
  const mat = partMaterial(part, material(input.darkColor ?? '#1f2937', 0.45, 0.45))
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
    const angle = (i * Math.PI * 2) / spokeCount
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
  const tube = clamp(part.wireRadius, wheelRadius * 0.045, 0.004, 0.04)
  const tireMat = material(input.darkColor ?? '#111827', 0.68, 0.02)
  const metalMat = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const shapes: PrimitiveShapeInput[] = []
  for (const [label, x] of [
    ['rear', -length / 2],
    ['front', length / 2],
  ] as const) {
    const wheelCenter: Vec3 = [center[0] + x, center[1], center[2]]
    shapes.push({
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} bicycle ${label} tire`,
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
      position: wheelCenter,
      axis: 'z',
      radius: wheelRadius * 0.08,
      height: tube * 5,
      radialSegments: 16,
      material: metalMat,
    })
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI * 2) / 8
      shapes.push(
        tubeBetween(
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
      )
    }
  }
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
  const shapes = [
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
      material: material(input.darkColor ?? '#111827', 0.48, 0.35),
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
  const crown: Vec3 = [center[0], center[1] + height * 0.35, center[2]]
  const axle: Vec3 = [center[0] + height * 0.2, center[1] - height * 0.55, center[2]]
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
      [crown[0] + height * 0.08, crown[1] + height * 0.32, crown[2]],
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
      [center[0] - width * 0.08, center[1] - width * 0.55, center[2]],
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
  const length = vehicleLength(part)
  const width = vehicleWidth(part)
  const overallHeight = vehicleOverallHeight(part, length, width)
  const center = add(origin, part.position ?? [0, Math.max(0.34, overallHeight * 0.58), 0])
  const baseY = center[1] - overallHeight / 2
  const bodyHeight = clamp(part.bodyHeight, overallHeight * 0.38, 0.08, overallHeight * 0.65)
  const cabinHeight = clamp(part.cabinHeight, overallHeight * 0.42, 0.06, overallHeight * 0.7)
  const bodyY = baseY + overallHeight * 0.38
  const deckY = baseY + overallHeight * 0.56
  const cabinY = baseY + overallHeight * 0.72
  const mat = partMaterial(part, material(input.primaryColor ?? '#ef4444', 0.42, 0.18))
  const shadowMat = material(input.darkColor ?? '#1f2937', 0.58, 0.16)
  const bodyCornerRadius = clamp(
    part.cornerRadius,
    Math.min(length, width, bodyHeight) * 0.12,
    0,
    Math.min(length, width, bodyHeight) * 0.45,
  )
  const bodyCornerSegments = clampInt(part.cornerSegments, 6, 1, 12)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle body shell`,
      position: [center[0], bodyY, center[2]],
      length,
      width,
      height: bodyHeight,
      cornerRadius: bodyCornerRadius,
      cornerSegments: bodyCornerSegments,
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle front deck`,
      position: [center[0] + length * 0.25, deckY, center[2]],
      rotation: [-0.02, 0, 0],
      length: length * 0.34,
      width: width * 0.88,
      height: bodyHeight * 0.16,
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.08),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle rear deck`,
      position: [center[0] - length * 0.35, deckY - bodyHeight * 0.03, center[2]],
      rotation: [0.02, 0, 0],
      length: length * 0.22,
      width: width * 0.9,
      height: bodyHeight * 0.14,
      cornerRadius: Math.min(bodyCornerRadius, bodyHeight * 0.08),
      cornerSegments: Math.max(3, bodyCornerSegments - 1),
      material: mat,
    },
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} vehicle cabin frame`,
      position: [center[0] - length * 0.08, cabinY, center[2]],
      length: length * 0.38,
      width: width * 0.78,
      height: cabinHeight,
      cornerRadius: Math.min(bodyCornerRadius, cabinHeight * 0.12),
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
  ]
  return applyPartRotation(shapes, center, part.rotation)
}
function composeVehicleWheels(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.16, 0])
  const length = clamp(part.length, 0.95, 0.25, 4)
  const width = clamp(part.width, 0.54, 0.12, 2.5)
  const radius = clamp(part.radius ?? part.wheelRadius, 0.14, 0.04, 0.6)
  const wheelWidth = clamp(part.wheelWidth ?? part.depth, radius * 0.42, 0.03, 0.45)
  const tireMat = partMaterial(part, material(input.darkColor ?? '#111827', 0.72, 0.02))
  const rimMat = material(input.metalColor ?? '#d1d5db', 0.25, 0.75)
  const shapes: PrimitiveShapeInput[] = []
  for (const x of [-length / 2, length / 2]) {
    for (const z of [-width / 2, width / 2]) {
      const wheelCenter: Vec3 = [center[0] + x, center[1], center[2] + z]
      shapes.push({
        kind: 'torus',
        name: `${part.name ?? input.name ?? 'object'} vehicle tire`,
        position: wheelCenter,
        axis: 'z',
        majorRadius: radius,
        tubeRadius: Math.min(radius * 0.22, wheelWidth * 0.42),
        radialSegments: 12,
        tubularSegments: ringSegments(input.detail),
        material: tireMat,
      })
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} vehicle wheel hub`,
        position: wheelCenter,
        axis: 'z',
        radius: radius * 0.45,
        height: wheelWidth * 0.35,
        radialSegments: 20,
        material: rimMat,
      })
    }
  }
  return applyPartRotation(shapes, center, part.rotation)
}

function composeVehicleWindows(
  input: PartComposeInput,
  part: PartComposePartInput,
  origin: Vec3,
): PrimitiveShapeInput[] {
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const length = clamp(part.length, 0.5, 0.1, 2)
  const width = clamp(part.width, 0.52, 0.08, 1.8)
  const height = clamp(part.height, 0.12, 0.03, 0.6)
  const glass = partMaterial(part, material(input.accentColor ?? '#93c5fd', 0.18, 0.02, 0.58))
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} windshield`,
      position: [center[0] + length * 0.44, center[1], center[2]],
      rotation: [0, 0, Math.PI / 2],
      length: height,
      width: width * 0.72,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} rear window`,
      position: [center[0] - length * 0.44, center[1], center[2]],
      rotation: [0, 0, Math.PI / 2],
      length: height,
      width: width * 0.68,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} side window left`,
      position: [center[0], center[1], center[2] - width * 0.47],
      rotation: [Math.PI / 2, 0, 0],
      length,
      width: height,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
    {
      kind: 'rounded-panel',
      name: `${part.name ?? input.name ?? 'object'} side window right`,
      position: [center[0], center[1], center[2] + width * 0.47],
      rotation: [Math.PI / 2, 0, 0],
      length,
      width: height,
      thickness: 0.01,
      cornerRadius: height * 0.12,
      cornerSegments: 4,
      material: glass,
    },
  ]
  return shapes
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
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} left headlight`,
      position: [center[0], center[1], center[2] - width * 0.34],
      radius,
      scale: [0.55, 0.75, 1],
      material: lightMat,
    },
    {
      kind: 'sphere',
      name: `${part.name ?? input.name ?? 'object'} right headlight`,
      position: [center[0], center[1], center[2] + width * 0.34],
      radius,
      scale: [0.55, 0.75, 1],
      material: lightMat,
    },
  ]
  return shapes
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
  const mat = partMaterial(part, material(input.primaryColor ?? '#94a3b8', 0.42, 0.46))
  const metal = material(input.metalColor ?? '#cbd5e1', 0.28, 0.78)
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator tank shell`,
      position: center,
      axis: 'y',
      radius,
      height,
      radialSegments: ringSegments(input.detail),
      material: mat,
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator motor`,
      position: [center[0], center[1] + height * 0.66, center[2]],
      axis: 'y',
      radius: radius * 0.22,
      height: radius * 0.38,
      radialSegments: 24,
      material: material(input.darkColor ?? '#1f2937', 0.5, 0.28),
    },
    {
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} agitator shaft`,
      position: [center[0], center[1] + height * 0.05, center[2]],
      axis: 'y',
      radius: radius * 0.035,
      height: height * 0.9,
      radialSegments: 12,
      material: metal,
    },
  ]
  for (let i = 0; i < 3; i += 1) {
    const angle = (i * Math.PI * 2) / 3
    shapes.push({
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} agitator blade ${i + 1}`,
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
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} access platform deck`,
      position: [center[0], center[1] + height * 0.18, center[2]],
      length,
      width,
      height: r * 0.8,
      material: steel,
    },
  ]
  for (const x of [-length / 2, length / 2]) {
    for (const z of [-width / 2, width / 2]) {
      shapes.push({
        kind: 'cylinder',
        name: `${part.name ?? input.name ?? 'object'} platform support post`,
        position: [center[0] + x, center[1] - height * 0.25, center[2] + z],
        axis: 'y',
        radius: r,
        height,
        radialSegments: 12,
        material: steel,
      })
    }
  }
  shapes.push({
    kind: 'cylinder',
    name: `${part.name ?? input.name ?? 'object'} platform guard rail front`,
    position: [center[0], center[1] + height * 0.42, center[2] + width / 2],
    axis: 'x',
    radius: r,
    height: length,
    radialSegments: 12,
    material: steel,
  })
  for (let i = 0; i < 5; i += 1) {
    shapes.push({
      kind: 'cylinder',
      name: `${part.name ?? input.name ?? 'object'} ladder rung ${i + 1}`,
      position: [
        center[0] - length * 0.62,
        center[1] - height * 0.55 + (i + 1) * height * 0.16,
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
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'box',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet body`,
      position: center,
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.035,
      cornerSegments: 4,
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
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet door seam`,
      position: [center[0] - length * 0.02, center[1], center[2] + width * 0.54],
      length: length * 0.012,
      width: width * 0.015,
      height: height * 0.82,
      material: dark,
    },
    {
      kind: 'capsule',
      name: `${part.name ?? input.name ?? 'object'} electrical cabinet handle`,
      position: [center[0] + length * 0.33, center[1] + height * 0.03, center[2] + width * 0.565],
      axis: 'y',
      radius: length * 0.018,
      height: height * 0.2,
      radialSegments: 10,
      capSegments: 3,
      material: metal,
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
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'hollow-cylinder',
      name: `${part.name ?? input.name ?? 'object'} pipe run`,
      position: center,
      axis,
      radius,
      height: length,
      wallThickness: clamp(part.depth, radius * 0.18, radius * 0.05, radius * 0.45),
      radialSegments: 24,
      material: pipeMat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} pipe run left coupling`,
      position: offsetAlongAxis(center, axis, -length / 2),
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
      position: offsetAlongAxis(center, axis, length / 2),
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
  const bendRadius = clamp(part.length ?? part.depth, radius * 4.2, radius * 1.4, 2)
  const center = add(origin, part.position ?? [0, 0.55, 0])
  const mat = partMaterial(part, material(input.primaryColor ?? '#64748b', 0.42, 0.42))
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
      material: mat,
    },
    {
      kind: 'torus',
      name: `${part.name ?? input.name ?? 'object'} elbow start rim`,
      position: [center[0] - bendRadius, center[1], center[2]],
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
      position: [center[0], center[1], center[2] + bendRadius],
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
    case 'flange_ring':
    case 'bolt_pattern':
      return [0, 0.55, 0.5]
    case 'inlet_port':
    case 'outlet_port':
    case 'pipe_port':
      return [0, 0.55, 0.45]
    case 'volute_casing':
      return [0, 0.55, 0.18]
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
    case 'cable_tray':
      return [0, 0.72, 0]
    default:
      return [0, 0, 0]
  }
}

function partHalfExtents(part: PartComposePartInput, kind: PartComposeKind | null): Vec3 {
  const axis = partAxis(part.axis, kind === 'outlet_port' ? 'x' : 'z')
  const radius = clamp(part.radius, kind === 'flange_ring' ? 0.12 : 0.08, 0.01, 2)
  const length = clamp(
    part.length ?? part.depth ?? part.height,
    kind === 'flange_ring' ? 0.035 : 0.26,
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
    case 'flange_ring':
    case 'bolt_pattern':
      return axisExtents(length / 2, radius)
    case 'pipe_port':
    case 'inlet_port':
    case 'outlet_port':
      return axisExtents(length / 2, radius)
    case 'volute_casing': {
      const r = clamp(part.radius, 0.28, 0.06, 2)
      const d = clamp(part.depth ?? part.width, r * 0.48, 0.03, 1)
      return [r, r, d / 2]
    }
    case 'rounded_machine_body':
    case 'gearbox_body':
    case 'vehicle_body':
    case 'electrical_cabinet':
      return [
        clamp(
          part.length,
          kind === 'vehicle_body' ? 1.2 : kind === 'electrical_cabinet' ? 0.55 : 0.6,
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
      const bendRadius = clamp(part.length ?? part.depth, pipeRadius * 4.2, pipeRadius * 1.4, 2)
      return [bendRadius / 2 + pipeRadius, pipeRadius, bendRadius / 2 + pipeRadius]
    }
    case 'cylindrical_tank':
    case 'heat_exchanger': {
      const r = clamp(part.radius, 0.2, 0.04, 2)
      const l = clamp(part.length ?? part.height, 0.9, 0.1, 6) / 2
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
      const bendRadius = clamp(part.length ?? part.depth, elbowRadius * 4.2, elbowRadius * 1.4, 2)
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

function resolveConnectedParts(parts: PartComposePartInput[]): PartComposePartInput[] {
  const resolved: PartComposePartInput[] = []
  const findParent = (connectTo: string | number | undefined): PartComposePartInput | undefined => {
    if (typeof connectTo === 'number') return resolved[connectTo]
    if (typeof connectTo !== 'string') return undefined
    const normalized = normalizePartKind(connectTo)
    return resolved.find(
      (part) =>
        part.id === connectTo ||
        part.name === connectTo ||
        part.kind === connectTo ||
        part.partType === connectTo ||
        (normalized !== null && normalizedPartKind(part) === normalized),
    )
  }

  parts.forEach((part) => {
    const kind = normalizedPartKind(part)
    const parent = findParent(part.connectTo)
    if (!parent || part.position) {
      resolved.push(part)
      return
    }

    const parentKind = normalizedPartKind(parent)
    const parentCenter = partCenter(parent, parentKind)
    const parentPoint = part.connectPoint ?? part.anchor ?? 'front'
    const childPoint = part.childPoint ?? part.childAnchor ?? 'back'
    resolved.push({
      ...part,
      position: add(
        add(parentCenter, connectionPointOffset(parent, parentKind, parentPoint)),
        negate(connectionPointOffset(part, kind, childPoint)),
      ),
    })
  })

  return resolved
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

  if (has('radial_blades') || has('protective_grill') || has('vertical_pole')) {
    return {
      family: 'fan',
      required: [
        group('base', ['circular_base'], { kind: 'circular_base' }),
        group('pole', ['vertical_pole'], { kind: 'vertical_pole' }),
        group('support bracket', ['support_bracket'], { kind: 'support_bracket' }),
        group('motor housing', ['motor_housing'], { kind: 'motor_housing' }),
        group('fan blades', ['radial_blades'], { kind: 'radial_blades', count: 3 }),
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

  if (has('bicycle_frame') || has('bicycle_wheels') || has('chain_loop')) {
    return {
      family: 'bicycle',
      required: [
        group('wheels', ['bicycle_wheels'], { kind: 'bicycle_wheels' }),
        group('frame', ['bicycle_frame'], { kind: 'bicycle_frame' }),
        group('fork', ['bicycle_fork'], { kind: 'bicycle_fork' }),
        group('handlebar', ['handlebar'], { kind: 'handlebar' }),
        group('saddle', ['saddle'], { kind: 'saddle' }),
        group('chain', ['chain_loop'], { kind: 'chain_loop' }),
      ],
      optional: [],
      recommendedDetails: [],
    }
  }

  if (has('vehicle_body') || has('vehicle_wheels')) {
    return {
      family: 'vehicle',
      required: [
        group('body', ['vehicle_body'], { kind: 'vehicle_body' }),
        group('wheels', ['vehicle_wheels'], { kind: 'vehicle_wheels' }),
        group('windows', ['vehicle_windows'], { kind: 'vehicle_windows' }),
        group('lights', ['headlights'], { kind: 'headlights' }),
        group('bumper', ['bumper'], { kind: 'bumper' }),
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
        group('handwheel', ['handwheel'], { kind: 'handwheel' }),
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
  'bicycle_wheels',
  'bicycle_frame',
  'bicycle_fork',
  'handlebar',
  'saddle',
  'chain_loop',
  'vehicle_body',
  'vehicle_wheels',
  'vehicle_windows',
  'headlights',
  'bumper',
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

function requestedDetails(input: PartComposeInput): boolean {
  const text = `${input.name ?? ''}`.toLowerCase()
  return /(detail|detailed|realistic|真实|细节|精细|铭牌|警示|螺栓|接缝|散热|label|nameplate|warning|bolt|seam)/i.test(
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
    vehicle: ['vehicle_windows', 'headlights', 'bumper', 'seam_ring'],
    valve: ['flange_ring', 'handwheel'],
    bicycle: ['chain_loop'],
    desk: ['drawer_stack'],
    pipe_system: ['pipe_elbow', 'flange_ring', 'valve_body'],
    electrical: ['cable_tray', 'nameplate', 'warning_label', 'vent_slats'],
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
): PartComposePartInput[] {
  const completed = dedupeSingletonBlueprintParts(parts)
  if (autoComplete === false) return completed

  for (let pass = 0; pass < 2; pass += 1) {
    const present = partKinds(completed)
    const spec = familySpecForParts(present)
    if (spec.family === 'unknown') break

    for (const requirement of spec.required) {
      if (!hasAnyPart(present, requirement)) completed.push(requirement.defaultPart)
    }
  }

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
    case 'vehicle_body':
      if (name.includes('body shell')) return 'vehicle_body'
      if (name.includes('cabin')) return 'vehicle_cabin'
      if (name.includes('deck')) return 'vehicle_deck'
      if (name.includes('rocker')) return 'vehicle_rocker'
      return 'vehicle_body_detail'
    case 'vehicle_wheels':
      if (name.includes('tire')) return 'vehicle_tire'
      if (name.includes('hub')) return 'vehicle_wheel_hub'
      return 'vehicle_wheel_detail'
    case 'vehicle_windows':
      return 'vehicle_window'
    case 'headlights':
      return 'headlight'
    case 'bumper':
      if (name.includes('front')) return 'front_bumper'
      if (name.includes('rear')) return 'rear_bumper'
      return 'bumper'
    case 'bicycle_wheels':
      if (name.includes('tire')) return 'bicycle_tire'
      if (name.includes('rim')) return 'bicycle_rim'
      if (name.includes('hub')) return 'bicycle_hub'
      if (name.includes('spoke')) return 'bicycle_spoke'
      return 'bicycle_wheel_detail'
    case 'bicycle_frame':
      return 'bicycle_frame'
    case 'bicycle_fork':
      return 'bicycle_fork'
    case 'handlebar':
      return 'handlebar'
    case 'saddle':
      return 'saddle'
    case 'chain_loop':
      return 'chain_loop'
    case 'radial_blades':
      return name.includes('blade root') ? 'fan_blade_root' : 'fan_blade'
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
    case 'valve_body':
      if (name.includes('bonnet bolt')) return 'bonnet_bolts'
      if (name.includes('bonnet')) return 'bonnet'
      if (name.includes('stem')) return 'stem'
      if (name.includes('gate wedge')) return 'gate_wedge'
      if (name.includes('yoke')) return 'yoke'
      return 'valve_body'
    default:
      return kind
  }
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
    shape.sourcePartKind ??= kind
    shape.sourcePartId ??= sourcePartId
    shape.semanticGroup ??= sourcePartId
    shape.semanticRole ??= semanticRoleForPartShape(kind, shape)
  }
}

export function composePartPrimitives(input: PartComposeInput = {}): PrimitiveShapeInput[] {
  input = normalizePartComposeInput(input)
  const origin = input.position ?? [0, 0, 0]
  const completedParts = applyVehicleLayoutDefaults(
    completePartBlueprint(input.parts ?? [], input.autoComplete),
  )
  const detailedParts = enhancePartBlueprintWithVisualDetails(completedParts, input)
  const parts = resolveConnectedParts(applyVehicleLayoutDefaults(detailedParts))
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
      case 'radial_blades':
        shapes.push(...composeRadialBlades(input, part, origin))
        break
      case 'protective_grill':
        shapes.push(...composeProtectiveGrill(input, part, origin))
        break
      case 'support_bracket':
        shapes.push(...composeSupportBracket(input, part, origin))
        break
      case 'control_knob':
        shapes.push(...composeControlKnob(input, part, origin, index))
        break
      case 'vent_slats':
        shapes.push(...composeVentSlats(input, part, origin))
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
      case 'valve_body':
        shapes.push(...composeValveBody(input, part, origin))
        break
      case 'handwheel':
        shapes.push(...composeHandwheel(input, part, origin))
        break
      case 'bicycle_wheels':
        shapes.push(...composeBicycleWheels(input, part, origin))
        break
      case 'bicycle_frame':
        shapes.push(...composeBicycleFrame(input, part, origin))
        break
      case 'bicycle_fork':
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
      case 'vehicle_body':
        shapes.push(...composeVehicleBody(input, part, origin))
        break
      case 'vehicle_wheels':
        shapes.push(...composeVehicleWheels(input, part, origin))
        break
      case 'vehicle_windows':
        shapes.push(...composeVehicleWindows(input, part, origin))
        break
      case 'headlights':
        shapes.push(...composeHeadlights(input, part, origin))
        break
      case 'bumper':
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
