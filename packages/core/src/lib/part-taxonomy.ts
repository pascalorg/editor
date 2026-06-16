export type PartCapabilityCategory =
  | 'structure'
  | 'connection'
  | 'mechanical'
  | 'fluid'
  | 'electrical'
  | 'visual'

export type GenericPartCapability = {
  id: string
  category: PartCapabilityCategory
  label: string
  partKinds: string[]
  semanticRoles: string[]
}

export type CoreComponentPartCapability = {
  id: string
  component: string
  family?: string
  partKind: string
  semanticRole?: string
  requiredRoles: string[]
  aliases: string[]
}

export const GENERIC_PART_CAPABILITIES: GenericPartCapability[] = [
  {
    id: 'structure.enclosure',
    category: 'structure',
    label: 'enclosure / equipment shell',
    partKinds: [
      'rounded_machine_body',
      'electrical_cabinet',
      'streamlined_body',
      'ellipsoid_shell',
    ],
    semanticRoles: ['equipment_body', 'machine_enclosure', 'vehicle_body'],
  },
  {
    id: 'structure.base_frame',
    category: 'structure',
    label: 'base, skid, support frame',
    partKinds: ['skid_base', 'conveyor_frame', 'platform_ladder', 'leg_set'],
    semanticRoles: ['base', 'support_frame', 'vehicle_bumper'],
  },
  {
    id: 'connection.pipe_port',
    category: 'connection',
    label: 'pipe port, nozzle, flange and bolts',
    partKinds: ['pipe_port', 'inlet_port', 'outlet_port', 'flange_ring', 'bolt_pattern'],
    semanticRoles: ['pipe_port', 'flange', 'bolt'],
  },
  {
    id: 'mechanical.wheel_rotor',
    category: 'mechanical',
    label: 'wheel, rotor, shaft, blade set',
    partKinds: [
      'wheel_set',
      'vehicle_wheels',
      'bicycle_wheels',
      'radial_blades',
      'propeller_blade_set',
      'impeller_blades',
      'airfoil_blade',
      'vertical_pole',
    ],
    semanticRoles: ['vehicle_tire', 'rotor', 'shaft', 'fan_blade'],
  },
  {
    id: 'mechanical.motion_axis',
    category: 'mechanical',
    label: 'linear axis, spindle, rail and moving head',
    partKinds: [
      'pipe_rack',
      'ribbed_motor_body',
      'gearbox_body',
      'rounded_machine_body',
      'aircraft_engine',
    ],
    semanticRoles: ['linear_rail', 'spindle', 'motor', 'machine_head'],
  },
  {
    id: 'fluid.flow_body',
    category: 'fluid',
    label: 'fluid body, tank, volute, valve and pipe runs',
    partKinds: [
      'cylindrical_tank',
      'volute_casing',
      'valve_body',
      'pipe_run',
      'pipe_elbow',
      'heat_exchanger',
    ],
    semanticRoles: ['tank_body', 'pump_volute', 'valve_body', 'pipe_run'],
  },
  {
    id: 'electrical.controls',
    category: 'electrical',
    label: 'control panel, buttons, indicators and cabinets',
    partKinds: ['control_box', 'electrical_cabinet', 'warning_label', 'nameplate', 'cable_tray'],
    semanticRoles: ['control_panel', 'indicator_light', 'electrical_cabinet'],
  },
  {
    id: 'visual.glass_label_vent',
    category: 'visual',
    label: 'glass, labels, vents, seams and grilles',
    partKinds: [
      'window_panel',
      'window_strip',
      'vehicle_windows',
      'curved_lens_panel',
      'vent_grill',
      'vent_slats',
      'nameplate',
      'warning_label',
      'seam_ring',
    ],
    semanticRoles: ['vehicle_window', 'glass_panel', 'vent_grille', 'nameplate'],
  },
]

export const CORE_COMPONENT_PART_CAPABILITIES: CoreComponentPartCapability[] = [
  {
    id: 'wheel.bicycle',
    component: 'wheel',
    family: 'bicycle',
    partKind: 'wheel_set',
    semanticRole: 'bicycle_wheel',
    requiredRoles: ['bicycle_tire', 'bicycle_rim', 'bicycle_hub', 'bicycle_spoke'],
    aliases: ['bicycle_wheel', 'bike_wheel', 'cycle_wheel', 'tire', 'rim'],
  },
  {
    id: 'wheel.vehicle',
    component: 'wheel',
    family: 'vehicle',
    partKind: 'wheel_set',
    semanticRole: 'vehicle_tire',
    requiredRoles: ['vehicle_tire', 'wheel_hub'],
    aliases: ['vehicle_wheel', 'car_wheel', 'automotive_wheel', 'tire', 'tyre', 'rim'],
  },
  {
    id: 'wheel.generic',
    component: 'wheel',
    partKind: 'wheel_set',
    semanticRole: 'wheel_tire',
    requiredRoles: ['wheel_tire', 'wheel_hub'],
    aliases: ['wheel', 'single_wheel', 'tire', 'tyre', 'rim'],
  },
  {
    id: 'window.vehicle',
    component: 'window',
    family: 'vehicle',
    partKind: 'window_panel',
    semanticRole: 'vehicle_window',
    requiredRoles: ['vehicle_window'],
    aliases: ['vehicle_window', 'car_window', 'windshield', 'glass'],
  },
  {
    id: 'window.generic',
    component: 'window',
    partKind: 'window_panel',
    semanticRole: 'window_panel',
    requiredRoles: ['window_panel'],
    aliases: ['window', 'glass_panel', 'windshield'],
  },
  {
    id: 'engine.generic',
    component: 'engine',
    partKind: 'ribbed_motor_body',
    semanticRole: 'engine_body',
    requiredRoles: ['engine_body'],
    aliases: ['engine', 'motor', 'electric_motor'],
  },
  {
    id: 'engine.aircraft',
    component: 'engine',
    family: 'aircraft',
    partKind: 'aircraft_engine',
    semanticRole: 'engine_nacelle',
    requiredRoles: ['engine_nacelle', 'engine_fan', 'engine_intake'],
    aliases: ['aircraft_engine', 'jet_engine', 'engine_nacelle'],
  },
  {
    id: 'propeller.generic',
    component: 'propeller',
    partKind: 'propeller_blade_set',
    requiredRoles: ['propeller_blade'],
    aliases: ['propeller', 'propeller_blades', 'airscrew'],
  },
  {
    id: 'blade.generic',
    component: 'blade',
    partKind: 'airfoil_blade',
    semanticRole: 'airfoil_blade',
    requiredRoles: ['airfoil_blade'],
    aliases: ['blade', 'airfoil', 'airfoil_blade', 'fan_blade'],
  },
]

export function coreComponentPartKinds(): string[] {
  return Array.from(new Set(CORE_COMPONENT_PART_CAPABILITIES.map((entry) => entry.partKind)))
}

export function partCapabilitiesPrompt() {
  return GENERIC_PART_CAPABILITIES.map(
    (capability) =>
      `${capability.id}: ${capability.label}; partKinds=${capability.partKinds.join(', ')}; roles=${capability.semanticRoles.join(', ')}`,
  ).join('\n')
}
