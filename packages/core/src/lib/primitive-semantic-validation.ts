import type { FamilyId } from './family-registry'
import type {
  PrimitiveGeometryBrief,
  PrimitiveShapeInput,
  ResolvedPrimitiveTransform,
} from './primitive-compose'
import {
  buildPrimitiveGeometryFacts,
  type PrimitiveGeometryFacts,
  type PrimitiveShapeFact,
} from './primitive-facts'
import { hasComponentPartIntent } from './primitive-part-intent'

type SemanticFamily = FamilyId | 'unknown'

export interface PrimitiveSemanticValidationOptions {
  toolName?: string
  prompt?: string
  sourceArgs?: Record<string, unknown>
  geometryBrief?: PrimitiveGeometryBrief
}

export interface PrimitiveSemanticValidationResult {
  ok: boolean
  family: SemanticFamily
  score: number
  issues: string[]
  warnings: string[]
  recommendations: string[]
  facts: PrimitiveGeometryFacts
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sourceText(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  const parts = [args.name, args.partName, args.category, args.model].map(textOf)
  if (Array.isArray(args.parts)) {
    for (const part of args.parts) {
      if (typeof part !== 'object' || part === null) continue
      const record = part as Record<string, unknown>
      parts.push(
        textOf(record.kind),
        textOf(record.partType),
        textOf(record.type),
        textOf(record.name),
      )
    }
  }
  return parts.filter(Boolean).join(' ')
}

function detectFamily(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
): SemanticFamily {
  // Use only intent-bearing text sources, not role/partKind keys — those cause false positives
  // (e.g. wheel_set gives semanticRole='vehicle_tire' which matches /vehicle/ on aircraft,
  //  propeller_blade_set normalizes to 'mixer_blades' which matches /mixer/ on aircraft).
  const intentText = [
    options.geometryBrief?.category,
    options.prompt,
    sourceText(options.sourceArgs),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const promptIntentText = [options.geometryBrief?.category, options.prompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const declaredFamily = textOf(options.sourceArgs?.family).toLowerCase()
  const declaredLayoutFamily = textOf(options.sourceArgs?.layoutFamily).toLowerCase()
  const hasDeviceProfile = textOf(options.sourceArgs?.deviceProfile).length > 0

  if (
    hasDeviceProfile &&
    (declaredFamily === 'generic' || declaredLayoutFamily === 'generic_industrial_layout')
  ) {
    return 'unknown'
  }
  if (hasDeviceProfile) {
    if (
      declaredLayoutFamily === 'linear_transport_layout' ||
      declaredFamily === 'material_handling' ||
      declaredFamily === 'conveyor'
    ) {
      return 'material_handling'
    }
    if (
      declaredLayoutFamily === 'vessel_layout' ||
      declaredFamily === 'tank' ||
      declaredFamily === 'reactor' ||
      declaredFamily === 'heat_exchanger'
    ) {
      return 'process_equipment'
    }
    if (
      declaredLayoutFamily === 'rotating_machine_layout' ||
      declaredFamily === 'pump' ||
      declaredFamily === 'compressor' ||
      declaredFamily === 'fluid_machine'
    ) {
      return 'fluid_machine'
    }
    if (declaredLayoutFamily === 'box_enclosure_layout') {
      return 'machine_tool'
    }
  }

  if (
    /reactor|reaction[_\s-]?(kettle|vessel)|stirred[_\s-]?tank|\u53cd\u5e94\u91dc|\u53cd\u61c9\u91dc|\u53cd\u5e94\u5668|\u53cd\u61c9\u5668/.test(
      intentText,
    )
  ) {
    return 'process_equipment'
  }

  if (
    /mixer|impeller|agitator|mixing[_\s-]?paddle|mud[_\s-]?mixer|\u6ce5\u6d46\u6405\u62cc|\u6405\u62cc\u90e8\u4ef6|\u6405\u62cc\u53f6\u7247|\u53f6\u8f6e/.test(
      intentText,
    )
  ) {
    return 'mixer'
  }

  if (
    hasComponentPartIntent(promptIntentText) ||
    (!promptIntentText && hasComponentPartIntent(sourceText(options.sourceArgs).toLowerCase())) ||
    hasComponentScopedBrief(options.geometryBrief)
  ) {
    return 'unknown'
  }

  // Aircraft check first — must precede vehicle/mixer to avoid role-key false positives
  if (
    /aircraft|airplane|airliner|plane|jet|fuselage|aircraft_fuselage|aircraft_wing/.test(intentText)
  ) {
    return 'unknown'
  }

  // Role/partKind keys are only used for families whose detection cannot be faked by role names
  const rolesText = [
    Object.keys(facts.roles).join(' '),
    Object.keys(facts.sourcePartKinds).join(' '),
  ].join(' ')

  const text = `${intentText} ${rolesText}`.toLowerCase()

  if (
    /tricycle|cargo[_\s-]?trike|cargo[_\s-]?bike|rickshaw|pushcart|handcart|\u4e09\u8f6e\u8f66|\u8d27\u8fd0\u81ea\u884c\u8f66/.test(
      text,
    )
  ) {
    return 'unknown'
  }
  if (/bicycle|bike/.test(intentText)) return 'bicycle'
  if (/vehicle|sedan|suv|automobile|(?:^|[\s_-])(?:car|auto)(?:$|[\s_-])/.test(intentText)) {
    return 'vehicle'
  }
  if (/valve|gate_valve|gate valve|\u9600\u95e8|\u95f8\u9600/.test(text)) return 'valve'
  if (/robot[_\s-]?arm|cobot|manipulator|\u673a\u5668\u81c2|\u673a\u68b0\u81c2/.test(text)) {
    return 'robot_arm'
  }
  if (
    /distillation[_\s-]?(tower|column)|fractionat(?:ion|or)|rectification[_\s-]?(tower|column)|distillation_column_shell|\u84b8\u998f\u5854|\u84b8\u992e\u5854|\u7cbe\u998f\u5854|\u7cbe\u992e\u5854|\u5854\u5668/.test(
      text,
    )
  ) {
    return 'distillation_tower'
  }
  if (
    /machine_tool|cnc|lathe|machining[_\s-]?center|laser[_\s-]?cutter|\u6570\u63a7|\u8f66\u5e8a|\u52a0\u5de5\u4e2d\u5fc3|\u5207\u5272\u673a/.test(
      text,
    )
  ) {
    return 'machine_tool'
  }
  if (
    /forming_machine|injection[_\s-]?molding|hydraulic[_\s-]?press|press[_\s-]?frame|\u6ce8\u5851\u673a|\u6db2\u538b\u673a|\u51b2\u538b\u673a/.test(
      text,
    )
  ) {
    return 'forming_machine'
  }
  if (
    /material_handling|conveyor|belt_surface|roller_array|grate_cooler|cooler_grate_bed|\u8f93\u9001\u673a|\u6d41\u6c34\u7ebf|\u7be6\u51b7\u673a/.test(
      text,
    )
  ) {
    return 'material_handling'
  }
  if (
    /fluid_machine|pump|centrifugal|pump_casing|compressor|compressor_casing|\u79bb\u5fc3\u6cf5|\u6cf5|\u538b\u7f29\u673a|\u58d3\u7e2e\u6a5f/.test(
      text,
    )
  ) {
    return 'fluid_machine'
  }
  if (
    /process_equipment|heat[_\s-]?exchanger|condenser|cooler|reactor|reactor_vessel|vessel_shell|\u6362\u70ed\u5668|\u51b7\u51dd\u5668|\u51b7\u5374\u5668|\u53cd\u5e94\u91dc|\u53cd\u61c9\u91dc/.test(
      text,
    )
  ) {
    return 'process_equipment'
  }
  return 'unknown'
}

function factsBy(
  facts: PrimitiveGeometryFacts,
  predicate: (fact: PrimitiveShapeFact) => boolean,
): PrimitiveShapeFact[] {
  return facts.shapes.filter(predicate)
}

function hasRole(fact: PrimitiveShapeFact, roles: string[]): boolean {
  return fact.semanticRole != null && roles.includes(fact.semanticRole)
}

function factName(fact: PrimitiveShapeFact): string {
  return fact.name?.toLowerCase() ?? ''
}

function isVehicleBody(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['vehicle_body']) ||
    (fact.sourcePartKind === 'vehicle_body' && factName(fact).includes('body shell'))
  )
}

function isVehicleTire(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  if (name.includes('steering')) return false
  if (/arch|fender|shadow/.test(name)) return false
  if (/hub|rim|spoke|axle|cap|bolt/.test(name)) return false
  const tireLikeKind =
    fact.kind === 'torus' || fact.kind === 'cylinder' || fact.kind === 'hollow-cylinder'
  return (
    hasRole(fact, ['vehicle_tire', 'car_tire', 'car_tires', 'vehicle_tyre', 'car_tyre']) ||
    (fact.sourcePartKind === 'vehicle_wheels' && tireLikeKind && /tire|wheel/.test(name)) ||
    (tireLikeKind &&
      (/(vehicle|car).*tire/.test(name) || name.includes('tire') || name.includes('wheel')) &&
      !name.includes('bicycle'))
  )
}

function isVehicleWindow(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  return (
    hasRole(fact, ['vehicle_window', 'vehicle_glass', 'glass']) ||
    fact.sourcePartKind === 'vehicle_windows' ||
    name.includes('windshield') ||
    name.includes('window') ||
    name.includes('glass')
  )
}

function isHeadlight(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['headlight', 'vehicle_headlight']) ||
    fact.sourcePartKind === 'headlights' ||
    factName(fact).includes('headlight')
  )
}

function isBumper(fact: PrimitiveShapeFact): boolean {
  return (
    hasRole(fact, ['front_bumper', 'rear_bumper', 'bumper', 'vehicle_bumper']) ||
    fact.sourcePartKind === 'bumper' ||
    factName(fact).includes('bumper')
  )
}

function isBicycleTire(fact: PrimitiveShapeFact): boolean {
  const name = factName(fact)
  return (
    hasRole(fact, ['bicycle_tire']) ||
    (fact.sourcePartKind === 'bicycle_wheels' && fact.kind === 'torus' && name.includes('tire')) ||
    (fact.kind === 'torus' && name.includes('bicycle') && name.includes('tire'))
  )
}

function countClusters(values: number[], tolerance: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  let clusters = 0
  let current: number | undefined
  for (const value of sorted) {
    if (current == null || Math.abs(value - current) > tolerance) {
      clusters += 1
      current = value
    } else {
      current = (current + value) / 2
    }
  }
  return clusters
}

function normalizeRequiredRole(role: string): string {
  const normalized = role
    .trim()
    .toLowerCase()
    .replace(/[:=]\s*\d+$/, '')
    .replace(/[\s-]+/g, '_')

  switch (normalized) {
    case 'bicycle_wheel':
    case 'bicycle_wheels':
    case 'bike_wheel':
    case 'bike_wheels':
      return 'bicycle_wheels'
    case 'wheel_front':
    case 'front_bicycle_wheel':
    case 'bicycle_front_wheel':
      return 'front_wheel'
    case 'wheel_rear':
    case 'rear_bicycle_wheel':
    case 'bicycle_rear_wheel':
      return 'rear_wheels'
    case 'bicycle_frame':
    case 'bike_frame':
      return 'bicycle_frame'
    case 'bicycle_fork':
    case 'bike_fork':
      return 'bicycle_fork'
    case 'bike_handlebar':
    case 'bike_handlebars':
    case 'bicycle_handlebar':
    case 'bicycle_handlebars':
      return 'handlebar'
    case 'front_tire':
      return 'front_wheel'
    case 'rear_tire':
    case 'rear_tires':
      return 'rear_wheels'
    case 'car_tire':
    case 'car_tires':
    case 'auto_tire':
    case 'auto_tires':
    case 'automobile_tire':
    case 'automobile_tires':
    case 'vehicle_tire':
    case 'vehicle_tires':
    case 'tyre':
    case 'tyres':
    case 'car_tyre':
    case 'car_tyres':
    case 'vehicle_tyre':
    case 'vehicle_tyres':
      return 'vehicle_tire'
    case 'chain':
    case 'bicycle_chain':
    case 'chain_loop':
    case 'chain_drive':
    case 'bicycle_chain_drive':
    case 'drivetrain':
    case 'drive_train':
      return 'chain_loop'
    case 'bicycle_crank':
      return 'crank'
    case 'bicycle_chainring':
      return 'chainring'
    case 'pedals':
    case 'bicycle_pedal':
    case 'bicycle_pedals':
      return 'pedal'
    case 'seat':
    case 'bike_seat':
    case 'bicycle_seat':
    case 'bike_saddle':
    case 'bicycle_saddle':
    case 'saddle':
      return 'saddle'
    case 'vehicle_wheel':
    case 'vehicle_wheels':
    case 'car_wheel':
    case 'car_wheels':
      return 'vehicle_wheels'
    case 'vehicle_windows':
    case 'vehicle_window':
    case 'vehicle_glass':
    case 'car_window':
    case 'car_glass':
    case 'glass':
    case 'car_windows':
    case 'windows':
      return 'vehicle_windows'
    case 'lights':
    case 'vehicle_light':
    case 'vehicle_lights':
    case 'vehicle_headlight':
    case 'vehicle_headlights':
    case 'vehicle_taillight':
    case 'vehicle_taillights':
    case 'car_headlight':
    case 'car_headlights':
    case 'car_taillight':
    case 'car_taillights':
    case 'headlight':
    case 'headlights':
    case 'taillight':
    case 'taillights':
      return 'headlights'
    case 'vehicle_bumper':
    case 'vehicle_bumpers':
    case 'car_bumper':
    case 'car_bumpers':
    case 'bumper':
    case 'bumpers':
      return 'bumper'
    case 'base':
    case 'base_frame':
    case 'bottom_base':
    case 'skid':
    case 'skid_base':
    case 'base_skid':
    case 'pump_base':
    case 'support_base':
    case 'support_frame':
    case 'support_leg':
    case 'support_legs':
    case 'support_foot':
    case 'support_feet':
      return 'support_base'
    case 'filter_housing':
    case 'tall_housing':
    case 'collector_housing':
      return 'filter_housing'
    case 'cooler_bed':
    case 'grate_bed':
    case 'cooler_grate':
      return 'cooler_grate_bed'
    case 'cooling_air_boxes':
    case 'air_box':
    case 'air_boxes':
      return 'cooling_air_box'
    case 'inlet_chute':
    case 'feed_chute':
    case 'inlet_duct':
    case 'steam_inlet':
    case 'steam_inlet_nozzle':
      return 'inlet_port'
    case 'outlet_chute':
    case 'discharge_chute':
    case 'outlet_duct':
    case 'clean_air_outlet':
    case 'exhaust_outlet':
    case 'exhaust_outlet_nozzle':
      return 'outlet_port'
    case 'inspection_door':
    case 'inspection_doors':
    case 'access_door':
    case 'access_doors':
      return 'access_panel'
    case 'pulse_jet_headers':
    case 'pulse_header':
    case 'pulse_headers':
      return 'pulse_jet_header'
    case 'filter_bag':
    case 'filter_bags':
    case 'filter_bags_row':
    case 'filter_bag_rows':
      return 'filter_bag_row'
    case 'turbine_body':
    case 'turbine_shell':
    case 'turbine_casing':
      return 'turbine_casing'
    case 'rotor':
    case 'rotor_axis':
    case 'rotor_shaft':
      return 'rotor_shaft'
    case 'bearing':
    case 'bearings':
    case 'bearing_housings':
      return 'bearing_housing'
    case 'lubrication':
    case 'lube_unit':
      return 'lubrication_unit'
    case 'plate_stack':
    case 'plate_pack':
    case 'heat_transfer_plate_stack':
      return 'plate_stack'
    case 'heat_transfer_plates':
    case 'exchanger_plate':
    case 'exchanger_plates':
      return 'heat_transfer_plate'
    case 'fixed_frame':
    case 'fixed_end':
      return 'fixed_end_frame'
    case 'movable_pressure_plate':
    case 'end_pressure_plate':
      return 'pressure_plate'
    case 'tie_rods':
    case 'tie_bar':
    case 'tie_bars':
      return 'tie_rod'
    case 'guide_bars':
    case 'top_guide_bar':
    case 'bottom_guide_bar':
      return 'guide_bar'
    case 'pump_body':
    case 'pump_casing':
    case 'pump_volute':
    case 'volute':
    case 'volute_casing':
      return 'volute_casing'
    case 'inlet':
    case 'inlet_nozzle':
    case 'top_nozzle':
    case 'feed_nozzle':
    case 'suction':
    case 'suction_nozzle':
    case 'inlet_port':
      return 'inlet_port'
    case 'outlet':
    case 'outlet_nozzle':
    case 'discharge':
    case 'discharge_nozzle':
    case 'outlet_port':
      return 'outlet_port'
    case 'motor':
    case 'drive_motor':
    case 'motor_body':
      return 'drive_motor'
    case 'coupling':
    case 'shaft_coupling':
    case 'coupling_area':
    case 'coupling_guard':
    case 'coupling_housing':
      return 'coupling_housing'
    case 'junction_box':
    case 'control_box':
    case 'control_panel':
    case 'equipment_control_panel':
      return 'control_panel'
    case 'equipment_nameplate':
      return 'nameplate'
    case 'safety_label':
      return 'warning_label'
    case 'tank_body':
    case 'tank_shell':
    case 'cylindrical_tank':
    case 'vessel_shell':
      return 'vessel_shell'
    case 'access_ladder':
    case 'ladder':
    case 'platform_ladder':
    case 'access_platform':
      return 'access_platform'
    case 'top_manway':
    case 'manway':
    case 'manway_flange':
      return 'inlet_port'
    case 'drain_nozzle':
    case 'drain_port':
      return 'outlet_port'
    case 'robot_base_plate':
    case 'robot_pedestal':
    case 'robot_swivel':
      return 'robot_base'
    case 'robot_lower_arm':
      return 'upper_arm'
    case 'robot_upper_arm':
      return 'upper_arm'
    case 'robot_forearm':
      return 'forearm'
    case 'robot_upper_arm_joint':
      return 'shoulder_joint'
    case 'robot_forearm_joint':
      return 'elbow_joint'
    case 'robot_wrist':
    case 'wrist':
      return 'wrist_joint'
    case 'welding_torch':
    case 'torch':
      return 'end_effector'
    case 'work_table_base':
    case 'work_table_top':
      return 'work_table'
    case 'control_cabinet':
    case 'control_cabinet_body':
      return 'control_panel'
    case 'safety_barrier':
      return 'safety_barrier'
    case 'inlet_flange':
    case 'suction_flange':
    case 'flange_inlet':
      return 'flange_inlet'
    case 'outlet_flange':
    case 'discharge_flange':
    case 'flange_outlet':
      return 'flange_outlet'
    case 'bonnet_bolt':
    case 'bonnet_bolts':
    case 'bonnet_bolt_pattern':
      return 'bonnet_bolts'
    case 'mixer_blade':
    case 'mixer_blades':
    case 'agitator_blade':
    case 'agitator_blades':
    case 'impeller_blade':
    case 'impeller_blades':
      return 'mixer_blades'
    case 'mixer_rod':
    case 'mixer_shaft':
    case 'shaft':
    case 'rod':
      return 'mixer_shaft'
    case 'mixer_hub':
    case 'hub':
      return 'mixer_hub'
    case 'valve_stem':
      return 'stem'
    case 'valve_yoke':
      return 'yoke'
    case 'wedge':
    case 'gate':
    case 'gate_wedge':
      return 'gate_wedge'
    // Aircraft roles — normalize to canonical names checked by satisfiesRequiredRole
    case 'fuselage':
    case 'fuselage_body':
    case 'body_fuselage':
    case 'aircraft_body':
    case 'airplane_body':
    case 'airliner_body':
    case 'aircraft_fuselage':
    case 'aircraft_fuselage_body':
    case 'airplane_fuselage':
    case 'airplane_fuselage_body':
      return 'aircraft_fuselage'
    case 'airframe':
    case 'complete_airframe':
    case 'aircraft_airframe':
    case 'complete_aircraft':
    case 'complete_airplane':
    case 'airplane_airframe':
      return 'aircraft_complete_airframe'
    case 'main_wing':
    case 'main_wings':
    case 'aircraft_wing':
    case 'aircraft_wing_left':
    case 'aircraft_wing_right':
    case 'aircraft_left_wing':
    case 'aircraft_right_wing':
    case 'airplane_wing':
    case 'airplane_wing_left':
    case 'airplane_wing_right':
    case 'left_wing':
    case 'right_wing':
    case 'wing':
    case 'wings':
      return 'aircraft_wing'
    case 'horizontal_stabilizer':
    case 'horizontal_stab':
    case 'aircraft_tail_horizontal':
    case 'aircraft_horizontal_tail':
    case 'aircraft_horizontal_stabilizer':
    case 'airplane_tail_horizontal':
    case 'tail_horizontal':
    case 'horizontal_tail':
    case 'htail':
      return 'aircraft_horizontal_stabilizer'
    case 'vertical_stabilizer':
    case 'vertical_stab':
    case 'aircraft_tail_vertical':
    case 'aircraft_vertical_tail':
    case 'aircraft_vertical_stabilizer':
    case 'airplane_tail_vertical':
    case 'tail_vertical':
    case 'vertical_tail':
    case 'vtail':
    case 'tail_fin':
      return 'aircraft_vertical_stabilizer'
    case 'propeller':
    case 'aircraft_propeller':
    case 'airplane_propeller':
      return 'aircraft_propeller'
    case 'landing_gear':
    case 'aircraft_landing_gear':
    case 'aircraft_landing_gear_main':
    case 'aircraft_main_landing_gear':
    case 'main_landing_gear':
    case 'landing_gear_main':
      return 'aircraft_landing_gear_main'
    case 'nose_gear':
    case 'nose_wheel':
    case 'aircraft_landing_gear_nose':
    case 'aircraft_nose_landing_gear':
    case 'landing_gear_nose':
      return 'aircraft_landing_gear_nose'
    case 'aircraft_window':
    case 'aircraft_windows':
    case 'cabin_window':
    case 'cabin_windows':
    case 'aircraft_cabin_window':
    case 'aircraft_cabin_windows':
    case 'cockpit_window':
    case 'cockpit_windows':
    case 'aircraft_cockpit_window':
    case 'aircraft_cockpit_windows':
      return 'aircraft_window'
    case 'aircraft_main_wing':
    case 'aircraft_wings':
      return 'aircraft_wing'
    case 'engine':
    case 'engines':
    case 'aircraft_engine':
    case 'aircraft_engines':
    case 'engine_nacelle':
    case 'aircraft_engine_nacelle':
    case 'nacelle':
      return 'aircraft_engine_nacelle'
    case 'engine_nacelle_left':
    case 'aircraft_engine_left':
    case 'aircraft_left_engine':
    case 'left_engine_nacelle':
    case 'left_engine':
    case 'aircraft_engine_nacelle_left':
    case 'aircraft_left_engine_nacelle':
      return 'engine_nacelle_left'
    case 'engine_nacelle_right':
    case 'aircraft_engine_right':
    case 'aircraft_right_engine':
    case 'right_engine_nacelle':
    case 'right_engine':
    case 'aircraft_engine_nacelle_right':
    case 'aircraft_right_engine_nacelle':
      return 'engine_nacelle_right'
    case 'steering_wheel':
    case 'steering':
    case 'steering_rim':
    case 'steering_wheel_outer_rim':
    case 'wheel_rim':
      return 'steering_wheel_rim'
    case 'steering_wheel_center':
    case 'steering_center':
    case 'steering_hub':
    case 'steering_wheel_center_hub':
    case 'center_hub':
    case 'centre_hub':
    case 'central_hub':
    case 'wheel_center_hub':
      return 'steering_wheel_hub'
    case 'spoke':
    case 'spokes':
    case 'steering_spoke':
    case 'steering_spokes':
    case 'steering_wheel_spokes':
    case 'wheel_spoke':
    case 'wheel_spokes':
      return 'steering_wheel_spoke'
    default:
      return normalized
  }
}

function requiredRoles(brief: PrimitiveGeometryBrief | undefined): string[] {
  return Array.from(
    new Set(
      [...(brief?.requiredRoles ?? []), ...(brief?.semanticRoles ?? [])].map(normalizeRequiredRole),
    ),
  )
}

function roleAliases(sourceArgs: Record<string, unknown> | undefined, role: string): string[] {
  const aliases = sourceArgs?.roleAliases
  if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) return []
  const raw = (aliases as Record<string, unknown>)[role]
  return Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(normalizeRequiredRole)
    : []
}

const INDUSTRIAL_SOFT_REQUIRED_ROLES = new Set([
  'access_panel',
  'access_platform',
  'support_base',
  'pulse_jet_header',
  'filter_bag_row',
  'inspection_door',
  'control_panel',
  'display_screen',
  'vent_panel',
  'lubrication_unit',
  'bearing_housing',
  'tie_rod',
  'guide_bar',
])

const INDUSTRIAL_HARD_REQUIRED_ROLES = new Set([
  'cooler_grate_bed',
  'cooler_housing',
  'filter_housing',
  'turbine_casing',
  'plate_stack',
  'heat_transfer_plate',
  'volute_casing',
  'vessel_shell',
  'inlet_port',
  'outlet_port',
])

function isIndustrialFamily(family: SemanticFamily): boolean {
  return (
    family === 'machine_tool' ||
    family === 'distillation_tower' ||
    family === 'forming_machine' ||
    family === 'material_handling' ||
    family === 'fluid_machine' ||
    family === 'process_equipment' ||
    family === 'unknown'
  )
}

function shouldSoftFailRequiredRole(role: string, family: SemanticFamily): boolean {
  if (!isIndustrialFamily(family)) return false
  if (INDUSTRIAL_HARD_REQUIRED_ROLES.has(role)) return false
  return (
    INDUSTRIAL_SOFT_REQUIRED_ROLES.has(role) ||
    /door|panel|platform|ladder|support|guard|bolt|label|header|row|rod|bar|unit|housing/.test(role)
  )
}

function hasComponentScopedBrief(brief: PrimitiveGeometryBrief | undefined): boolean {
  const category = brief?.category?.toLowerCase() ?? ''
  if (!/(vehicle|car|automobile|auto|bicycle|bike|cycle)/.test(category)) return false

  const roles = requiredRoles(brief)
  if (roles.length === 0) return false

  const completeVehicleRoles = new Set([
    'body_shell',
    'wheel_set',
    'window_strip',
    'light_pair',
    'bar_pair',
    'vehicle_body',
    'vehicle_tire',
    'vehicle_window',
    'vehicle_headlight',
    'vehicle_taillight',
    'headlight',
    'taillight',
    'front_bumper',
    'rear_bumper',
    'bumper',
    'vehicle_bumper',
    'bicycle_frame',
    'bicycle_fork',
    'handlebar',
    'saddle',
    'chain_loop',
  ])
  if (roles.some((role) => completeVehicleRoles.has(role))) return false

  return roles.some((role) =>
    /steering|mirror|dashboard|seat|wiper|door|handle|windshield|wheel|tire|tyre|rim|hub|spoke|component|part|accessory|subpart/.test(
      role,
    ),
  )
}

function satisfiesRequiredRole(facts: PrimitiveGeometryFacts, role: string): boolean {
  if ((facts.roles[role] ?? 0) > 0) return true
  if ((facts.sourcePartKinds[role] ?? 0) > 0) return true
  const hasText = (pattern: RegExp) =>
    facts.shapes.some((fact) =>
      pattern.test(
        `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
      ),
    )

  switch (role) {
    case 'support_base':
      return (
        (facts.roles.support_base ?? 0) > 0 ||
        (facts.roles.machine_base ?? 0) > 0 ||
        (facts.roles.skid_base ?? 0) > 0 ||
        (facts.roles.support_leg ?? 0) > 0 ||
        (facts.roles.support_foot ?? 0) > 0 ||
        (facts.sourcePartKinds.skid_base ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_base ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_foot_set ?? 0) > 0 ||
        hasText(/support|skid|base|leg|foot/)
      )
    case 'filter_housing':
      return (
        (facts.roles.filter_housing ?? 0) > 0 ||
        (facts.roles.machine_enclosure ?? 0) > 0 ||
        (facts.roles.main_body ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_body ?? 0) > 0 ||
        hasText(/filter.*housing|baghouse|collector.*housing|main.*body/)
      )
    case 'cooler_grate_bed':
      return hasText(/grate|cooler.*bed|bed.*cooler|belt_surface/)
    case 'cooler_housing':
      return hasText(/cooler.*housing|housing.*cooler|enclosure|body|shell/)
    case 'cooling_air_box':
      return hasText(/air.*box|cooling.*box|plenum|under.?grate/)
    case 'access_panel':
      return (
        (facts.roles.access_panel ?? 0) > 0 ||
        (facts.roles.panel ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_panel ?? 0) > 0 ||
        hasText(/access|inspection|door|panel|hatch/)
      )
    case 'pulse_jet_header':
      return hasText(/pulse|header|manifold|pipe|tube/)
    case 'filter_bag_row':
      return hasText(/filter.*bag|bag.*row|bag.*array|internal.*filter|panel/)
    case 'inlet_port':
      return (
        (facts.roles.inlet_port ?? 0) > 0 ||
        (facts.roles.feed_chute ?? 0) > 0 ||
        (facts.roles.inlet_chute ?? 0) > 0 ||
        (facts.roles.inlet_duct ?? 0) > 0 ||
        hasText(/inlet|suction|feed.*chute|infeed|material.*in|steam.*in/)
      )
    case 'outlet_port':
      return (
        (facts.roles.outlet_port ?? 0) > 0 ||
        (facts.roles.discharge_chute ?? 0) > 0 ||
        (facts.roles.outlet_chute ?? 0) > 0 ||
        (facts.roles.outlet_duct ?? 0) > 0 ||
        (facts.roles.clean_air_outlet ?? 0) > 0 ||
        hasText(/outlet|discharge|exhaust|outfeed|clean.*air|material.*out/)
      )
    case 'turbine_casing':
      return (
        (facts.roles.turbine_casing ?? 0) > 0 ||
        (facts.roles.compressor_casing ?? 0) > 0 ||
        (facts.sourcePartKinds.rounded_machine_body ?? 0) > 0 ||
        hasText(/turbine.*casing|casing.*turbine|rounded.*body|machine.*body/)
      )
    case 'rotor_shaft':
      return hasText(/rotor|shaft|axis|spindle/)
    case 'bearing_housing':
      return hasText(/bearing|pedestal|end.*cap|housing/)
    case 'lubrication_unit':
      return hasText(/lubrication|lube|oil|control|box/)
    case 'plate_stack':
      return hasText(/plate.*stack|stack.*plate|plate.*pack|main.*body/)
    case 'heat_transfer_plate':
      return hasText(/heat.*transfer.*plate|exchanger.*plate|plate/)
    case 'fixed_end_frame':
      return hasText(/fixed.*frame|end.*frame|frame/)
    case 'pressure_plate':
      return hasText(/pressure.*plate|movable.*plate|end.*plate|panel/)
    case 'tie_rod':
      return hasText(/tie.*rod|tie.*bar|rod|rail/)
    case 'guide_bar':
      return hasText(/guide.*bar|guide.*rail|rail/)
    case 'steering_wheel_rim':
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return (
          /steering.*(rim|wheel|ring)|(rim|wheel|ring).*steering/.test(text) ||
          fact.kind === 'torus'
        )
      })
    case 'steering_wheel_hub':
      if ((facts.roles.center_hub ?? 0) > 0) return true
      if ((facts.roles.centre_hub ?? 0) > 0) return true
      if ((facts.roles.central_hub ?? 0) > 0) return true
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /(steering|wheel|方向盘).*(hub|center|centre|中央|中心)|(hub|center|centre|中央|中心).*(steering|wheel|方向盘)/.test(
          text,
        )
      })
    case 'steering_wheel_spoke':
      if ((facts.roles.spoke ?? 0) > 0) return true
      if ((facts.roles.spokes ?? 0) > 0) return true
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /(steering|wheel|方向盘).*spoke|spoke.*(steering|wheel|方向盘)|辐条/.test(text)
      })
    case 'wheel':
    case 'wheels':
    case 'wheelset':
      return facts.shapes.some((fact) => {
        const text = `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`
          .toLowerCase()
          .trim()
        return /(wheel|tire|tyre)/.test(text) || fact.kind === 'torus'
      })
    case 'front_wheel':
      if ((facts.roles.bicycle_tire ?? 0) >= 2) return true
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /front.*(wheel|tire|tyre)|(wheel|tire|tyre).*front/.test(text)
      })
    case 'rear_wheel':
    case 'rear_wheels':
      if ((facts.roles.bicycle_tire ?? 0) >= 2) return true
      return facts.shapes.some((fact) => {
        const text =
          `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase()
        return /rear.*(wheel|tire|tyre)|(wheel|tire|tyre).*rear/.test(text)
      })
    case 'frame':
      return (facts.roles.bicycle_frame ?? 0) > 0 || (facts.sourcePartKinds.bicycle_frame ?? 0) > 0
    case 'fork':
    case 'front_fork':
      return (facts.roles.bicycle_fork ?? 0) > 0 || (facts.sourcePartKinds.bicycle_fork ?? 0) > 0
    case 'bicycle_wheels':
      return (facts.sourcePartKinds.bicycle_wheels ?? 0) > 0 || (facts.roles.bicycle_tire ?? 0) >= 2
    case 'handlebar':
      return (
        (facts.roles.handlebar ?? 0) > 0 ||
        (facts.roles.bicycle_handlebar ?? 0) > 0 ||
        (facts.roles.bicycle_handlebars ?? 0) > 0 ||
        (facts.sourcePartKinds.handlebar ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /handlebar|handlebars/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'saddle':
      return (
        (facts.roles.saddle ?? 0) > 0 ||
        (facts.roles.bicycle_saddle ?? 0) > 0 ||
        (facts.roles.bicycle_seat ?? 0) > 0 ||
        (facts.roles.seat ?? 0) > 0 ||
        (facts.sourcePartKinds.saddle ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /saddle|seat/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'crank':
      return (
        (facts.roles.crank ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /crank|bottom.bracket/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'chainring':
      return (
        (facts.roles.chainring ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /chainring|front.sprocket/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'pedal':
      return (
        (facts.roles.pedal ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /pedal/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'chain_loop':
      return (
        (facts.roles.chain_loop ?? 0) > 0 ||
        (facts.roles.chain_drive ?? 0) > 0 ||
        (facts.sourcePartKinds.chain_loop ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /chain|drivetrain|drive.train|chainring|sprocket/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'vehicle_tire':
      return factsBy(facts, isVehicleTire).length > 0
    case 'vehicle_wheels':
      return (facts.sourcePartKinds.vehicle_wheels ?? 0) > 0 || (facts.roles.vehicle_tire ?? 0) >= 4
    case 'vehicle_windows':
      return (
        (facts.sourcePartKinds.vehicle_windows ?? 0) > 0 ||
        (facts.roles.vehicle_window ?? 0) > 0 ||
        (facts.roles.vehicle_glass ?? 0) > 0 ||
        (facts.roles.glass ?? 0) > 0
      )
    case 'headlights':
      return (
        (facts.sourcePartKinds.headlights ?? 0) > 0 ||
        (facts.sourcePartKinds.light_pair ?? 0) > 0 ||
        (facts.roles.headlight ?? 0) +
          (facts.roles.vehicle_headlight ?? 0) +
          (facts.roles.vehicle_taillight ?? 0) +
          (facts.roles.taillight ?? 0) >=
          2
      )
    case 'bumper':
      return (
        (facts.sourcePartKinds.bumper ?? 0) > 0 ||
        (facts.roles.vehicle_bumper ?? 0) >= 2 ||
        ((facts.roles.front_bumper ?? 0) > 0 && (facts.roles.rear_bumper ?? 0) > 0)
      )
    case 'control_panel':
      return (
        (facts.roles.control_panel ?? 0) > 0 ||
        (facts.roles.control_box ?? 0) > 0 ||
        (facts.roles.control_detail ?? 0) > 0 ||
        (facts.sourcePartKinds.control_box ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_control_panel ?? 0) > 0
      )
    case 'display_screen':
      return (
        (facts.roles.display_screen ?? 0) > 0 ||
        (facts.roles.display ?? 0) > 0 ||
        (facts.roles.control_panel ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_display ?? 0) > 0 ||
        hasText(/display|screen|hmi|control/)
      )
    case 'vent_panel':
      return (
        (facts.roles.vent_panel ?? 0) > 0 ||
        (facts.roles.detail_accent ?? 0) > 0 ||
        (facts.sourcePartKinds.generic_detail_accent ?? 0) > 0 ||
        hasText(/vent|louver|slat|detail|accent|panel/)
      )
    case 'drive_motor':
      return (
        (facts.roles.drive_motor ?? 0) > 0 ||
        (facts.roles.motor_body ?? 0) > 0 ||
        (facts.sourcePartKinds.ribbed_motor_body ?? 0) > 0
      )
    case 'coupling_housing':
      return (
        (facts.roles.coupling_housing ?? 0) > 0 ||
        (facts.roles.shaft_coupling ?? 0) > 0 ||
        ((facts.roles.drive_motor ?? 0) > 0 && (facts.roles.volute_casing ?? 0) > 0)
      )
    case 'flange_inlet':
      return (
        (facts.roles.flange_inlet ?? 0) > 0 ||
        (facts.roles.inlet_flange ?? 0) > 0 ||
        (facts.roles.flange ?? 0) > 0 ||
        (facts.sourcePartKinds.flange_ring ?? 0) > 0
      )
    case 'flange_outlet':
      return (
        (facts.roles.flange_outlet ?? 0) > 0 ||
        (facts.roles.outlet_flange ?? 0) > 0 ||
        (facts.roles.flange ?? 0) > 0 ||
        (facts.sourcePartKinds.flange_ring ?? 0) > 0
      )
    case 'vessel_shell':
      return (
        (facts.roles.vessel_shell ?? 0) > 0 ||
        (facts.roles.cylindrical_tank ?? 0) > 0 ||
        (facts.sourcePartKinds.cylindrical_tank ?? 0) > 0
      )
    case 'access_platform':
      return (
        (facts.roles.access_platform ?? 0) > 0 ||
        (facts.roles.platform_ladder ?? 0) > 0 ||
        (facts.sourcePartKinds.platform_ladder ?? 0) > 0
      )
    case 'work_table':
      return (
        (facts.roles.work_table ?? 0) > 0 ||
        (facts.roles.fixture_table ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /work.?table|fixture.?table/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'safety_barrier':
      return (
        (facts.roles.safety_barrier ?? 0) > 0 ||
        facts.shapes.some((fact) =>
          /safety.?barrier|guard.?rail|fence/.test(
            `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'mixer_blades':
      return (facts.roles.mixer_blade ?? 0) >= 3 || (facts.sourcePartKinds.mixer_blades ?? 0) >= 3
    case 'mixer_shaft':
      return (facts.roles.mixer_shaft ?? 0) > 0 || (facts.sourcePartKinds.mixer_shaft ?? 0) > 0
    case 'mixer_hub':
      return (facts.roles.mixer_hub ?? 0) > 0 || (facts.sourcePartKinds.mixer_hub ?? 0) > 0
    // Aircraft roles — satisfied by semanticRole, sourcePartKind, or compatible part kinds
    case 'aircraft_fuselage':
      return (
        (facts.roles.aircraft_fuselage ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_fuselage ?? 0) > 0 ||
        (facts.sourcePartKinds.streamlined_body ?? 0) > 0 ||
        (facts.roles.fuselage ?? 0) > 0
      )
    case 'aircraft_complete_airframe':
      return (
        satisfiesRequiredRole(facts, 'aircraft_fuselage') &&
        satisfiesRequiredRole(facts, 'aircraft_wing') &&
        satisfiesRequiredRole(facts, 'aircraft_horizontal_stabilizer') &&
        satisfiesRequiredRole(facts, 'aircraft_vertical_stabilizer')
      )
    case 'aircraft_wing':
      return (
        (facts.roles.aircraft_wing ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_wing ?? 0) > 0 ||
        (facts.sourcePartKinds.airfoil_blade ?? 0) > 0 ||
        (facts.sourcePartKinds.lofted_panel ?? 0) > 0 ||
        (facts.roles.main_wing ?? 0) > 0 ||
        (facts.roles.wing ?? 0) > 0
      )
    case 'aircraft_horizontal_stabilizer':
      return (
        (facts.roles.aircraft_horizontal_stabilizer ?? 0) > 0 ||
        (facts.roles.horizontal_stabilizer ?? 0) > 0 ||
        (facts.roles.htail ?? 0) > 0 ||
        facts.shapes.some((f) =>
          /horizontal.stab|h.stab|htail/.test(
            `${f.semanticRole ?? ''} ${f.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'aircraft_vertical_stabilizer':
      return (
        (facts.roles.aircraft_vertical_stabilizer ?? 0) > 0 ||
        (facts.roles.vertical_stabilizer ?? 0) > 0 ||
        (facts.roles.tail_fin ?? 0) > 0 ||
        (facts.roles.vtail ?? 0) > 0 ||
        facts.shapes.some((f) =>
          /vertical.stab|v.stab|vtail|tail.fin/.test(
            `${f.semanticRole ?? ''} ${f.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'aircraft_propeller':
      return (
        (facts.roles.aircraft_propeller ?? 0) > 0 ||
        (facts.sourcePartKinds.propeller_blade_set ?? 0) > 0 ||
        (facts.sourcePartKinds.mixer_blades ?? 0) > 0 ||
        (facts.roles.propeller ?? 0) > 0 ||
        (facts.roles.mixer_blade ?? 0) >= 2
      )
    case 'aircraft_landing_gear_main':
      return (
        (facts.roles.aircraft_landing_gear_main ?? 0) > 0 ||
        (facts.roles.landing_gear_wheel ?? 0) >= 2 ||
        (facts.roles.landing_gear ?? 0) > 0 ||
        (facts.sourcePartKinds.wheel_set ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_landing_gear ?? 0) > 0 ||
        facts.shapes.some((f) =>
          /landing.gear|main.gear/.test(`${f.semanticRole ?? ''} ${f.name ?? ''}`.toLowerCase()),
        )
      )
    case 'aircraft_landing_gear_nose':
      return (
        (facts.roles.aircraft_landing_gear_nose ?? 0) > 0 ||
        (facts.roles.landing_gear_wheel ?? 0) > 0 ||
        (facts.roles.nose_wheel ?? 0) > 0 ||
        (facts.roles.nose_gear ?? 0) > 0 ||
        facts.shapes.some((f) =>
          /nose.gear|nose.wheel/.test(`${f.semanticRole ?? ''} ${f.name ?? ''}`.toLowerCase()),
        )
      )
    case 'aircraft_window':
      return (
        (facts.roles.aircraft_window ?? 0) > 0 ||
        (facts.roles.cabin_window ?? 0) > 0 ||
        (facts.roles.cockpit_window ?? 0) > 0 ||
        (facts.sourcePartKinds.window_strip ?? 0) > 0 ||
        (facts.sourcePartKinds.window_panel ?? 0) > 0
      )
    case 'aircraft_engine_nacelle':
      return (
        (facts.roles.aircraft_engine_nacelle ?? 0) > 0 ||
        (facts.roles.engine_nacelle ?? 0) > 0 ||
        (facts.roles.engine_nacelle_left ?? 0) > 0 ||
        (facts.roles.engine_nacelle_right ?? 0) > 0 ||
        (facts.roles.nacelle ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_engine ?? 0) > 0 ||
        facts.shapes.some((f) =>
          /nacelle|engine.pod|engine.mount/.test(
            `${f.semanticRole ?? ''} ${f.name ?? ''}`.toLowerCase(),
          ),
        )
      )
    case 'engine_nacelle_left':
      return (
        (facts.roles.engine_nacelle_left ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_engine ?? 0) > 0 ||
        (facts.roles.engine_nacelle ?? 0) >= 2 ||
        facts.shapes.some((f) => /left.*nacelle|nacelle.*left/.test(factName(f)))
      )
    case 'engine_nacelle_right':
      return (
        (facts.roles.engine_nacelle_right ?? 0) > 0 ||
        (facts.sourcePartKinds.aircraft_engine ?? 0) > 0 ||
        (facts.roles.engine_nacelle ?? 0) >= 2 ||
        facts.shapes.some((f) => /right.*nacelle|nacelle.*right/.test(factName(f)))
      )
    default:
      return false
  }
}

function requestedRed(options: PrimitiveSemanticValidationOptions): boolean {
  const text = [
    options.prompt,
    options.geometryBrief?.category,
    sourceText(options.sourceArgs),
    textOf(options.sourceArgs?.primaryColor),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /\bred\b|#cc0000|#ff0000|红色|紅色/.test(text)
}

function isRedColor(color: string | undefined): boolean {
  if (!color) return false
  const normalized = color.trim().toLowerCase()
  if (normalized === 'red') return true
  const hex = normalized.match(/^#?([0-9a-f]{6})$/)
  if (!hex) return false
  const value = hex[1]
  if (!value) return false
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return r >= 150 && g <= 90 && b <= 90
}

function validateRequiredRoles(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
  family: SemanticFamily,
  issues: string[],
  warnings: string[],
) {
  for (const role of requiredRoles(options.geometryBrief)) {
    const aliases = roleAliases(options.sourceArgs, role)
    if (
      !satisfiesRequiredRole(facts, role) &&
      !aliases.some((alias) => satisfiesRequiredRole(facts, alias))
    ) {
      const message = `required semantic role "${role}" is missing.`
      if (shouldSoftFailRequiredRole(role, family)) {
        warnings.push(message)
      } else {
        issues.push(message)
      }
    }
  }
}

function validateVehicle(
  facts: PrimitiveGeometryFacts,
  options: PrimitiveSemanticValidationOptions,
  issues: string[],
  warnings: string[],
) {
  const bodies = factsBy(facts, isVehicleBody)
  const body = bodies[0]
  const tires = factsBy(facts, isVehicleTire)
  const windows = factsBy(facts, isVehicleWindow)
  const headlights = factsBy(facts, isHeadlight)
  const bumpers = factsBy(facts, isBumper)

  if (bodies.length !== 1) {
    issues.push(`vehicle requires exactly 1 main body shell, got ${bodies.length}.`)
  }
  if (tires.length !== 4) {
    issues.push(`vehicle requires exactly 4 tires arranged as two axles, got ${tires.length}.`)
  }
  if (windows.length === 0) issues.push('vehicle requires windows/glass above the body.')
  if (headlights.length < 2) {
    issues.push(`vehicle requires left/right headlights, got ${headlights.length}.`)
  }
  if (bumpers.length < 2) {
    issues.push(`vehicle requires front and rear bumper bars, got ${bumpers.length}.`)
  }

  if (body && tires.length === 4) {
    const averageTireRadius =
      tires.reduce((total, tire) => total + Math.max(tire.halfExtents[1], tire.halfExtents[2]), 0) /
      tires.length
    const tolerance = Math.max(0.04, averageTireRadius * 1.15)
    if (
      countClusters(
        tires.map((tire) => tire.center[0]),
        tolerance,
      ) < 2
    ) {
      issues.push(
        'vehicle tires must form two separated front/rear axle positions along the length axis.',
      )
    }
    if (
      countClusters(
        tires.map((tire) => tire.center[2]),
        tolerance,
      ) < 2
    ) {
      issues.push('vehicle tires must form left/right pairs across the body width.')
    }
    const bodyWidth = body.max[2] - body.min[2]
    const tireSpread =
      Math.max(...tires.map((tire) => tire.center[2])) -
      Math.min(...tires.map((tire) => tire.center[2]))
    if (tireSpread < bodyWidth * 0.55) {
      warnings.push(
        'vehicle tire width spread is narrow; wheels may read as hidden under the body.',
      )
    }
  }

  if (body && windows.length > 0 && windows.some((window) => window.center[1] <= body.center[1])) {
    issues.push('vehicle windows must sit above the main body centerline.')
  }

  if (body && headlights.length > 0) {
    const frontLimit = body.max[0] - (body.max[0] - body.min[0]) * 0.18
    const rearLimit = body.min[0] + (body.max[0] - body.min[0]) * 0.18
    if (
      !headlights.some((light) => light.center[0] >= frontLimit || light.center[0] <= rearLimit)
    ) {
      issues.push('vehicle headlights must be placed near one longitudinal end of the body.')
    }
  }

  if (body && bumpers.length >= 2) {
    const frontLimit = body.max[0] - (body.max[0] - body.min[0]) * 0.18
    const rearLimit = body.min[0] + (body.max[0] - body.min[0]) * 0.18
    const hasPositiveEndBumper = bumpers.some((bumper) => bumper.center[0] >= frontLimit)
    const hasNegativeEndBumper = bumpers.some((bumper) => bumper.center[0] <= rearLimit)
    const namedFrontRear =
      bumpers.some(
        (bumper) => hasRole(bumper, ['front_bumper']) || factName(bumper).includes('front'),
      ) &&
      bumpers.some(
        (bumper) => hasRole(bumper, ['rear_bumper']) || factName(bumper).includes('rear'),
      ) &&
      Math.max(...bumpers.map((bumper) => bumper.center[0])) -
        Math.min(...bumpers.map((bumper) => bumper.center[0])) >=
        (body.max[0] - body.min[0]) * 0.5
    if (!hasPositiveEndBumper && !namedFrontRear) {
      issues.push('vehicle needs a front bumper at the positive length end.')
    }
    if (!hasNegativeEndBumper && !namedFrontRear) {
      issues.push('vehicle needs a rear bumper at the negative length end.')
    }
  }

  if (body && requestedRed(options) && !isRedColor(body.materialColor)) {
    issues.push('requested red vehicle body, but the main body material is not red.')
  }
}

function validateBicycle(facts: PrimitiveGeometryFacts, issues: string[], warnings: string[]) {
  const tires = factsBy(facts, isBicycleTire)
  if (tires.length !== 2) {
    issues.push(
      `bicycle requires exactly 2 tires from one bicycle_wheels wheelset, got ${tires.length}.`,
    )
  }

  const requiredRoles = ['bicycle_frame', 'bicycle_fork', 'handlebar', 'saddle', 'chain_loop']
  for (const role of requiredRoles) {
    if (!satisfiesRequiredRole(facts, role)) issues.push(`bicycle requires ${role}.`)
  }

  if (tires.length === 2) {
    const groundYs = tires.map((tire) => tire.min[1])
    const delta = Math.abs((groundYs[0] ?? 0) - (groundYs[1] ?? 0))
    if (delta > 0.03) issues.push('bicycle tires must share the same ground/contact height.')
    const axleDistance = Math.abs((tires[0]?.center[0] ?? 0) - (tires[1]?.center[0] ?? 0))
    if (
      axleDistance <
      Math.max(tires[0]?.halfExtents[1] ?? 0.1, tires[1]?.halfExtents[1] ?? 0.1) * 1.8
    ) {
      warnings.push(
        'bicycle wheelbase is very short; the silhouette may read as a cart wheel pair.',
      )
    }
  }
}

function validateMixer(facts: PrimitiveGeometryFacts, issues: string[], warnings: string[]) {
  const shafts = factsBy(facts, (fact) => hasRole(fact, ['mixer_shaft', 'agitator_shaft']))
  const hubs = factsBy(facts, (fact) =>
    hasRole(fact, ['mixer_hub', 'agitator_hub', 'reactor_impeller_hub']),
  )
  const blades = factsBy(facts, (fact) => hasRole(fact, ['mixer_blade', 'reactor_impeller']))

  if (shafts.length < 1) issues.push('mixer requires one readable vertical shaft/rod.')
  if (hubs.length < 1) issues.push('mixer requires a lower hub connecting blades to the shaft.')
  if (blades.length < 3) {
    issues.push(`mixer requires at least 3 radial flat blades, got ${blades.length}.`)
  }

  const shaft = shafts[0]
  if (shaft && shaft.min[1] > 0.04) warnings.push('mixer shaft is floating above the ground plane.')

  if (shaft && blades.length >= 3) {
    const shaftRadius = Math.max(shaft.halfExtents[0], shaft.halfExtents[2])
    const radialCenters = blades.map((blade) =>
      Math.hypot(blade.center[0] - shaft.center[0], blade.center[2] - shaft.center[2]),
    )
    if (Math.min(...radialCenters) < shaftRadius * 1.5) {
      issues.push('mixer blades must extend radially outward from the shaft, not overlap the rod.')
    }
    if (blades.some((blade) => blade.center[1] > shaft.center[1])) {
      warnings.push(
        'mixer blades are high on the shaft; common mud mixer paddles sit near the lower end.',
      )
    }
  }
}

function hasAnyRole(facts: PrimitiveGeometryFacts, roles: string[]): boolean {
  return roles.some((role) => {
    if ((facts.roles[role] ?? 0) > 0 || (facts.sourcePartKinds[role] ?? 0) > 0) return true
    if (role === 'inlet_port') {
      return hasAnyRole(facts, [
        'top_nozzle',
        'feed_nozzle',
        'inlet_nozzle',
        'suction_nozzle',
        'manway',
        'manway_flange',
      ])
    }
    if (role === 'outlet_port') {
      return hasAnyRole(facts, ['drain_nozzle', 'discharge_nozzle', 'outlet_nozzle'])
    }
    return false
  })
}

function validateIndustrialFamily(
  family: SemanticFamily,
  facts: PrimitiveGeometryFacts,
  issues: string[],
) {
  if (family === 'machine_tool') {
    if (!hasAnyRole(facts, ['machine_base', 'machine_bed', 'cutting_table'])) {
      issues.push('machine tool requires a readable base/bed/cutting table.')
    }
    if (
      !hasAnyRole(facts, [
        'spindle_head',
        'spindle_chuck',
        'tool_head',
        'laser_head',
        'grinding_wheel',
        'milling_cutter',
        'drill_bit',
      ])
    ) {
      issues.push('machine tool requires a readable spindle/chuck/tool/laser head.')
    }
    if (!hasAnyRole(facts, ['control_panel'])) {
      issues.push('machine tool requires a visible control panel.')
    }
  }
  if (family === 'forming_machine') {
    if (!hasAnyRole(facts, ['press_frame']))
      issues.push('forming machine requires a press/clamp frame.')
    if (!hasAnyRole(facts, ['machine_base', 'press_bed'])) {
      issues.push('forming machine requires a base or press bed.')
    }
    if (!hasAnyRole(facts, ['control_panel'])) {
      issues.push('forming machine requires a visible control panel.')
    }
  }
  if (family === 'material_handling') {
    const grateCoolerIntent = facts.shapes.some((fact) =>
      /grate|cooler/.test(
        `${fact.semanticRole ?? ''} ${fact.sourcePartKind ?? ''} ${fact.name ?? ''}`.toLowerCase(),
      ),
    )
    const isGrateCooler =
      (grateCoolerIntent && satisfiesRequiredRole(facts, 'cooler_grate_bed')) ||
      (grateCoolerIntent && satisfiesRequiredRole(facts, 'cooler_housing'))
    if (isGrateCooler) {
      if (!satisfiesRequiredRole(facts, 'cooler_grate_bed')) {
        issues.push('grate cooler requires a readable grate bed.')
      }
      if (!satisfiesRequiredRole(facts, 'cooling_air_box')) {
        issues.push('grate cooler requires visible under-grate cooling air boxes.')
      }
      return
    }
    if (!hasAnyRole(facts, ['conveyor_frame', 'press_frame_rails', 'support_frame'])) {
      issues.push('material handling equipment requires a conveyor/frame structure.')
    }
    if (
      !hasAnyRole(facts, ['belt_surface', 'roller_array', 'filter_plate_stack', 'screw_flight'])
    ) {
      issues.push('material handling equipment requires a belt surface or roller array.')
    }
  }
  if (family === 'fluid_machine') {
    if (!hasAnyRole(facts, ['pump_casing', 'compressor_casing', 'volute_casing'])) {
      issues.push('fluid machine requires a readable pump/compressor casing.')
    }
    for (const role of ['inlet_port', 'outlet_port']) {
      if (!hasAnyRole(facts, [role])) issues.push(`fluid machine requires ${role}.`)
    }
  }
  if (family === 'process_equipment') {
    if (!hasAnyRole(facts, ['heat_exchanger_shell', 'reactor_vessel_shell', 'vessel_shell'])) {
      issues.push('process equipment requires a readable vessel/shell.')
    }
    if (!hasAnyRole(facts, ['inlet_port', 'outlet_port'])) {
      issues.push('process equipment requires visible process ports.')
    }
  }
  if (family === 'distillation_tower') {
    if (!hasAnyRole(facts, ['distillation_column_shell'])) {
      issues.push('distillation tower requires a tall vertical column shell.')
    }
    if (!hasAnyRole(facts, ['tray_level'])) {
      issues.push('distillation tower requires readable tray/packing levels.')
    }
    if (!hasAnyRole(facts, ['inlet_port', 'outlet_port', 'overhead_vapor_outlet'])) {
      issues.push('distillation tower requires visible process nozzles/ports.')
    }
    if (!hasAnyRole(facts, ['access_platform', 'ladder'])) {
      issues.push('distillation tower requires readable access platform or ladder details.')
    }
  }
}

function validateRobotArm(facts: PrimitiveGeometryFacts, issues: string[], warnings: string[]) {
  const requiredRoles = [
    'robot_base',
    'base_joint',
    'shoulder_joint',
    'upper_arm',
    'elbow_joint',
    'forearm',
    'end_effector',
  ]
  for (const role of requiredRoles) {
    if ((facts.roles[role] ?? 0) === 0) issues.push(`robot arm requires ${role}.`)
  }

  const base = facts.shapes.find((fact) => hasRole(fact, ['robot_base']))
  if (base && base.min[1] > 0.04) {
    warnings.push('robot arm base is floating above the ground plane.')
  }

  const joints = factsBy(facts, (fact) =>
    hasRole(fact, ['base_joint', 'shoulder_joint', 'elbow_joint', 'wrist_joint']),
  )
  if (joints.length < 3) {
    issues.push(`robot arm requires at least 3 readable joint housings, got ${joints.length}.`)
  }

  const links = factsBy(facts, (fact) => hasRole(fact, ['upper_arm', 'forearm']))
  if (links.length < 2) {
    issues.push('robot arm requires separate upper_arm and forearm links.')
  }
}

export function validatePrimitiveSemantics(
  shapes: readonly PrimitiveShapeInput[],
  transforms: readonly ResolvedPrimitiveTransform[] = [],
  options: PrimitiveSemanticValidationOptions = {},
): PrimitiveSemanticValidationResult {
  const facts = buildPrimitiveGeometryFacts(shapes, transforms)
  const family = detectFamily(facts, options)
  const issues: string[] = []
  const warnings: string[] = []

  validateRequiredRoles(facts, options, family, issues, warnings)

  if (facts.shapeCount === 0) issues.push('no primitive geometry facts were produced.')
  if (facts.dimensions.some((dimension) => dimension > 50)) {
    warnings.push(
      'generated object bounding box is unusually large for meter-based primitive output.',
    )
  }

  switch (family) {
    case 'vehicle':
      validateVehicle(facts, options, issues, warnings)
      break
    case 'bicycle':
      validateBicycle(facts, issues, warnings)
      break
    case 'robot_arm':
      validateRobotArm(facts, issues, warnings)
      break
    case 'mixer':
      validateMixer(facts, issues, warnings)
      break
    case 'machine_tool':
    case 'distillation_tower':
    case 'forming_machine':
    case 'material_handling':
    case 'fluid_machine':
    case 'process_equipment':
      validateIndustrialFamily(family, facts, issues)
      break
  }

  const score = Math.max(0, Number((1 - issues.length * 0.18 - warnings.length * 0.05).toFixed(4)))
  return {
    ok: issues.length === 0,
    family,
    score,
    issues,
    warnings,
    recommendations: issues.map((issue) => `Repair geometry: ${issue}`),
    facts,
  }
}
