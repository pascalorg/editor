export type IndustrialArchetypeRecipeId =
  | 'machineTool.lathe'
  | 'machineTool.machiningCenter'
  | 'machineTool.laserCutter'
  | 'forming.injectionMolding'
  | 'forming.hydraulicPress'
  | 'materialHandling.beltConveyor'
  | 'fluidMachine.centrifugalPump'
  | 'process.heatExchanger'

export type IndustrialArchetypeId =
  | 'machine_tool.lathe_bed'
  | 'machine_tool.bed_column'
  | 'machine_tool.gantry_table'
  | 'forming.injection_clamp'
  | 'forming.press_frame'
  | 'material_handling.conveyor'
  | 'fluid.rotating_machine'
  | 'process.horizontal_cylinder'
  | 'process.vertical_vessel'
  | 'packaging.inline_machine'

export type IndustrialVariantId =
  | 'cnc_lathe'
  | 'turning_machine'
  | 'thread_rolling_machine'
  | 'machining_center'
  | 'milling_machine'
  | 'drill_press'
  | 'grinder'
  | 'planer'
  | 'shaper'
  | 'boring_machine'
  | 'laser_cutter'
  | 'plasma_cutter'
  | 'wire_edm'
  | 'injection_molding'
  | 'die_casting'
  | 'vulcanizing_press'
  | 'hydraulic_press'
  | 'punch_press'
  | 'forging_press'
  | 'press_fit_machine'
  | 'riveting_machine'
  | 'belt_conveyor'
  | 'roller_conveyor'
  | 'assembly_line'
  | 'packaging_line'
  | 'centrifugal_pump'
  | 'screw_pump'
  | 'gear_pump'
  | 'diaphragm_pump'
  | 'vacuum_pump'
  | 'fan_blower'
  | 'compressor'
  | 'heat_exchanger'
  | 'cooler'
  | 'condenser'
  | 'evaporator'
  | 'filter_vessel'
  | 'horizontal_tank'
  | 'vertical_storage_tank'
  | 'settling_tank'
  | 'oil_water_separator'
  | 'filling_machine'
  | 'sealing_machine'
  | 'labeling_machine'
  | 'coding_machine'

export interface IndustrialArchetypeEntry {
  recipeId: IndustrialArchetypeRecipeId
  archetypeId: IndustrialArchetypeId
  /** @deprecated Use archetypeId. Kept so older planner text remains meaningful. */
  archetype: IndustrialArchetypeId
  variant: IndustrialVariantId
  aliases: string[]
  label: string
  category: string
  requiredRoles: string[]
  validationTargets: string[]
}

function entry(
  recipeId: IndustrialArchetypeRecipeId,
  archetypeId: IndustrialArchetypeId,
  variant: IndustrialVariantId,
  label: string,
  aliases: string[],
  category: string,
  requiredRoles: string[],
  validationTargets: string[],
): IndustrialArchetypeEntry {
  return {
    recipeId,
    archetypeId,
    archetype: archetypeId,
    variant,
    label,
    aliases: [
      ...aliases.filter((alias) => !alias.includes('?')),
      ...(CHINESE_ALIASES[variant] ?? []),
    ],
    category,
    requiredRoles,
    validationTargets,
  }
}

const MACHINE_TOOL_BED_COLUMN_ROLES = [
  'machine_base',
  'machine_column',
  'work_table',
  'spindle_head',
  'control_panel',
]

const GANTRY_TABLE_ROLES = ['cutting_table', 'gantry_frame', 'laser_head', 'control_panel']
const ROTATING_MACHINE_ROLES = [
  'machine_base',
  'motor_body',
  'pump_casing',
  'inlet_port',
  'outlet_port',
]
const HORIZONTAL_CYLINDER_ROLES = [
  'heat_exchanger_shell',
  'inlet_port',
  'outlet_port',
  'saddle_support',
]

const CHINESE_ALIASES: Partial<Record<IndustrialVariantId, string[]>> = {
  cnc_lathe: ['\u6570\u63a7\u8f66\u5e8a', '\u8f66\u5e8a'],
  turning_machine: ['\u666e\u901a\u8f66\u5e8a', '\u5367\u5f0f\u8f66\u5e8a'],
  thread_rolling_machine: ['\u6eda\u4e1d\u673a'],
  machining_center: [
    '\u52a0\u5de5\u4e2d\u5fc3',
    'cnc\u673a\u5e8a',
    'cnc \u673a\u5e8a',
    '\u6570\u63a7\u52a0\u5de5\u4e2d\u5fc3',
  ],
  milling_machine: ['\u94e3\u5e8a', '\u7acb\u5f0f\u94e3\u5e8a'],
  drill_press: ['\u94bb\u5e8a', '\u6447\u81c2\u94bb\u5e8a'],
  grinder: ['\u78e8\u5e8a', '\u5e73\u9762\u78e8\u5e8a'],
  planer: ['\u5228\u5e8a', '\u9f99\u95e8\u5228\u5e8a'],
  shaper: ['\u725b\u5934\u5228\u5e8a', '\u63d2\u5e8a'],
  boring_machine: ['\u9557\u5e8a'],
  laser_cutter: ['\u6fc0\u5149\u5207\u5272\u673a', '\u5207\u5272\u673a'],
  plasma_cutter: ['\u7b49\u79bb\u5b50\u5207\u5272\u673a'],
  wire_edm: ['\u7ebf\u5207\u5272\u673a\u5e8a', '\u7ebf\u5207\u5272'],
  injection_molding: ['\u6ce8\u5851\u673a'],
  die_casting: ['\u538b\u94f8\u673a'],
  vulcanizing_press: ['\u786b\u5316\u673a'],
  hydraulic_press: ['\u6db2\u538b\u673a', '\u538b\u529b\u673a'],
  punch_press: ['\u51b2\u5e8a', '\u51b2\u538b\u673a'],
  forging_press: ['\u953b\u538b\u673a'],
  press_fit_machine: ['\u538b\u88c5\u673a'],
  riveting_machine: ['\u94c6\u63a5\u673a'],
  belt_conveyor: ['\u76ae\u5e26\u8f93\u9001\u673a', '\u8f93\u9001\u673a'],
  roller_conveyor: ['\u6eda\u7b52\u8f93\u9001\u673a'],
  assembly_line: ['\u88c5\u914d\u6d41\u6c34\u7ebf', '\u6d41\u6c34\u7ebf'],
  packaging_line: ['\u5305\u88c5\u6d41\u6c34\u7ebf'],
  centrifugal_pump: ['\u79bb\u5fc3\u6cf5', '\u6cf5'],
  screw_pump: ['\u87ba\u6746\u6cf5'],
  gear_pump: ['\u9f7f\u8f6e\u6cf5'],
  diaphragm_pump: ['\u9694\u819c\u6cf5'],
  vacuum_pump: ['\u771f\u7a7a\u6cf5', '\u771f\u7a7a\u673a\u7ec4'],
  fan_blower: ['\u98ce\u673a', '\u9f13\u98ce\u673a'],
  compressor: ['\u538b\u7f29\u673a'],
  heat_exchanger: ['\u6362\u70ed\u5668', '\u52a0\u70ed\u5668'],
  cooler: ['\u51b7\u5374\u5668'],
  condenser: ['\u51b7\u51dd\u5668'],
  evaporator: ['\u84b8\u53d1\u5668'],
  filter_vessel: ['\u8fc7\u6ee4\u5668'],
  vertical_storage_tank: ['\u50a8\u7f50', '\u7acb\u7f50'],
  settling_tank: ['\u6c89\u964d\u7f50'],
  oil_water_separator: ['\u6cb9\u6c34\u5206\u79bb\u5668'],
  filling_machine: ['\u704c\u88c5\u673a'],
  sealing_machine: ['\u5c01\u53e3\u673a'],
  labeling_machine: ['\u8d34\u6807\u673a'],
  coding_machine: ['\u55b7\u7801\u673a'],
}

export const INDUSTRIAL_ARCHETYPE_ENTRIES: IndustrialArchetypeEntry[] = [
  entry(
    'machineTool.lathe',
    'machine_tool.lathe_bed',
    'cnc_lathe',
    'CNC lathe',
    ['cnc lathe', 'lathe', 'turning machine', '\u6570\u63a7\u8f66\u5e8a', '\u8f66\u5e8a'],
    'machine_tool',
    ['machine_bed', 'headstock', 'spindle_chuck', 'tool_post', 'control_panel'],
    ['lathe bed/headstock/chuck/tool post/control panel'],
  ),
  entry(
    'machineTool.lathe',
    'machine_tool.lathe_bed',
    'turning_machine',
    'Turning machine',
    ['turning center', 'turning machine', '\u8f66\u524a\u4e2d\u5fc3', '\u8f66\u5e8a'],
    'machine_tool',
    ['machine_bed', 'headstock', 'spindle_chuck', 'tool_post', 'control_panel'],
    ['lathe bed/headstock/chuck/tool post/control panel'],
  ),
  entry(
    'machineTool.lathe',
    'machine_tool.lathe_bed',
    'thread_rolling_machine',
    'Thread rolling machine',
    ['thread rolling machine', 'thread roller', '\u6eda\u4e1d\u673a'],
    'machine_tool',
    ['machine_bed', 'headstock', 'spindle_chuck', 'tool_post', 'control_panel'],
    ['lathe-like bed, opposing rolling head, tool post/control panel'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'machining_center',
    'CNC machining center',
    [
      'machining center',
      'cnc machine',
      'cnc milling',
      'cnc mill',
      '\u52a0\u5de5\u4e2d\u5fc3',
      '\u0063\u006e\u0063\u673a\u5e8a',
      '\u0063\u006e\u0063\u0020\u673a\u5e8a',
      '\u6570\u63a7\u673a\u5e8a',
      '\u673a\u5e8a',
    ],
    'machine_tool',
    MACHINE_TOOL_BED_COLUMN_ROLES,
    ['base, rear column, work table, spindle head, protective door'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'milling_machine',
    'Milling machine',
    ['milling machine', 'mill machine', '??', '???'],
    'machine_tool',
    [...MACHINE_TOOL_BED_COLUMN_ROLES, 'milling_cutter', 't_slot_table'],
    ['base, column, T-slot work table, spindle head, milling cutter and control panel'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'drill_press',
    'Drilling machine',
    ['drill press', 'drilling machine', 'radial drill', '??', '???'],
    'machine_tool',
    [...MACHINE_TOOL_BED_COLUMN_ROLES, 'drill_bit', 'lifting_table'],
    ['base, round column, radial arm/drill head, drill bit and lifting work table'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'grinder',
    'Grinding machine',
    ['grinding machine', 'surface grinder', '??', '???'],
    'machine_tool',
    [...MACHINE_TOOL_BED_COLUMN_ROLES, 'grinding_wheel', 'wheel_guard', 'magnetic_chuck'],
    ['base, column, magnetic chuck table, grinding wheel, wheel guard and control panel'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'planer',
    'Planer',
    ['planer', 'planing machine', 'gantry planer', 'metal planer'],
    'machine_tool',
    ['machine_base', 'work_table', 'cross_rail', 'reciprocating_ram', 'tool_head', 'control_panel'],
    ['long bed, traveling work table, cross rail, reciprocating ram and single-point tool head'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'shaper',
    'Shaper',
    ['shaper', 'shaping machine', 'slotter', 'slotting machine'],
    'machine_tool',
    [
      'machine_base',
      'work_table',
      'reciprocating_ram',
      'clapper_box',
      'tool_head',
      'control_panel',
    ],
    ['short base, reciprocating ram head, clapper box, vise table and single-point cutting tool'],
  ),
  entry(
    'machineTool.machiningCenter',
    'machine_tool.bed_column',
    'boring_machine',
    'Boring machine',
    ['boring machine', '??'],
    'machine_tool',
    MACHINE_TOOL_BED_COLUMN_ROLES,
    ['base, column, work table, boring spindle and control panel'],
  ),
  entry(
    'machineTool.laserCutter',
    'machine_tool.gantry_table',
    'laser_cutter',
    'Laser cutter',
    [
      'laser cutter',
      'laser cutting machine',
      '\u6fc0\u5149\u5207\u5272\u673a',
      '\u6fc0\u5149\u673a',
    ],
    'machine_tool',
    GANTRY_TABLE_ROLES,
    ['cutting bed, gantry, laser head, protective panel'],
  ),
  entry(
    'machineTool.laserCutter',
    'machine_tool.gantry_table',
    'plasma_cutter',
    'Plasma cutting machine',
    ['plasma cutter', 'plasma cutting machine', '\u7b49\u79bb\u5b50\u5207\u5272\u673a'],
    'machine_tool',
    GANTRY_TABLE_ROLES,
    ['cutting bed, gantry, plasma torch head, protective panel'],
  ),
  entry(
    'machineTool.laserCutter',
    'machine_tool.gantry_table',
    'wire_edm',
    'Wire EDM machine',
    [
      'wire edm',
      'wire cutting machine',
      'wire cut',
      '\u7ebf\u5207\u5272\u673a',
      '\u7535\u706b\u82b1',
    ],
    'machine_tool',
    GANTRY_TABLE_ROLES,
    ['cutting bed, gantry/wire bridge, cutting head and control panel'],
  ),
  entry(
    'forming.injectionMolding',
    'forming.injection_clamp',
    'injection_molding',
    'Injection molding machine',
    ['injection molding machine', 'injection molder', '???'],
    'forming_machine',
    ['machine_base', 'injection_unit', 'hopper', 'press_frame', 'control_panel'],
    ['long base, injection barrel, hopper, mold clamp frame'],
  ),
  entry(
    'forming.injectionMolding',
    'forming.injection_clamp',
    'die_casting',
    'Die casting machine',
    ['die casting machine', '???'],
    'forming_machine',
    ['machine_base', 'injection_unit', 'hopper', 'press_frame', 'control_panel'],
    ['long base, injection sleeve, clamp frame and control panel'],
  ),
  entry(
    'forming.injectionMolding',
    'forming.injection_clamp',
    'vulcanizing_press',
    'Vulcanizing machine',
    ['vulcanizing machine', 'vulcanizing press', '???'],
    'forming_machine',
    ['machine_base', 'injection_unit', 'hopper', 'press_frame', 'control_panel'],
    ['long machine base, heated clamp frame and control panel'],
  ),
  entry(
    'forming.hydraulicPress',
    'forming.press_frame',
    'hydraulic_press',
    'Hydraulic press',
    ['hydraulic press', 'press machine', '???', '???'],
    'forming_machine',
    ['press_frame', 'hydraulic_cylinder', 'press_bed', 'ram', 'control_panel'],
    ['four-column press frame, hydraulic cylinder, ram and bed'],
  ),
  entry(
    'forming.hydraulicPress',
    'forming.press_frame',
    'punch_press',
    'Punch press',
    ['punch press', 'stamping press', '??', '???'],
    'forming_machine',
    ['press_frame', 'hydraulic_cylinder', 'press_bed', 'ram', 'control_panel'],
    ['press frame, ram, bed and control panel'],
  ),
  entry(
    'forming.hydraulicPress',
    'forming.press_frame',
    'forging_press',
    'Forging press',
    ['forging press', '???'],
    'forming_machine',
    ['press_frame', 'hydraulic_cylinder', 'press_bed', 'ram', 'control_panel'],
    ['heavy press frame, ram, bed and control panel'],
  ),
  entry(
    'forming.hydraulicPress',
    'forming.press_frame',
    'press_fit_machine',
    'Press-fit machine',
    ['press fit machine', 'press fitting machine', '???'],
    'forming_machine',
    ['press_frame', 'hydraulic_cylinder', 'press_bed', 'ram', 'control_panel'],
    ['compact press frame, ram, bed and control pendant'],
  ),
  entry(
    'forming.hydraulicPress',
    'forming.press_frame',
    'riveting_machine',
    'Riveting machine',
    ['riveting machine', '???'],
    'forming_machine',
    ['press_frame', 'hydraulic_cylinder', 'press_bed', 'ram', 'control_panel'],
    ['compact press frame, riveting ram, bed and control panel'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'material_handling.conveyor',
    'belt_conveyor',
    'Belt conveyor',
    ['belt conveyor', 'conveyor', '\u76ae\u5e26\u8f93\u9001\u673a', '\u8f93\u9001\u673a'],
    'material_handling',
    ['conveyor_frame', 'belt_surface', 'roller_array', 'drive_motor'],
    ['conveyor frame, belt, rollers, drive motor'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'material_handling.conveyor',
    'roller_conveyor',
    'Roller conveyor',
    ['roller conveyor', '\u6eda\u7b52\u8f93\u9001\u673a'],
    'material_handling',
    ['conveyor_frame', 'belt_surface', 'roller_array', 'drive_motor'],
    ['conveyor frame, dense rollers and drive motor'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'material_handling.conveyor',
    'assembly_line',
    'Assembly line',
    ['assembly line', '\u88c5\u914d\u6d41\u6c34\u7ebf', '\u88c5\u914d\u7ebf'],
    'material_handling',
    ['conveyor_frame', 'belt_surface', 'roller_array', 'drive_motor'],
    ['long conveyor frame, belt/rollers and station modules'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'material_handling.conveyor',
    'packaging_line',
    'Packaging line',
    ['packaging line', '???'],
    'material_handling',
    ['conveyor_frame', 'belt_surface', 'roller_array', 'drive_motor'],
    ['conveyor frame, belt/rollers and packaging stations'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'centrifugal_pump',
    'Centrifugal pump',
    ['centrifugal pump', 'water pump', 'pump', '???', '?'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, ribbed motor, volute casing, inlet and outlet ports'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'screw_pump',
    'Screw pump',
    ['screw pump', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, ribbed motor, elongated pump casing, inlet and outlet ports'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'gear_pump',
    'Gear pump',
    ['gear pump', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, ribbed motor, compact pump casing, inlet and outlet ports'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'diaphragm_pump',
    'Diaphragm pump',
    ['diaphragm pump', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, motor body, double pump chamber, inlet and outlet ports'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'vacuum_pump',
    'Vacuum pump',
    ['vacuum pump', 'vacuum unit', '???', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, ribbed motor, pump chamber and inlet/outlet ports'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'fan_blower',
    'Industrial fan / blower',
    ['industrial fan', 'blower', 'fan blower', '??', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, motor body, volute blower casing and outlet port'],
  ),
  entry(
    'fluidMachine.centrifugalPump',
    'fluid.rotating_machine',
    'compressor',
    'Compressor',
    ['compressor', 'air compressor', '???'],
    'fluid_machine',
    ROTATING_MACHINE_ROLES,
    ['skid, motor body, compressor casing and inlet/outlet ports'],
  ),
  entry(
    'process.heatExchanger',
    'process.horizontal_cylinder',
    'heat_exchanger',
    'Shell-and-tube heat exchanger',
    ['heat exchanger', '???', '???'],
    'process_equipment',
    HORIZONTAL_CYLINDER_ROLES,
    ['cylindrical shell, tube-sheet caps, ports and saddle supports'],
  ),
  entry(
    'process.heatExchanger',
    'process.horizontal_cylinder',
    'cooler',
    'Cooler',
    ['cooler', '???'],
    'process_equipment',
    HORIZONTAL_CYLINDER_ROLES,
    ['horizontal shell, ports and saddle supports'],
  ),
  entry(
    'process.heatExchanger',
    'process.horizontal_cylinder',
    'condenser',
    'Condenser',
    ['condenser', '???'],
    'process_equipment',
    HORIZONTAL_CYLINDER_ROLES,
    ['horizontal shell, top/bottom ports and saddle supports'],
  ),
  entry(
    'process.heatExchanger',
    'process.horizontal_cylinder',
    'evaporator',
    'Evaporator',
    ['evaporator', '???'],
    'process_equipment',
    HORIZONTAL_CYLINDER_ROLES,
    ['horizontal shell, nozzles and saddle supports'],
  ),
  entry(
    'process.heatExchanger',
    'process.horizontal_cylinder',
    'filter_vessel',
    'Filter vessel',
    ['filter', 'industrial filter', '???'],
    'process_equipment',
    HORIZONTAL_CYLINDER_ROLES,
    ['horizontal pressure vessel, ports and saddle supports'],
  ),
  entry(
    'process.heatExchanger',
    'process.vertical_vessel',
    'vertical_storage_tank',
    'Vertical storage tank',
    ['storage tank', 'vertical tank', '??', '??'],
    'process_equipment',
    ['vessel_shell', 'inlet_port', 'outlet_port', 'support_base'],
    ['vertical cylindrical shell, top/bottom ports and base support'],
  ),
  entry(
    'process.heatExchanger',
    'process.vertical_vessel',
    'settling_tank',
    'Settling tank',
    ['settling tank', '???'],
    'process_equipment',
    ['vessel_shell', 'inlet_port', 'outlet_port', 'support_base'],
    ['vertical vessel shell, liquid zone, inlet/outlet ports and base'],
  ),
  entry(
    'process.heatExchanger',
    'process.vertical_vessel',
    'oil_water_separator',
    'Oil-water separator',
    ['oil water separator', 'oil-water separator', '\u6cb9\u6c34\u5206\u79bb\u5668'],
    'process_equipment',
    ['vessel_shell', 'inlet_port', 'outlet_port', 'support_base'],
    ['vertical separator shell, ports and visible separation band'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'packaging.inline_machine',
    'filling_machine',
    'Filling machine',
    ['filling machine', '???'],
    'packaging_machine',
    ['conveyor_frame', 'machine_base', 'control_panel'],
    ['inline conveyor, filling head station and control panel'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'packaging.inline_machine',
    'sealing_machine',
    'Sealing machine',
    ['sealing machine', '???'],
    'packaging_machine',
    ['conveyor_frame', 'machine_base', 'control_panel'],
    ['inline conveyor, sealing head station and control panel'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'packaging.inline_machine',
    'labeling_machine',
    'Labeling machine',
    ['labeling machine', '???'],
    'packaging_machine',
    ['conveyor_frame', 'machine_base', 'control_panel'],
    ['inline conveyor, label head station and control panel'],
  ),
  entry(
    'materialHandling.beltConveyor',
    'packaging.inline_machine',
    'coding_machine',
    'Coding machine',
    ['coding machine', '???'],
    'packaging_machine',
    ['conveyor_frame', 'machine_base', 'control_panel'],
    ['inline conveyor, coding head station and control panel'],
  ),
]

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

export function findIndustrialArchetype(request: string): IndustrialArchetypeEntry | undefined {
  const text = normalize(request)
  return INDUSTRIAL_ARCHETYPE_ENTRIES.map((entry) => ({
    entry,
    matchLength: Math.max(
      0,
      ...entry.aliases
        .filter((alias) => text.includes(normalize(alias)))
        .map((alias) => normalize(alias).length),
    ),
  }))
    .sort((a, b) => b.matchLength - a.matchLength)
    .find((match) => match.matchLength > 0)?.entry
}

export function findIndustrialArchetypeByRecipeId(
  recipeId: IndustrialArchetypeRecipeId,
): IndustrialArchetypeEntry | undefined {
  return INDUSTRIAL_ARCHETYPE_ENTRIES.find((entry) => entry.recipeId === recipeId)
}

export function industrialAliasesForRecipe(recipeId: IndustrialArchetypeRecipeId): string[] {
  return INDUSTRIAL_ARCHETYPE_ENTRIES.filter((entry) => entry.recipeId === recipeId).flatMap(
    (entry) => entry.aliases,
  )
}
