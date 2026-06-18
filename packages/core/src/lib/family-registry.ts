import type { PartComposeKind } from './part-compose'
import { getPartDefinitions, type PartDefinition } from './part-registry'

export type LayoutFamilyId =
  | 'rotating_machine_layout'
  | 'vessel_layout'
  | 'linear_transport_layout'
  | 'box_enclosure_layout'
  | 'vehicle_layout'
  | 'aircraft_layout'
  | 'robot_workcell_layout'
  | 'pipe_valve_layout'
  | 'furniture_layout'
  | 'generic_industrial_layout'

export type LayoutFamilyGroup =
  | 'rotating_machine'
  | 'process_vessel'
  | 'material_handling'
  | 'box_enclosure'
  | 'vehicle'
  | 'aircraft'
  | 'robotic_workcell'
  | 'pipe_valve_system'
  | 'furniture'
  | 'generic_industrial'

export interface LayoutFamilyDefinition {
  id: LayoutFamilyId
  aliases: readonly string[]
  archetypeGroup: LayoutFamilyGroup
  executableFamilies: readonly string[]
  primaryExecutableFamily: string
  layoutStrategy: string
  description: string
}

export interface FamilyDefinition {
  id: string
  aliases: readonly string[]
  requiredParts: readonly PartComposeKind[]
  optionalParts: readonly PartComposeKind[]
  primarySemanticRoles: readonly string[]
  layoutStrategy: string
  layoutFamily?: LayoutFamilyId
  archetypeGroup?: LayoutFamilyGroup
  layoutCapability?: string
  deprecatedDeviceFamily?: boolean
  defaultDimensions: {
    length?: number
    width?: number
    height?: number
  }
  description: string
}

export const FAMILY_DEFINITIONS = [
  {
    id: 'vehicle',
    aliases: ['car', 'automobile', 'sedan', 'suv', 'truck', 'van', '汽车', '轿车', '车辆'],
    requiredParts: ['body_shell', 'wheel_set', 'window_strip', 'light_pair', 'bar_pair'],
    optionalParts: ['seam_ring', 'nameplate'],
    primarySemanticRoles: ['vehicle_body', 'body_shell'],
    layoutStrategy: 'vehicle_layout',
    defaultDimensions: { length: 4.4, width: 1.8, height: 1.35 },
    description: 'Complete road vehicle assembled from semantic parts.',
  },
  {
    id: 'bicycle',
    aliases: [
      'bicycle',
      'bike',
      'cycle',
      'complete bicycle',
      'complete bike',
      'cargo bike',
      'tricycle',
    ],
    requiredParts: ['wheel_set', 'tube_frame', 'fork', 'handlebar', 'saddle', 'chain_loop'],
    optionalParts: ['light_pair', 'nameplate'],
    primarySemanticRoles: ['bicycle_frame', 'tube_frame'],
    layoutStrategy: 'bicycle_layout',
    defaultDimensions: { length: 1.7, width: 0.42, height: 1.05 },
    description:
      'Complete bicycle assembled from wheels, frame, fork, handlebar, saddle, and chain.',
  },
  {
    id: 'desk',
    aliases: ['desk', 'table', 'office desk', 'writing desk', 'work table'],
    requiredParts: ['desk_top', 'leg_set'],
    optionalParts: ['drawer_stack'],
    primarySemanticRoles: ['desk_top'],
    layoutStrategy: 'desk_layout',
    defaultDimensions: { length: 1.2, width: 0.6, height: 0.75 },
    description: 'Desk or table furniture assembled from semantic parts.',
  },
  {
    id: 'fan',
    aliases: ['fan', 'standing fan', 'desk fan', 'ventilator', 'industrial fan'],
    requiredParts: ['circular_base', 'vertical_pole', 'motor_housing', 'radial_blades'],
    optionalParts: ['support_bracket', 'protective_grill', 'control_knob'],
    primarySemanticRoles: ['motor_housing', 'radial_blades'],
    layoutStrategy: 'fan_layout',
    defaultDimensions: { length: 0.7, width: 0.7, height: 1.35 },
    description: 'Fan assembled from base, pole, motor housing, blades, and guard.',
  },
  {
    id: 'aircraft',
    aliases: ['aircraft', 'airplane', 'airliner', 'plane', 'jet', 'boeing', 'airbus', 'fuselage'],
    requiredParts: [
      'aircraft_fuselage',
      'aircraft_wing',
      'aircraft_engine',
      'aircraft_vertical_stabilizer',
      'aircraft_horizontal_stabilizer',
      'aircraft_landing_gear',
    ],
    optionalParts: [],
    primarySemanticRoles: ['aircraft_fuselage'],
    layoutStrategy: 'aircraft_layout',
    defaultDimensions: { length: 1.12, width: 0.14, height: 0.145 },
    description:
      'Complete aircraft assembled from fuselage, wings, engines, tail, and landing gear.',
  },
  {
    id: 'kiosk',
    aliases: [
      'kiosk',
      'booth',
      'small booth',
      'ticket booth',
      'vendor booth',
      'newsstand',
      'stall',
      'pavilion',
      'shed',
      'small building',
      '小亭',
      '亭子',
      '售票亭',
      '岗亭',
      '摊位',
      '小建筑',
    ],
    requiredParts: ['kiosk_body', 'kiosk_roof', 'kiosk_opening'],
    optionalParts: ['kiosk_counter', 'kiosk_sign', 'kiosk_awning'],
    primarySemanticRoles: ['kiosk_body'],
    layoutStrategy: 'kiosk_layout',
    defaultDimensions: { length: 1.8, width: 1.2, height: 2.1 },
    description: 'Small kiosk, booth, shed, or pavilion assembled from architectural parts.',
  },
  {
    id: 'generic',
    aliases: ['generic', 'generic object', 'generic industrial', 'fallback object'],
    requiredParts: ['generic_body'],
    optionalParts: [
      'generic_base',
      'generic_panel',
      'generic_spout',
      'generic_display',
      'generic_opening',
      'generic_detail_accent',
      'generic_foot_set',
    ],
    primarySemanticRoles: ['main_body', 'generic_body'],
    layoutStrategy: 'generic_body_base_details_layout',
    defaultDimensions: { length: 1.4, width: 0.8, height: 1.1 },
    description: 'Generic editable fallback object assembled from reusable generic parts.',
  },
  {
    id: 'pump',
    aliases: [
      'pump',
      'centrifugal pump',
      'water pump',
      'process pump',
      'chemical pump',
      'blower pump',
      'volute pump',
      '离心泵',
      '水泵',
      '工业泵',
    ],
    requiredParts: ['skid_base', 'ribbed_motor_body', 'volute_casing', 'inlet_port', 'outlet_port'],
    optionalParts: ['flange_ring', 'impeller_blades', 'control_box', 'nameplate', 'warning_label'],
    primarySemanticRoles: ['volute_casing', 'skid_base', 'ribbed_motor_body'],
    layoutStrategy: 'pump_layout',
    defaultDimensions: { length: 1.2, width: 0.55, height: 0.6 },
    description: 'Industrial centrifugal pump assembled from skid, motor, volute, and ports.',
  },
  {
    id: 'conveyor',
    aliases: [
      'conveyor',
      'belt conveyor',
      'conveyor belt',
      'material conveyor',
      'roller conveyor',
      '皮带输送机',
      '输送机',
      '输送线',
      '传送带',
    ],
    requiredParts: ['conveyor_frame', 'roller_array', 'belt_surface'],
    optionalParts: ['ribbed_motor_body', 'warning_label', 'nameplate'],
    primarySemanticRoles: ['conveyor_frame'],
    layoutStrategy: 'conveyor_layout',
    defaultDimensions: { length: 3, width: 0.7, height: 0.65 },
    description:
      'Industrial conveyor assembled from frame, rollers, belt, and optional drive motor.',
  },
  {
    id: 'material_handling',
    aliases: [
      'material handling',
      'material_handling',
      'handling equipment',
      'roller conveyor',
      'belt conveyor',
    ],
    requiredParts: ['conveyor_frame', 'roller_array', 'belt_surface'],
    optionalParts: ['ribbed_motor_body', 'warning_label', 'nameplate'],
    primarySemanticRoles: ['conveyor_frame'],
    layoutStrategy: 'material_handling_layout',
    defaultDimensions: { length: 3, width: 0.8, height: 0.75 },
    description: 'Generic material-handling family for conveyors, roller lines, and grate coolers.',
  },
  {
    id: 'electrical',
    aliases: [
      'electrical cabinet',
      'control cabinet',
      'power cabinet',
      'electrical panel',
      'control panel',
      'switchgear',
      'switchgear cabinet',
      '电控柜',
      '控制柜',
      '配电柜',
      '开关柜',
    ],
    requiredParts: ['electrical_cabinet'],
    optionalParts: ['cable_tray', 'nameplate', 'warning_label', 'vent_slats'],
    primarySemanticRoles: ['electrical_cabinet'],
    layoutStrategy: 'electrical_cabinet_layout',
    defaultDimensions: { length: 0.8, width: 0.32, height: 1.6 },
    description:
      'Industrial electrical cabinet assembled from cabinet body and electrical details.',
  },
  {
    id: 'pipe_system',
    aliases: [
      'pipe system',
      'piping',
      'pipe run',
      'pipeline',
      'process piping',
      'industrial pipe',
      '管路系统',
      '管道系统',
      '工艺管道',
      '管线',
    ],
    requiredParts: ['pipe_run'],
    optionalParts: ['pipe_elbow', 'flange_ring', 'valve_body'],
    primarySemanticRoles: ['pipe_run'],
    layoutStrategy: 'pipe_system_layout',
    defaultDimensions: { length: 2, width: 0.12, height: 0.12 },
    description: 'Industrial process piping assembled from pipe runs, elbows, flanges, and valves.',
  },
  {
    id: 'tank',
    aliases: [
      'tank',
      'storage tank',
      'pressure vessel',
      'process vessel',
      'vertical tank',
      'horizontal tank',
      '储罐',
      '罐',
      '容器',
    ],
    requiredParts: ['cylindrical_tank'],
    optionalParts: ['skid_base', 'inlet_port', 'outlet_port', 'platform_ladder', 'nameplate'],
    primarySemanticRoles: ['cylindrical_tank', 'vessel_shell'],
    layoutStrategy: 'tank_layout',
    defaultDimensions: { length: 1.2, width: 1.2, height: 2.4 },
    description: 'Industrial tank or pressure vessel assembled from vessel shell and nozzles.',
  },
  {
    id: 'reactor',
    aliases: [
      'reactor',
      'reaction kettle',
      'reaction vessel',
      'stirred tank',
      'agitator tank',
      '反应釜',
      '反应器',
      '搅拌罐',
    ],
    requiredParts: ['agitator_tank', 'inlet_port', 'outlet_port'],
    optionalParts: ['platform_ladder', 'flange_ring', 'control_box', 'nameplate'],
    primarySemanticRoles: ['reactor_vessel_shell', 'agitator_tank'],
    layoutStrategy: 'reactor_layout',
    defaultDimensions: { length: 1.1, width: 1.1, height: 1.8 },
    description:
      'Stirred reactor assembled from agitator vessel, feed/discharge nozzles, and access details.',
  },
  {
    id: 'mixer',
    aliases: [
      'mixer',
      'mud mixer',
      'agitator',
      'impeller',
      'mixing paddle',
      'agitator paddle',
      'mixer impeller',
    ],
    requiredParts: ['mixer_blades'],
    optionalParts: ['generic_base', 'generic_body', 'generic_panel'],
    primarySemanticRoles: ['mixer_blade', 'mixer_blades'],
    layoutStrategy: 'mixer_layout',
    defaultDimensions: { length: 0.8, width: 0.8, height: 1 },
    description: 'Mixer or agitator assembled from shaft, hub, and radial impeller blades.',
  },
  {
    id: 'compressor',
    aliases: [
      'compressor',
      'air compressor',
      'gas compressor',
      'skid compressor',
      '压缩机',
      '空压机',
    ],
    requiredParts: [
      'skid_base',
      'ribbed_motor_body',
      'rounded_machine_body',
      'inlet_port',
      'outlet_port',
    ],
    optionalParts: ['control_box', 'flange_ring', 'nameplate', 'warning_label'],
    primarySemanticRoles: ['compressor_casing', 'rounded_machine_body', 'motor_body'],
    layoutStrategy: 'compressor_layout',
    defaultDimensions: { length: 1.8, width: 0.7, height: 0.75 },
    description:
      'Industrial compressor assembled from skid, drive motor, compressor casing, and ports.',
  },
  {
    id: 'heat_exchanger',
    aliases: [
      'heat exchanger',
      'shell and tube heat exchanger',
      'condenser',
      'cooler',
      '换热器',
      '冷凝器',
      '冷却器',
    ],
    requiredParts: ['heat_exchanger'],
    optionalParts: ['skid_base', 'flange_ring', 'nameplate'],
    primarySemanticRoles: ['heat_exchanger_shell', 'heat_exchanger'],
    layoutStrategy: 'heat_exchanger_layout',
    defaultDimensions: { length: 1.6, width: 0.48, height: 0.55 },
    description: 'Shell-and-tube heat exchanger assembled from exchanger body and supports.',
  },
  {
    id: 'fluid_machine',
    aliases: [
      'fluid machine',
      'fluid_machine',
      'rotating fluid machine',
      'pump casing',
      'compressor casing',
      'blower',
      'centrifugal',
    ],
    requiredParts: ['rounded_machine_body', 'inlet_port', 'outlet_port'],
    optionalParts: ['skid_base', 'ribbed_motor_body', 'volute_casing', 'impeller_blades'],
    primarySemanticRoles: [
      'volute_casing',
      'rounded_machine_body',
      'pump_casing',
      'compressor_casing',
    ],
    layoutStrategy: 'fluid_machine_layout',
    defaultDimensions: { length: 1.2, width: 0.55, height: 0.65 },
    description: 'Generic fluid machine family for pumps, blowers, and compressor-like assemblies.',
  },
  {
    id: 'process_equipment',
    aliases: [
      'process equipment',
      'process_equipment',
      'process vessel',
      'reaction vessel',
      'vessel shell',
      'reactor vessel',
      'condenser',
    ],
    requiredParts: ['cylindrical_tank', 'inlet_port', 'outlet_port'],
    optionalParts: ['platform_ladder', 'flange_ring', 'nameplate'],
    primarySemanticRoles: [
      'vessel_shell',
      'cylindrical_tank',
      'reactor_vessel_shell',
      'heat_exchanger_shell',
    ],
    layoutStrategy: 'process_equipment_layout',
    defaultDimensions: { length: 1.4, width: 0.7, height: 1.5 },
    description: 'Generic process equipment family for vessels, reactors, and thermal equipment.',
  },
  {
    id: 'machine_tool',
    aliases: [
      'machine tool',
      'cnc',
      'cnc machine',
      'cnc mill',
      'machining center',
      'lathe',
      'milling machine',
      'grinder',
      'drill press',
      '机床',
      '数控机床',
      '加工中心',
      '车床',
      '铣床',
    ],
    requiredParts: ['generic_base', 'generic_body', 'generic_panel', 'control_box'],
    optionalParts: ['nameplate', 'warning_label', 'vent_slats'],
    primarySemanticRoles: ['machine_enclosure', 'generic_body'],
    layoutStrategy: 'machine_tool_layout',
    defaultDimensions: { length: 2.4, width: 1, height: 1.6 },
    description:
      'Machine tool / CNC envelope assembled from bed, enclosure, spindle head, and control panel.',
  },
  {
    id: 'forming_machine',
    aliases: [
      'forming machine',
      'forming_machine',
      'injection molding',
      'injection molding machine',
      'hydraulic press',
      'press frame',
      'press machine',
    ],
    requiredParts: ['generic_base', 'generic_body', 'generic_panel', 'control_box'],
    optionalParts: ['nameplate', 'warning_label'],
    primarySemanticRoles: ['press_frame', 'generic_body', 'machine_enclosure'],
    layoutStrategy: 'forming_machine_layout',
    defaultDimensions: { length: 2.2, width: 0.9, height: 1.5 },
    description: 'Industrial forming machine family for presses and injection molding equipment.',
  },
  {
    id: 'outdoor_ac',
    aliases: [
      'outdoor ac',
      'outdoor_ac',
      'outdoor air conditioner',
      'air conditioner outdoor unit',
      'condenser unit',
      'hvac outdoor unit',
    ],
    requiredParts: ['rounded_machine_body', 'vent_grill', 'radial_blades'],
    optionalParts: ['pipe_port', 'nameplate', 'warning_label'],
    primarySemanticRoles: ['rounded_machine_body'],
    layoutStrategy: 'outdoor_ac_layout',
    defaultDimensions: { length: 0.86, width: 0.34, height: 0.62 },
    description: 'Outdoor air-conditioner unit assembled from enclosure, grille, fan, and ports.',
  },
  {
    id: 'distillation_tower',
    aliases: [
      'distillation tower',
      'distillation column',
      'fractionator',
      'rectification tower',
      'chemical tower',
      'process tower',
    ],
    requiredParts: ['cylindrical_tank', 'seam_ring', 'pipe_port', 'platform_ladder'],
    optionalParts: ['flange_ring', 'nameplate'],
    primarySemanticRoles: ['distillation_column_shell', 'cylindrical_tank'],
    layoutStrategy: 'distillation_tower_layout',
    defaultDimensions: { length: 8, width: 1, height: 8 },
    description: 'Tall process tower with tray levels, nozzles, platforms, and ladder.',
  },
  {
    id: 'grate_cooler',
    aliases: ['grate cooler', 'grate_cooler', 'clinker cooler', 'cement cooler'],
    requiredParts: ['generic_body', 'conveyor_frame', 'roller_array', 'radial_blades'],
    optionalParts: ['generic_base', 'belt_surface', 'warning_label'],
    primarySemanticRoles: ['cooler_grate_bed', 'generic_body', 'conveyor_frame'],
    layoutStrategy: 'grate_cooler_layout',
    defaultDimensions: { length: 4, width: 1.5, height: 1 },
    description: 'Industrial grate cooler with housing, grate bed, fans, and chutes.',
  },
  {
    id: 'valve',
    aliases: ['valve', 'gate valve', 'ball valve', 'control valve', 'industrial valve'],
    requiredParts: ['valve_body'],
    optionalParts: ['handwheel', 'flange_ring', 'bolt_pattern'],
    primarySemanticRoles: ['valve_body'],
    layoutStrategy: 'valve_layout',
    defaultDimensions: { length: 0.7, width: 0.3, height: 0.45 },
    description: 'Industrial valve body with optional handwheel, flanges, and bolts.',
  },
  {
    id: 'robot_arm',
    aliases: [
      'robot arm',
      'robot_arm',
      'industrial robot',
      'cobot',
      'manipulator',
      'six axis robot',
      'fanuc',
    ],
    requiredParts: [],
    optionalParts: ['generic_base', 'generic_body', 'nameplate', 'warning_label'],
    primarySemanticRoles: ['upper_arm', 'forearm', 'robot_base', 'generic_body'],
    layoutStrategy: 'robot_arm_layout',
    defaultDimensions: { length: 1.6, width: 1.1, height: 1.8 },
    description: 'Industrial robot arm with base, joints, links, wrist, and tool flange.',
  },
] as const satisfies readonly FamilyDefinition[]

export type FamilyId = (typeof FAMILY_DEFINITIONS)[number]['id']

export const LAYOUT_FAMILY_DEFINITIONS = [
  {
    id: 'rotating_machine_layout',
    aliases: [
      'rotating machine',
      'rotating_machine',
      'fluid machine',
      'pump layout',
      'compressor layout',
      'fan layout',
    ],
    archetypeGroup: 'rotating_machine',
    executableFamilies: ['pump', 'compressor', 'fan', 'fluid_machine', 'mixer'],
    primaryExecutableFamily: 'pump',
    layoutStrategy: 'motor_casing_ports_layout',
    description:
      'Rotating industrial equipment layout: base/skid, drive motor, casing, ports, and optional rotating internals.',
  },
  {
    id: 'vessel_layout',
    aliases: [
      'vessel',
      'process vessel',
      'vessel layout',
      'tank layout',
      'reactor layout',
      'thermal vessel',
    ],
    archetypeGroup: 'process_vessel',
    executableFamilies: [
      'tank',
      'reactor',
      'heat_exchanger',
      'distillation_tower',
      'process_equipment',
    ],
    primaryExecutableFamily: 'tank',
    layoutStrategy: 'shell_ports_supports_layout',
    description:
      'Process vessel layout: shell/body, nozzles, supports, optional platform/ladder, and vessel-specific internals.',
  },
  {
    id: 'linear_transport_layout',
    aliases: ['linear transport', 'material handling', 'conveyor layout', 'transport line'],
    archetypeGroup: 'material_handling',
    executableFamilies: ['conveyor', 'material_handling', 'grate_cooler'],
    primaryExecutableFamily: 'conveyor',
    layoutStrategy: 'long_frame_repeating_surface_layout',
    description:
      'Linear material transport layout: long frame, repeated rollers/slats, moving belt/surface, and optional drive.',
  },
  {
    id: 'box_enclosure_layout',
    aliases: [
      'box enclosure',
      'enclosed machine',
      'cabinet layout',
      'machine enclosure',
      'box_enclosure',
    ],
    archetypeGroup: 'box_enclosure',
    executableFamilies: ['machine_tool', 'forming_machine', 'electrical', 'kiosk', 'outdoor_ac'],
    primaryExecutableFamily: 'machine_tool',
    layoutStrategy: 'base_body_front_panel_controls_layout',
    description:
      'Enclosed machine/cabinet layout: base, enclosure/body, access or viewing panels, controls, vents, and labels.',
  },
  {
    id: 'vehicle_layout',
    aliases: ['vehicle layout', 'road vehicle layout', 'bicycle layout'],
    archetypeGroup: 'vehicle',
    executableFamilies: ['vehicle', 'bicycle'],
    primaryExecutableFamily: 'vehicle',
    layoutStrategy: 'body_wheels_cabin_layout',
    description: 'Vehicle layout for wheeled road vehicles and bicycle-like assemblies.',
  },
  {
    id: 'aircraft_layout',
    aliases: ['aircraft layout', 'airplane layout', 'airliner layout'],
    archetypeGroup: 'aircraft',
    executableFamilies: ['aircraft'],
    primaryExecutableFamily: 'aircraft',
    layoutStrategy: 'fuselage_wings_tail_landing_gear_layout',
    description: 'Aircraft layout with fuselage, wings, engines, stabilizers, and landing gear.',
  },
  {
    id: 'robot_workcell_layout',
    aliases: ['robot workcell', 'robot arm layout', 'robotic workcell'],
    archetypeGroup: 'robotic_workcell',
    executableFamilies: ['robot_arm'],
    primaryExecutableFamily: 'robot_arm',
    layoutStrategy: 'robot_arm_cell_layout',
    description:
      'Robot arm/workcell layout with base, joints, arm links, tooling, controls, and safety details.',
  },
  {
    id: 'pipe_valve_layout',
    aliases: ['pipe valve', 'pipe layout', 'valve layout', 'piping layout'],
    archetypeGroup: 'pipe_valve_system',
    executableFamilies: ['pipe_system', 'valve'],
    primaryExecutableFamily: 'pipe_system',
    layoutStrategy: 'pipe_run_fittings_valve_layout',
    description:
      'Pipe and valve system layout with runs, elbows, flanges, valves, and handwheel details.',
  },
  {
    id: 'furniture_layout',
    aliases: ['furniture layout', 'desk layout', 'table layout'],
    archetypeGroup: 'furniture',
    executableFamilies: ['desk'],
    primaryExecutableFamily: 'desk',
    layoutStrategy: 'top_supports_storage_layout',
    description: 'Furniture layout for desks and table-like objects.',
  },
  {
    id: 'generic_industrial_layout',
    aliases: ['generic industrial', 'generic layout', 'fallback industrial layout'],
    archetypeGroup: 'generic_industrial',
    executableFamilies: ['generic'],
    primaryExecutableFamily: 'generic',
    layoutStrategy: 'generic_body_base_details_layout',
    description:
      'Fallback layout using generic editable parts when no specific layout family applies.',
  },
] as const satisfies readonly LayoutFamilyDefinition[]

const executableFamilyToLayoutFamily = new Map<string, LayoutFamilyDefinition>()
const layoutFamilyAliasMap = new Map<string, LayoutFamilyDefinition>()
for (const layoutFamily of LAYOUT_FAMILY_DEFINITIONS) {
  layoutFamilyAliasMap.set(normalizeKey(layoutFamily.id), layoutFamily)
  for (const alias of layoutFamily.aliases)
    layoutFamilyAliasMap.set(normalizeKey(alias), layoutFamily)
  for (const family of layoutFamily.executableFamilies) {
    executableFamilyToLayoutFamily.set(normalizeKey(family), layoutFamily)
  }
}

const familyAliasMap = new Map<string, FamilyDefinition>()
for (const definition of FAMILY_DEFINITIONS) {
  familyAliasMap.set(normalizeKey(definition.id), definition)
  for (const alias of definition.aliases) familyAliasMap.set(normalizeKey(alias), definition)
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_-]+/g, '_')
        .toLowerCase()
    : ''
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function isAsciiWordChar(value: string | undefined): boolean {
  return value != null && /^[a-z0-9]$/.test(value)
}

function isCjkChar(value: string | undefined): boolean {
  return value != null && /^[\u3400-\u9fff\uf900-\ufaff]$/.test(value)
}

function isSingleCjkAlias(value: string): boolean {
  return value.length === 1 && isCjkChar(value)
}

function isSingleCjkAliasLeftBoundary(value: string | undefined): boolean {
  return (
    value == null ||
    !isCjkChar(value) ||
    /^[个個台臺座只件套根条條份种種类類为為是叫作做造建成一二两兩三四五六七八九十]$/.test(value)
  )
}

function isSingleCjkAliasRightBoundary(value: string | undefined): boolean {
  return value == null || !isCjkChar(value) || /^[子体體身型式类類]$/.test(value)
}

function containsAliasToken(normalizedText: string, alias: string): boolean {
  if (!alias) return false
  if (isSingleCjkAlias(alias)) {
    let index = normalizedText.indexOf(alias)
    while (index >= 0) {
      const before = normalizedText[index - 1]
      const after = normalizedText[index + alias.length]
      if (isSingleCjkAliasLeftBoundary(before) && isSingleCjkAliasRightBoundary(after)) return true
      index = normalizedText.indexOf(alias, index + 1)
    }
    return false
  }
  if (!/[a-z0-9]/.test(alias)) return normalizedText.includes(alias)

  let index = normalizedText.indexOf(alias)
  while (index >= 0) {
    const before = normalizedText[index - 1]
    const after = normalizedText[index + alias.length]
    if (!isAsciiWordChar(before) && !isAsciiWordChar(after)) return true
    index = normalizedText.indexOf(alias, index + 1)
  }
  return false
}

export function getFamilyDefinition(family: unknown): FamilyDefinition | undefined {
  return familyAliasMap.get(normalizeKey(family))
}

export function getLayoutFamilyDefinition(family: unknown): LayoutFamilyDefinition | undefined {
  const direct = layoutFamilyAliasMap.get(normalizeKey(family))
  if (direct) return direct
  const executable = getFamilyDefinition(family)
  return executableFamilyToLayoutFamily.get(normalizeKey(executable?.id ?? family))
}

export function normalizeLayoutFamilyId(family: unknown): LayoutFamilyId | undefined {
  return getLayoutFamilyDefinition(family)?.id
}

export function executableFamilyForLayoutFamily(
  layoutFamily: unknown,
  preferredFamily?: unknown,
): string | undefined {
  const definition = getLayoutFamilyDefinition(layoutFamily)
  if (!definition) return undefined
  const preferred = getFamilyDefinition(preferredFamily)
  if (preferred && definition.executableFamilies.includes(preferred.id)) return preferred.id
  return definition.primaryExecutableFamily
}

export function normalizeFamilyId(family: unknown): FamilyId | undefined {
  return getFamilyDefinition(family)?.id as FamilyId | undefined
}

export function isFamilyId(family: unknown): family is FamilyId {
  return normalizeFamilyId(family) === family
}

export function inferFamilyDefinition(
  input: Record<string, unknown>,
): FamilyDefinition | undefined {
  const explicit = getFamilyDefinition(input.family)
  if (explicit) return explicit
  const text = textOf([input.object, input.name, input.prompt, input.style, input.geometryBrief])
  const normalizedText = normalizeKey(text)
  const matches = FAMILY_DEFINITIONS.flatMap((definition) =>
    [definition.id, ...definition.aliases].map((alias) => ({
      definition,
      alias: normalizeKey(alias),
    })),
  ).filter((candidate) => containsAliasToken(normalizedText, candidate.alias))
  matches.sort((left, right) => right.alias.length - left.alias.length)
  return matches[0]?.definition
}

export function familyPartDefinitions(family: unknown): readonly PartDefinition[] {
  const definition = getFamilyDefinition(family)
  return definition ? getPartDefinitions(definition.id) : []
}

export function familyCapabilitySummary(): string {
  return FAMILY_DEFINITIONS.map(
    (definition) =>
      `${definition.id}: layoutFamily=${normalizeLayoutFamilyId(definition.id) ?? 'unknown'} required=${definition.requiredParts.join(', ')} optional=${definition.optionalParts.join(', ')} layout=${definition.layoutStrategy}`,
  ).join('\n')
}

export function layoutFamilyCapabilitySummary(): string {
  return LAYOUT_FAMILY_DEFINITIONS.map(
    (definition) =>
      `${definition.id}: group=${definition.archetypeGroup} executable=${definition.executableFamilies.join(', ')} strategy=${definition.layoutStrategy}`,
  ).join('\n')
}
