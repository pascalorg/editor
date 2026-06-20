import fs from 'node:fs'
import path from 'node:path'
import type {
  ProcessEquipmentContract,
  ProcessEquipmentPort,
  ProcessLinePlan,
  ProcessStationPlan,
} from './process-line-types'

type EquipmentProfile = Omit<ProcessEquipmentContract, 'ports'> & {
  aliases: RegExp[]
  ports: Array<Omit<ProcessEquipmentPort, 'direction'>>
}

type ProfilePackContract = EquipmentProfile & {
  id: string
  label: string
  sourcePack: {
    id: string
    version: string
    industry: string
  }
}

let cachedProfilePackContracts: ProfilePackContract[] | undefined

function stationText(station: ProcessStationPlan) {
  return [
    station.id,
    station.role,
    station.label,
    station.equipmentHint,
    ...(station.safetyTags ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

function stationIdentityText(station: ProcessStationPlan) {
  return [station.id, station.role, station.label].join(' ').toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function findRepoRootSync(start = process.cwd()) {
  let current = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(current, 'apps', 'editor', 'data', 'profile-pack-cloud'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(start)
    current = parent
  }
}

function profilePackCloudRoot() {
  return path.join(findRepoRootSync(), 'apps', 'editor', 'data', 'profile-pack-cloud')
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-z]:/i.test(normalized) &&
    normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

function aliasPattern(alias: string) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /[a-z]/i.test(alias) ? new RegExp(escaped, 'i') : new RegExp(escaped)
}

const WATER_ELECTROLYSIS_PROFILES: EquipmentProfile[] = [
  {
    profileId: 'hydrogen_electrolysis.electrolyzer_skid.compact',
    equipmentFamily: 'skid.electrolyzer',
    scaleClass: 'conceptual_compact',
    envelope: { length: 4.8, width: 1.55, height: 2.1, origin: 'station_profile', tolerance: 0.08 },
    aliases: [/electroly[sz]er|\u7535\u89e3|\u6c34\u88c2\u89e3/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: [
      'skid_base',
      'electrolyzer_stack',
      'water_in',
      'hydrogen_out',
      'oxygen_out',
      'dc_power',
    ],
    ports: [
      { id: 'water_in', medium: 'water', side: 'left', height: 0.9, offset: -0.38 },
      { id: 'hydrogen_out', medium: 'hydrogen', side: 'right', height: 1.45, offset: -0.36 },
      { id: 'oxygen_out', medium: 'oxygen', side: 'right', height: 1.45, offset: 0.36 },
      { id: 'cooling_in', medium: 'cooling', side: 'left', height: 0.75, offset: 0.36 },
      { id: 'cooling_out', medium: 'cooling', side: 'right', height: 0.75, offset: 0 },
      { id: 'dc_power', medium: 'power', side: 'back', height: 1.65, offset: 0 },
    ],
  },
  {
    profileId: 'hydrogen_electrolysis.rectifier_transformer.compact',
    equipmentFamily: 'electrical.rectifier',
    scaleClass: 'conceptual_compact',
    envelope: {
      length: 2.4,
      width: 1.15,
      height: 2.05,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    aliases: [/dc[_\s-]?power|rectifier|power cabinet|\u7535\u6e90|\u6574\u6d41/i],
    preferredResolver: 'native-box',
    ports: [{ id: 'dc_power_out', medium: 'power', side: 'front', height: 1.55, offset: 0 }],
  },
  {
    profileId: 'hydrogen_electrolysis.water_treatment.compact',
    equipmentFamily: 'skid.water_treatment',
    scaleClass: 'conceptual_compact',
    envelope: {
      length: 2.4,
      width: 1.25,
      height: 1.65,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    aliases: [/water[_\s-]?treatment|pure water|\u7eaf\u6c34|\u6c34\u5904\u7406/i],
    preferredResolver: 'native-box',
    ports: [
      { id: 'feed_water_in', medium: 'water', side: 'left', height: 0.75, offset: 0 },
      { id: 'pure_water_out', medium: 'water', side: 'right', height: 0.85, offset: 0 },
    ],
  },
  {
    profileId: 'hydrogen_electrolysis.gas_liquid_separator.compact',
    equipmentFamily: 'vessel.gas_liquid_separator',
    scaleClass: 'conceptual_compact',
    envelope: {
      length: 1.25,
      width: 1.25,
      height: 2.8,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    aliases: [/separator|gas liquid|\u5206\u79bb\u5668/i],
    preferredResolver: 'native-tank',
    ports: [
      { id: 'gas_in', medium: 'material', side: 'left', height: 1.15, offset: 0 },
      { id: 'gas_out', medium: 'material', side: 'top', height: 2.7, offset: 0 },
    ],
  },
  {
    profileId: 'hydrogen_electrolysis.dryer_buffer.compact',
    equipmentFamily: 'skid.dryer_buffer',
    scaleClass: 'conceptual_compact',
    envelope: {
      length: 2.6,
      width: 1.25,
      height: 1.75,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    aliases: [/drying|buffer|storage|\u5e72\u71e5|\u7f13\u51b2|\u50a8\u7f50/i],
    preferredResolver: 'native-tank',
    ports: [
      { id: 'hydrogen_in', medium: 'hydrogen', side: 'left', height: 1.1, offset: 0 },
      { id: 'hydrogen_out', medium: 'hydrogen', side: 'right', height: 1.1, offset: 0 },
    ],
  },
  {
    profileId: 'hydrogen_electrolysis.cooling_skid.compact',
    equipmentFamily: 'skid.cooling',
    scaleClass: 'conceptual_compact',
    envelope: {
      length: 2.3,
      width: 1.25,
      height: 1.55,
      origin: 'station_profile',
      tolerance: 0.08,
    },
    aliases: [/cooling|heat[_\s-]?exchanger|\u51b7\u5374|\u6362\u70ed/i],
    preferredResolver: 'native-box',
    ports: [
      { id: 'cooling_supply', medium: 'cooling', side: 'left', height: 0.8, offset: -0.25 },
      { id: 'cooling_return', medium: 'cooling', side: 'right', height: 0.8, offset: 0.25 },
    ],
  },
  {
    profileId: 'hydrogen_electrolysis.control_safety.compact',
    equipmentFamily: 'electrical.control_safety',
    scaleClass: 'conceptual_compact',
    envelope: { length: 1.75, width: 0.9, height: 2.0, origin: 'station_profile', tolerance: 0.08 },
    aliases: [/control|safety|monitoring|alarm|\u63a7\u5236|\u5b89\u5168|\u76d1\u63a7/i],
    preferredResolver: 'native-box',
    ports: [{ id: 'signal_power', medium: 'power', side: 'back', height: 1.45, offset: 0 }],
  },
]

const CEMENT_CLINKER_PROFILES: EquipmentProfile[] = [
  {
    profileId: 'cement.bucket_elevator',
    equipmentFamily: 'cement.bucket_elevator',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 1.2, width: 0.9, height: 6, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/raw[_\s-]?meal|feed|bucket[_\s-]?elevator|\u751f\u6599|\u5582\u6599|\u63d0\u5347/i],
    preferredResolver: 'primitive',
    requiredRoles: ['elevator_leg_casing', 'boot_section'],
    ports: [
      { id: 'raw_meal_in', medium: 'material', side: 'left', height: 0.7, offset: 0 },
      { id: 'raw_meal_out', medium: 'material', side: 'right', height: 5.4, offset: 0 },
    ],
  },
  {
    profileId: 'cement.preheater_tower',
    equipmentFamily: 'cement.preheater_tower',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 2.78, width: 1.98, height: 8.1, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/preheater|calciner|cyclone|\u9884\u70ed|\u5206\u89e3|\u65cb\u98ce/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: [
      'preheater_tower_body',
      'preheater_cyclone',
      'preheater_gas_duct',
      'meal_drop_pipe',
      'central_meal_collection_hopper',
    ],
    ports: [
      { id: 'raw_meal_in', medium: 'material', side: 'left', height: 6.2, offset: 0 },
      { id: 'hot_meal_out', medium: 'material', side: 'right', height: 1.1, offset: -0.2 },
      { id: 'tertiary_air_in', medium: 'material', side: 'back', height: 5.9, offset: 0.15 },
      { id: 'exhaust_gas_out', medium: 'material', side: 'top', height: 7.8, offset: 0.25 },
    ],
  },
  {
    profileId: 'cement.rotary_kiln',
    equipmentFamily: 'cement.rotary_kiln',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 6.4, width: 0.8, height: 0.9, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/rotary[_\s-]?kiln|kiln|\u56de\u8f6c\u7a91|\u6c34\u6ce5\u7a91/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: [
      'vessel_shell',
      'kiln_support_base',
      'riding_ring',
      'support_roller',
      'girth_gear',
      'kiln_drive_unit',
      'kiln_tail_feed_hopper',
      'kiln_head_outlet',
    ],
    ports: [
      { id: 'hot_meal_in', medium: 'material', side: 'left', height: 0.9, offset: 0 },
      { id: 'clinker_out', medium: 'material', side: 'right', height: 0.65, offset: 0 },
      { id: 'kiln_exhaust_out', medium: 'material', side: 'left', height: 1.1, offset: -0.25 },
      { id: 'power_in', medium: 'power', side: 'back', height: 0.55, offset: 0.25 },
    ],
  },
  {
    profileId: 'cement.grate_cooler',
    equipmentFamily: 'cement.grate_cooler',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 7, width: 2, height: 1.4, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /grate[_\s-]?cooler|clinker[_\s-]?cooler|\u7be6\u51b7|\u7bf1\u51b7|\u51b7\u5374\u673a/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['cooler_frame', 'cooler_grate_bed', 'grate_plate_rows'],
    ports: [
      { id: 'hot_clinker_in', medium: 'material', side: 'left', height: 0.95, offset: 0 },
      { id: 'cooled_clinker_out', medium: 'material', side: 'right', height: 0.45, offset: 0 },
      { id: 'cooler_exhaust_out', medium: 'material', side: 'top', height: 1.35, offset: 0.25 },
    ],
  },
  {
    profileId: 'cement.belt_conveyor',
    equipmentFamily: 'cement.belt_conveyor',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 8, width: 0.9, height: 0.8, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/clinker[_\s-]?convey|belt[_\s-]?conveyor|\u719f\u6599\u8f93\u9001|\u76ae\u5e26/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['conveyor_frame', 'support_rollers', 'belt_surface'],
    ports: [
      { id: 'material_in', medium: 'material', side: 'left', height: 0.65, offset: 0 },
      { id: 'material_out', medium: 'material', side: 'right', height: 0.65, offset: 0 },
    ],
  },
  {
    profileId: 'cement.clinker_silo',
    equipmentFamily: 'cement.clinker_silo',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 4, width: 4, height: 8, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /clinker[_\s-]?silo|clinker[_\s-]?storage|\u719f\u6599\u5e93|\u719f\u6599\u7b52\u4ed3/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['silo_shell', 'silo_support_base', 'bottom_discharge_hopper'],
    ports: [
      { id: 'top_feed_inlet', medium: 'material', side: 'top', height: 7.7, offset: 0 },
      { id: 'bottom_discharge_outlet', medium: 'material', side: 'right', height: 0.65, offset: 0 },
    ],
  },
  {
    profileId: 'cement.bag_filter',
    equipmentFamily: 'cement.bag_filter',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 2.8, width: 1.8, height: 3, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /bag[_\s-]?filter|baghouse|dust[_\s-]?collector|dedust|\u888b\u6536\u5c18|\u9664\u5c18/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['filter_housing', 'hopper_base'],
    ports: [
      { id: 'dust_gas_in', medium: 'material', side: 'left', height: 2.1, offset: -0.35 },
      { id: 'clean_air_out', medium: 'material', side: 'top', height: 2.85, offset: 0 },
      { id: 'dust_discharge', medium: 'material', side: 'right', height: 0.45, offset: 0.35 },
    ],
  },
  {
    profileId: 'cement.limestone_crusher',
    equipmentFamily: 'cement.limestone_crusher',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 4.2, width: 2.4, height: 2.6, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /limestone[_\s-]?crusher|stone[_\s-]?crusher|\u77f3\u7070\u77f3\u7834\u788e|\u7834\u788e\u673a/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['crusher_housing', 'limestone_feed_hopper', 'crushed_material_discharge'],
    ports: [
      { id: 'limestone_feed_in', medium: 'material', side: 'left', height: 1.85, offset: 0 },
      { id: 'crushed_material_out', medium: 'material', side: 'right', height: 0.65, offset: 0 },
    ],
  },
  {
    profileId: 'cement.stack_reclaimer',
    equipmentFamily: 'cement.stack_reclaimer',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 10, width: 2.6, height: 2.8, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /stacker[_\s-]?reclaimer|reclaimer|pre[_\s-]?homogenization|\u5806\u53d6\u6599|\u9884\u5747\u5316/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['reclaimer_bridge', 'bucket_wheel', 'stockpile_conveyor'],
    ports: [
      { id: 'raw_material_in', medium: 'material', side: 'left', height: 1.35, offset: 0 },
      { id: 'blended_material_out', medium: 'material', side: 'right', height: 1.35, offset: 0 },
    ],
  },
  {
    profileId: 'cement.vertical_raw_mill',
    equipmentFamily: 'cement.vertical_raw_mill',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.4, width: 2.6, height: 4.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /raw[_\s-]?mill|vertical[_\s-]?raw[_\s-]?mill|vertical[_\s-]?roller[_\s-]?mill|\u539f\u6599\u78e8|\u751f\u6599\u7acb\u78e8/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['mill_body', 'raw_material_feed', 'hot_gas_inlet_header', 'mill_drive_unit'],
    ports: [
      { id: 'raw_feed_in', medium: 'material', side: 'left', height: 2.6, offset: -0.25 },
      { id: 'raw_meal_out', medium: 'material', side: 'right', height: 3.5, offset: 0.25 },
      { id: 'hot_gas_in', medium: 'material', side: 'back', height: 1.8, offset: 0 },
      { id: 'power_in', medium: 'power', side: 'back', height: 0.85, offset: -0.45 },
    ],
  },
  {
    profileId: 'cement.raw_meal_homogenization_silo',
    equipmentFamily: 'cement.raw_meal_homogenization_silo',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 4.2, width: 4.2, height: 8.5, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /raw[_\s-]?meal[_\s-]?silo|homogenization[_\s-]?silo|\u751f\u6599\u5747\u5316\u5e93|\u751f\u6599\u5e93/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['raw_meal_silo_shell', 'bottom_discharge_hopper'],
    ports: [
      { id: 'top_feed_inlet', medium: 'material', side: 'top', height: 8.15, offset: 0 },
      { id: 'raw_meal_out', medium: 'material', side: 'right', height: 0.85, offset: 0 },
    ],
  },
  {
    profileId: 'cement.coal_mill',
    equipmentFamily: 'cement.coal_mill',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.4, width: 2.4, height: 3.6, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/coal[_\s-]?mill|fuel[_\s-]?mill|\u7164\u78e8|\u71c3\u6599\u5236\u5907/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['coal_mill_body', 'dynamic_separator', 'inert_gas_duct'],
    ports: [
      { id: 'coal_feed_in', medium: 'material', side: 'left', height: 1.75, offset: 0 },
      { id: 'pulverized_fuel_out', medium: 'material', side: 'right', height: 2.8, offset: 0 },
      { id: 'hot_gas_in', medium: 'material', side: 'back', height: 1.6, offset: 0 },
    ],
  },
  {
    profileId: 'cement.kiln_burner',
    equipmentFamily: 'cement.kiln_burner',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.8, width: 0.9, height: 1.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/kiln[_\s-]?burner|burner|\u7a91\u5934\u71c3\u70e7\u5668|\u71c3\u70e7\u5668/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['burner_lance', 'primary_air_pipe', 'fuel_pipe', 'burner_carriage'],
    ports: [
      { id: 'fuel_in', medium: 'material', side: 'left', height: 0.95, offset: 0 },
      { id: 'flame_out', medium: 'material', side: 'right', height: 0.8, offset: 0 },
    ],
  },
  {
    profileId: 'cement.kiln_hood',
    equipmentFamily: 'cement.kiln_hood',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.2, width: 2.4, height: 2.4, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/kiln[_\s-]?hood|kiln[_\s-]?head[_\s-]?hood|\u7a91\u5934\u7f69/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['kiln_hood_shell', 'kiln_head_in', 'burner_opening', 'hot_clinker_out'],
    ports: [
      { id: 'kiln_head_in', medium: 'material', side: 'left', height: 1.1, offset: 0 },
      { id: 'burner_opening', medium: 'material', side: 'left', height: 1.35, offset: -0.42 },
      { id: 'hot_clinker_out', medium: 'material', side: 'right', height: 0.72, offset: 0 },
    ],
  },
  {
    profileId: 'cement.tertiary_air_duct',
    equipmentFamily: 'cement.tertiary_air_duct',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 6.2, width: 0.9, height: 1.4, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/tertiary[_\s-]?air[_\s-]?duct|\u4e09\u6b21\u98ce\u7ba1|\u4e09\u6b21\u98ce/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['tertiary_air_duct_shell', 'cooler_air_in', 'tertiary_air_out'],
    ports: [
      { id: 'cooler_air_in', medium: 'material', side: 'left', height: 1.05, offset: 0 },
      { id: 'tertiary_air_out', medium: 'material', side: 'right', height: 1.05, offset: 0 },
    ],
  },
  {
    profileId: 'cement.clinker_crusher',
    equipmentFamily: 'cement.clinker_crusher',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3, width: 1.8, height: 1.8, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/clinker[_\s-]?crusher|\u719f\u6599\u7834\u788e/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['clinker_crusher_housing', 'hot_clinker_in', 'crushed_clinker_out'],
    ports: [
      { id: 'hot_clinker_in', medium: 'material', side: 'left', height: 1.0, offset: 0 },
      { id: 'crushed_clinker_out', medium: 'material', side: 'right', height: 0.58, offset: 0 },
    ],
  },
  {
    profileId: 'cement.esp_dust_collector',
    equipmentFamily: 'cement.esp_dust_collector',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 5.2, width: 2.2, height: 3.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /esp|electrostatic[_\s-]?precipitator|kiln[_\s-]?tail[_\s-]?esp|\u7535\u6536\u5c18|\u9759\u7535\u9664\u5c18/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['esp_collector_chambers', 'dust_hopper_bank'],
    ports: [
      { id: 'dust_gas_in', medium: 'material', side: 'left', height: 1.65, offset: 0 },
      { id: 'clean_air_out', medium: 'material', side: 'right', height: 1.75, offset: 0 },
      { id: 'dust_discharge', medium: 'material', side: 'right', height: 0.45, offset: 0.5 },
    ],
  },
  {
    profileId: 'cement.process_stack',
    equipmentFamily: 'cement.process_stack',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 2.4, width: 2.4, height: 10, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/process[_\s-]?stack|cement[_\s-]?stack|chimney|smokestack|\u70df\u56f1/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['stack_shell', 'stack_base_plinth'],
    ports: [
      { id: 'stack_gas_in', medium: 'material', side: 'left', height: 1.15, offset: 0 },
      { id: 'stack_outlet', medium: 'material', side: 'top', height: 9.75, offset: 0 },
    ],
  },
  {
    profileId: 'cement.cement_mill',
    equipmentFamily: 'cement.cement_mill',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 7, width: 2.2, height: 2.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [/cement[_\s-]?mill|ball[_\s-]?mill|\u6c34\u6ce5\u78e8|\u7403\u78e8/i],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['mill_shell', 'mill_support_base', 'mill_drive_unit'],
    ports: [
      { id: 'feed_inlet', medium: 'material', side: 'left', height: 1.35, offset: 0 },
      { id: 'product_outlet', medium: 'material', side: 'right', height: 1.35, offset: 0 },
      { id: 'power_in', medium: 'power', side: 'back', height: 0.85, offset: 0 },
    ],
  },
  {
    profileId: 'cement.cement_silo',
    equipmentFamily: 'cement.cement_silo',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.6, width: 3.6, height: 7.5, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /cement[_\s-]?silo|cement[_\s-]?storage|\u6c34\u6ce5\u5e93|\u6c34\u6ce5\u7b52\u4ed3/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['cement_silo_shell', 'silo_support_base', 'bulk_discharge_hopper'],
    ports: [
      { id: 'top_feed_inlet', medium: 'material', side: 'top', height: 7.2, offset: 0 },
      { id: 'bulk_discharge_outlet', medium: 'material', side: 'right', height: 0.65, offset: 0 },
    ],
  },
  {
    profileId: 'cement.cement_packer',
    equipmentFamily: 'cement.cement_packer',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 2.6, width: 1.8, height: 2.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /cement[_\s-]?packer|rotary[_\s-]?packer|packing[_\s-]?machine|\u6c34\u6ce5\u5305\u88c5\u673a|\u5305\u88c5\u673a/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['packer_body', 'cement_feed_hopper', 'bag_discharge_chute'],
    ports: [
      { id: 'cement_feed_inlet', medium: 'material', side: 'left', height: 1.9, offset: 0 },
      { id: 'packed_bag_out', medium: 'material', side: 'right', height: 0.8, offset: 0 },
    ],
  },
  {
    profileId: 'cement.whr_boiler',
    equipmentFamily: 'cement.whr_boiler',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 3.8, width: 2.4, height: 5.2, origin: 'station_profile', tolerance: 0.1 },
    aliases: [
      /whr[_\s-]?boiler|waste[_\s-]?heat[_\s-]?recovery|aqc[_\s-]?boiler|sp[_\s-]?boiler|\u4f59\u70ed\u9505\u7089|\u4f59\u70ed\u53d1\u7535/i,
    ],
    preferredTool: 'compose_parts',
    preferredResolver: 'primitive',
    requiredRoles: ['boiler_casing', 'tube_bank', 'hot_gas_in'],
    ports: [
      { id: 'hot_gas_in', medium: 'material', side: 'left', height: 3.2, offset: 0 },
      { id: 'cooled_gas_out', medium: 'material', side: 'right', height: 3.2, offset: 0 },
    ],
  },
  {
    profileId: 'electrical.mcc_control',
    equipmentFamily: 'electrical.mcc_control',
    scaleClass: 'conceptual_industrial',
    envelope: { length: 4.2, width: 0.9, height: 2.2, origin: 'station_profile', tolerance: 0.08 },
    aliases: [
      /mcc|motor[_\s-]?control|control[_\s-]?cabinet|\u63a7\u5236\u67dc|\u7535\u63a7\u67dc|\u9a6c\u8fbe\u63a7\u5236/i,
    ],
    preferredResolver: 'native-box',
    ports: [{ id: 'power_out', medium: 'power', side: 'front', height: 1.6, offset: 0 }],
  },
]

function profileMatches(profile: EquipmentProfile, station: ProcessStationPlan) {
  if (profile.equipmentFamily === 'skid.electrolyzer') {
    return /electroly[sz]er|\u7535\u89e3|\u6c34\u88c2\u89e3/i.test(stationIdentityText(station))
  }
  if (profile.equipmentFamily.startsWith('cement.')) {
    const identity = stationIdentityText(station)
    switch (profile.profileId) {
      case 'cement.bucket_elevator':
        return /raw[_\s-]?meal[_\s-]?feed|bucket[_\s-]?elevator|\u751f\u6599\u5582\u6599/.test(
          identity,
        )
      case 'cement.preheater_tower':
        return /preheater|calciner|\u9884\u70ed|\u5206\u89e3/.test(identity)
      case 'cement.rotary_kiln':
        return /rotary[_\s-]?kiln|\u56de\u8f6c\u7a91|\u6c34\u6ce5\u7a91/.test(identity)
      case 'cement.grate_cooler':
        return /grate[_\s-]?cooler|clinker[_\s-]?cooler|\u7be6\u51b7|\u7bf1\u51b7|\u51b7\u5374\u673a/.test(
          identity,
        )
      case 'cement.belt_conveyor':
        return /clinker[_\s-]?convey|belt[_\s-]?conveyor|\u719f\u6599\u8f93\u9001|\u76ae\u5e26/.test(
          identity,
        )
      case 'cement.clinker_silo':
        return /clinker[_\s-]?silo|clinker[_\s-]?storage|\u719f\u6599\u5e93|\u719f\u6599\u7b52\u4ed3/.test(
          identity,
        )
      case 'cement.bag_filter':
        return /bag[_\s-]?filter|baghouse|dust[_\s-]?collector|dedust|kiln[_\s-]?dedusting|\u888b\u6536\u5c18|\u9664\u5c18/.test(
          identity,
        )
      case 'cement.kiln_burner':
        return /kiln[_\s-]?burner|\u7a91\u5934\u71c3\u70e7\u5668|\u71c3\u70e7\u5668/.test(identity)
      case 'cement.kiln_hood':
        return /kiln[_\s-]?hood|kiln[_\s-]?head[_\s-]?hood|\u7a91\u5934\u7f69/.test(identity)
    }
  }
  const text = stationText(station)
  return profile.aliases.some((pattern) => pattern.test(text))
}

function portDirection(side: ProcessEquipmentPort['side']): ProcessEquipmentPort['direction'] {
  switch (side) {
    case 'left':
      return [-1, 0, 0]
    case 'right':
      return [1, 0, 0]
    case 'front':
      return [0, 0, 1]
    case 'back':
      return [0, 0, -1]
    case 'top':
      return [0, 1, 0]
  }
}

function materializeProfile(profile: EquipmentProfile): ProcessEquipmentContract {
  return {
    profileId: profile.profileId,
    equipmentFamily: profile.equipmentFamily,
    scaleClass: profile.scaleClass,
    envelope: { ...profile.envelope },
    ports: profile.ports.map((port) => ({
      ...port,
      direction: portDirection(port.side),
    })),
    ...(profile.requiredRoles ? { requiredRoles: [...profile.requiredRoles] } : {}),
    ...(profile.preferredTool ? { preferredTool: profile.preferredTool } : {}),
    ...(profile.preferredResolver ? { preferredResolver: profile.preferredResolver } : {}),
    ...(profile.profileParts ? { profileParts: profile.profileParts.map((part) => ({ ...part })) } : {}),
    ...(profile.primarySemanticRole ? { primarySemanticRole: profile.primarySemanticRole } : {}),
  }
}

function numericTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const [x, y, z] = value
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    ? [x, y, z]
    : undefined
}

function normalizePortToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^(dc_|prepared_)/, '')
    .replace(/_(in|out|inlet|outlet|input|output|feed|discharge|bridge|cone|pipe|header)$/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function profilePartSemanticRole(part: Record<string, unknown>) {
  return stringValue(part.semanticRole) ?? stringValue(part.id) ?? stringValue(part.name)
}

function profilePartMatchesPort(part: Record<string, unknown>, portId: string) {
  const role = profilePartSemanticRole(part)
  if (!role) return false
  if (role === portId) return true
  const normalizedRole = normalizePortToken(role)
  const normalizedPort = normalizePortToken(portId)
  if (!normalizedRole || !normalizedPort) return false
  return normalizedRole.includes(normalizedPort) || normalizedPort.includes(normalizedRole)
}

function inferPortSide(input: {
  endpoint: 'from' | 'to'
  part?: Record<string, unknown>
  contract: ProcessEquipmentContract
}): ProcessEquipmentPort['side'] {
  const position = numericTuple(input.part?.position)
  if (!position) return input.endpoint === 'from' ? 'right' : 'left'

  const [x, , z] = position
  const halfLength = input.contract.envelope.length / 2
  const halfWidth = input.contract.envelope.width / 2
  const nearLeftRight = Math.abs(x) / Math.max(halfLength, 0.001)
  const nearFrontBack = Math.abs(z) / Math.max(halfWidth, 0.001)
  if (nearLeftRight >= nearFrontBack) return x >= 0 ? 'right' : 'left'
  return z >= 0 ? 'front' : 'back'
}

function inferPortHeight(input: {
  part?: Record<string, unknown>
  contract: ProcessEquipmentContract
}) {
  const position = numericTuple(input.part?.position)
  const partHeight =
    typeof input.part?.height === 'number' && Number.isFinite(input.part.height)
      ? input.part.height
      : undefined
  if (position) return Math.max(0.1, Math.min(input.contract.envelope.height, position[1] + (partHeight ?? 0) / 2))
  return Math.max(0.2, input.contract.envelope.height * 0.55)
}

function inferPortOffset(input: {
  side: ProcessEquipmentPort['side']
  part?: Record<string, unknown>
}) {
  const position = numericTuple(input.part?.position)
  if (!position) return 0
  if (input.side === 'left' || input.side === 'right') return position[2]
  return position[0]
}

function expectedPortsForStation(plan: ProcessLinePlan | undefined, station: ProcessStationPlan) {
  if (!plan) return []
  return plan.connections.flatMap((connection) => {
    const ports: Array<{
      id: string
      endpoint: 'from' | 'to'
      medium: ProcessEquipmentPort['medium']
    }> = []
    if (connection.fromStationId === station.id && connection.fromPortId) {
      ports.push({
        id: connection.fromPortId,
        endpoint: 'from',
        medium: connection.medium ?? 'material',
      })
    }
    if (connection.toStationId === station.id && connection.toPortId) {
      ports.push({
        id: connection.toPortId,
        endpoint: 'to',
        medium: connection.medium ?? 'material',
      })
    }
    return ports
  })
}

function enrichContractPortsFromProcessPlan(input: {
  contract: ProcessEquipmentContract
  plan?: ProcessLinePlan
  station: ProcessStationPlan
}): ProcessEquipmentContract {
  const expectedPorts = expectedPortsForStation(input.plan, input.station)
  if (!expectedPorts.length) return input.contract

  const ports = [...input.contract.ports]
  const parts = input.contract.profileParts ?? []
  for (const expected of expectedPorts) {
    if (ports.some((port) => port.id === expected.id)) continue
    const part = parts.find((candidate) => profilePartMatchesPort(candidate, expected.id))
    const side = inferPortSide({ endpoint: expected.endpoint, part, contract: input.contract })
    ports.push({
      id: expected.id,
      medium: expected.medium,
      side,
      height: inferPortHeight({ part, contract: input.contract }),
      offset: inferPortOffset({ side, part }),
      direction: portDirection(side),
    })
  }
  return { ...input.contract, ports }
}

function profilePortSide(value: unknown): ProcessEquipmentPort['side'] | undefined {
  return value === 'left' ||
    value === 'right' ||
    value === 'front' ||
    value === 'back' ||
    value === 'top'
    ? value
    : undefined
}

function profilePortMedium(value: unknown): ProcessEquipmentPort['medium'] | undefined {
  return value === 'water' ||
    value === 'hydrogen' ||
    value === 'oxygen' ||
    value === 'power' ||
    value === 'cooling' ||
    value === 'material' ||
    value === 'gas' ||
    value === 'molten_metal'
    ? value
    : undefined
}

function normalizeProfilePackPort(raw: unknown): Omit<ProcessEquipmentPort, 'direction'> | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const medium = profilePortMedium(raw.medium)
  const side = profilePortSide(raw.side)
  const height = positiveNumber(raw.height)
  if (!id || !medium || !side || height == null) return null
  const offset =
    typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? raw.offset : undefined
  return {
    id,
    medium,
    side,
    height,
    ...(offset != null ? { offset } : {}),
  }
}

function inferProfilePackPortMedium(role: string): ProcessEquipmentPort['medium'] {
  if (/air|gas|exhaust|dust|smoke|flue/i.test(role)) return 'gas'
  if (/cooling|coolant/i.test(role)) return 'cooling'
  if (/power|electric/i.test(role)) return 'power'
  if (/water/i.test(role)) return 'water'
  if (/molten/i.test(role)) return 'molten_metal'
  return 'material'
}

function inferProfilePackPortSide(
  position: [number, number, number] | undefined,
  envelope: { length: number; width: number },
  kind: string,
): ProcessEquipmentPort['side'] {
  if (!position) return kind === 'inlet_port' ? 'left' : 'right'
  const [x, , z] = position
  const nearLongSide = Math.abs(x) / Math.max(envelope.length / 2, 0.001)
  const nearWideSide = Math.abs(z) / Math.max(envelope.width / 2, 0.001)
  if (nearLongSide >= nearWideSide) return x >= 0 ? 'right' : 'left'
  return z >= 0 ? 'front' : 'back'
}

function inferProfilePackPortsFromParts(
  parts: Record<string, unknown>[] | undefined,
  envelope: { length: number; width: number; height: number },
) {
  if (!parts?.length) return []
  const ports: Array<Omit<ProcessEquipmentPort, 'direction'>> = []
  for (const part of parts) {
    const kind = stringValue(part.kind)
    if (kind !== 'inlet_port' && kind !== 'outlet_port') continue
    const role = profilePartSemanticRole(part)
    if (!role) continue
    const position = numericTuple(part.position)
    const side = inferProfilePackPortSide(position, envelope, kind)
    ports.push({
      id: role,
      medium: inferProfilePackPortMedium(role),
      side,
      height: position ? Math.max(0.1, Math.min(envelope.height, position[1])) : envelope.height * 0.55,
      offset: inferPortOffset({ side, part }),
    })
  }
  return ports
}

function preferredProfilePackResolver(raw: Record<string, unknown>, id: string) {
  if (
    raw.preferredResolver === 'catalog-item' ||
    raw.preferredResolver === 'native-box' ||
    raw.preferredResolver === 'native-tank' ||
    raw.preferredResolver === 'primitive' ||
    raw.preferredResolver === 'profile-parts'
  ) {
    return raw.preferredResolver
  }
  return id.startsWith('cement.') ? 'primitive' : 'profile-parts'
}

function normalizeProfilePackContract(
  raw: unknown,
  manifest: { id: string; version: string; industry: string },
): ProfilePackContract | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const dimensions = isRecord(raw.defaultDimensions) ? raw.defaultDimensions : undefined
  const length = positiveNumber(dimensions?.length) ?? positiveNumber(dimensions?.diameter)
  const width = positiveNumber(dimensions?.width) ?? positiveNumber(dimensions?.diameter)
  const height = positiveNumber(dimensions?.height)
  if (!id || !length || !width || !height) return null
  const name = stringValue(raw.name) ?? id
  const ports = Array.isArray(raw.processPorts)
    ? raw.processPorts
        .map(normalizeProfilePackPort)
        .filter((port): port is Omit<ProcessEquipmentPort, 'direction'> => Boolean(port))
    : []
  const requiredRoles = Array.isArray(raw.parts)
    ? raw.parts
        .filter(isRecord)
        .flatMap((part) =>
          part.required !== false && typeof part.semanticRole === 'string'
            ? [part.semanticRole]
            : [],
        )
    : undefined
  const profileParts = Array.isArray(raw.parts)
    ? raw.parts.filter(isRecord).map((part) => ({ ...part }))
    : undefined
  const inferredPorts = inferProfilePackPortsFromParts(profileParts, { length, width, height })
  const mergedPorts = [
    ...ports,
    ...inferredPorts.filter((port) => !ports.some((existing) => existing.id === port.id)),
  ]
  const primarySemanticRole = stringValue(raw.primarySemanticRole)
  return {
    id,
    label: name,
    profileId: id,
    equipmentFamily:
      stringValue(raw.archetypeFamily) ?? stringValue(raw.family) ?? id.replace(/\.[^.]+$/, ''),
    scaleClass: 'industry_profile',
    envelope: {
      length,
      width,
      height,
      origin: 'station_profile',
      tolerance: 0.12,
    },
    aliases: [id, id.split('.').pop() ?? id, name, ...stringArray(raw.aliases)].map(aliasPattern),
    preferredTool: raw.preferredTool === 'compose_assembly' ? 'compose_assembly' : 'compose_parts',
    preferredResolver: preferredProfilePackResolver(raw, id),
    ...(requiredRoles?.length ? { requiredRoles } : {}),
    ...(profileParts?.length ? { profileParts } : {}),
    ...(primarySemanticRole ? { primarySemanticRole } : {}),
    ports: mergedPorts,
    sourcePack: {
      id: manifest.id,
      version: manifest.version,
      industry: manifest.industry,
    },
  }
}

function loadProfilePackContractsFromDir(dir: string): ProfilePackContract[] {
  const manifestPath = path.join(dir, 'pack.json')
  if (!fs.existsSync(manifestPath)) return []
  const manifest = readJson(manifestPath)
  if (!isRecord(manifest)) return []
  const profilePaths = stringArray(manifest.profiles)
  const resolvedDir = path.resolve(dir)
  const contracts: ProfilePackContract[] = []
  for (const rel of profilePaths) {
    if (!safeRelativePath(rel)) continue
    const file = path.resolve(dir, rel)
    if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) continue
    if (!fs.existsSync(file)) continue
    const raw = readJson(file)
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      const contract = normalizeProfilePackContract(value, {
        id: String(manifest.id),
        version: String(manifest.version),
        industry: String(manifest.industry),
      })
      if (contract) contracts.push(contract)
    }
  }
  return contracts
}

function loadProfilePackContracts() {
  if (cachedProfilePackContracts) return cachedProfilePackContracts
  const root = profilePackCloudRoot()
  if (!fs.existsSync(root)) {
    cachedProfilePackContracts = []
    return cachedProfilePackContracts
  }
  cachedProfilePackContracts = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return loadProfilePackContractsFromDir(path.join(root, entry.name))
      } catch {
        return []
      }
    })
  return cachedProfilePackContracts
}

function resolveProfilePackContract(plan: ProcessLinePlan | undefined, station: ProcessStationPlan) {
  const text = stationText(station)
  const identity = stationIdentityText(station)
  const allProfiles = loadProfilePackContracts()
  const profiles = plan?.sourcePack
    ? allProfiles.filter(
        (profile) =>
          profile.sourcePack.id === plan.sourcePack?.id &&
          profile.sourcePack.version === plan.sourcePack.version &&
          profile.sourcePack.industry === plan.sourcePack.industry,
      )
    : allProfiles.filter((profile) => text.includes(profile.id.toLowerCase()))
  const exact = profiles.find((profile) => {
    const localId = profile.id.split('.').pop() ?? profile.id
    return (
      identity.split(/\s+/).includes(profile.id.toLowerCase()) ||
      identity.split(/\s+/).includes(localId.toLowerCase()) ||
      text.includes(profile.id.toLowerCase())
    )
  })
  if (exact) return exact
  return profiles.find((profile) =>
    profile.aliases.some((pattern) => pattern.test(text)),
  )
}

export function resolveProcessEquipmentContract(input: {
  plan?: ProcessLinePlan
  station: ProcessStationPlan
}): ProcessEquipmentContract | undefined {
  const packProfile = resolveProfilePackContract(input.plan, input.station)
  if (packProfile) {
    return enrichContractPortsFromProcessPlan({
      contract: materializeProfile(packProfile),
      plan: input.plan,
      station: input.station,
    })
  }

  const isWaterElectrolysis =
    input.plan?.processId === 'water_electrolysis_hydrogen' ||
    /electrolys|hydrogen|\u5236\u6c22|\u7535\u89e3|\u6c22/i.test(input.plan?.processLabel ?? '')
  const isCementClinker =
    input.plan?.processId === 'cement_clinker_production_line' ||
    input.plan?.processId === 'cement_plant_full' ||
    /cement plant|cement factory|cement clinker|clinker production|\u6c34\u6ce5\u5de5\u5382|\u6c34\u6ce5\u5382|\u6c34\u6ce5\u719f\u6599|\u719f\u6599\u4ea7\u7ebf|\u6c34\u6ce5\u7a91/i.test(
      input.plan?.processLabel ?? '',
    )
  const profiles = isWaterElectrolysis
    ? WATER_ELECTROLYSIS_PROFILES
    : isCementClinker
      ? CEMENT_CLINKER_PROFILES
      : undefined

  const profile = profiles?.find((candidate) => profileMatches(candidate, input.station))
  if (profile) {
    return enrichContractPortsFromProcessPlan({
      contract: materializeProfile(profile),
      plan: input.plan,
      station: input.station,
    })
  }

  return undefined
}

export function resetProcessEquipmentContractCacheForTests() {
  cachedProfilePackContracts = undefined
}
