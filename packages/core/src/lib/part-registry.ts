import type { PartComposePartInput } from './part-compose'

export type PartParameterType = 'number' | 'integer' | 'string' | 'boolean' | 'color' | 'enum'

export interface PartParameterDefinition {
  type: PartParameterType
  min?: number
  max?: number
  default?: unknown
  values?: readonly unknown[]
  description?: string
}

export interface PartDefinition {
  id: string
  family: string
  kind: string
  semanticRole?: string
  aliases: readonly string[]
  required?: boolean
  params: Record<string, PartParameterDefinition>
  attachTo?: string
  layoutRole?: string
  description: string
}

export interface NormalizedPartPlan {
  family: string
  parts: PartComposePartInput[]
  warnings: string[]
}

export const VEHICLE_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'vehicle.body_shell',
    family: 'vehicle',
    kind: 'body_shell',
    semanticRole: 'vehicle_body',
    aliases: ['body', 'car_body', 'vehicle_body', 'main_body', 'chassis', '车身', '底盘'],
    required: true,
    description: 'Main vehicle body shell.',
    params: {
      length: { type: 'number', min: 2, max: 8, default: 4.4 },
      width: { type: 'number', min: 1, max: 3, default: 1.8 },
      height: { type: 'number', min: 0.7, max: 3, default: 1.35 },
      primaryColor: { type: 'color', default: '#cc0000' },
      vehicleStyle: {
        type: 'enum',
        values: ['sedan', 'suv', 'sports', 'truck', 'van'],
        default: 'sedan',
      },
      cornerRadius: { type: 'number', min: 0, max: 0.8 },
    },
  },
  {
    id: 'vehicle.wheel_set',
    family: 'vehicle',
    kind: 'wheel_set',
    semanticRole: 'vehicle_tire',
    aliases: ['wheel', 'wheels', 'tire', 'tyre', 'vehicle_wheels', '车轮', '轮胎'],
    required: true,
    attachTo: 'body_shell',
    layoutRole: 'lower_four_corners',
    description: 'Vehicle wheel/tire set.',
    params: {
      count: { type: 'integer', values: [2, 4, 6], default: 4 },
      radius: { type: 'number', min: 0.15, max: 0.8, default: 0.38 },
      width: { type: 'number', min: 0.08, max: 0.5, default: 0.22 },
      wheelRadius: { type: 'number', min: 0.15, max: 0.8 },
      wheelWidth: { type: 'number', min: 0.08, max: 0.5 },
      hubColor: { type: 'color', default: '#d8d8d8' },
    },
  },
  {
    id: 'vehicle.window_strip',
    family: 'vehicle',
    kind: 'window_strip',
    semanticRole: 'vehicle_window',
    aliases: ['window', 'windows', 'vehicle_windows', 'glass', 'windshield', '车窗', '玻璃'],
    required: true,
    attachTo: 'body_shell',
    layoutRole: 'cabin_band',
    description: 'Vehicle glasshouse/window band.',
    params: {
      height: { type: 'number', min: 0.12, max: 1.2, default: 0.42 },
      tint: { type: 'color', default: '#77aaff' },
      opacity: { type: 'number', min: 0.1, max: 1, default: 0.68 },
      variant: { type: 'enum', values: ['vehicle_glasshouse'], default: 'vehicle_glasshouse' },
    },
  },
  {
    id: 'vehicle.light_pair',
    family: 'vehicle',
    kind: 'light_pair',
    semanticRole: 'headlight',
    aliases: ['light', 'lights', 'headlight', 'headlights', '车灯', '大灯'],
    required: true,
    attachTo: 'body_shell',
    layoutRole: 'front_face',
    description: 'Front light pair.',
    params: {
      size: { type: 'number', min: 0.04, max: 0.4, default: 0.12 },
      color: { type: 'color', default: '#f8fafc' },
    },
  },
  {
    id: 'vehicle.bar_pair',
    family: 'vehicle',
    kind: 'bar_pair',
    aliases: ['bumper', 'bumpers', 'front_bumper', 'rear_bumper', '保险杠'],
    required: true,
    attachTo: 'body_shell',
    layoutRole: 'front_rear_bars',
    description: 'Front and rear bumper bars.',
    params: {
      height: { type: 'number', min: 0.04, max: 0.35, default: 0.12 },
      thickness: { type: 'number', min: 0.02, max: 0.2, default: 0.06 },
    },
  },
  {
    id: 'vehicle.seam_ring',
    family: 'vehicle',
    kind: 'seam_ring',
    aliases: ['seam', 'panel_seam', 'trim', '腰线', '缝线'],
    attachTo: 'body_shell',
    layoutRole: 'body_detail',
    description: 'Body seam or trim detail.',
    params: {
      radius: { type: 'number', min: 0.04, max: 0.5, default: 0.18 },
    },
  },
]

export const DESK_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'desk.desk_top',
    family: 'desk',
    kind: 'desk_top',
    semanticRole: 'furniture_body',
    aliases: ['desk', 'table', 'desktop', 'tabletop', 'worktop', 'office_desk', 'writing_desk'],
    required: true,
    description: 'Desk or table top slab.',
    params: {
      length: { type: 'number', min: 0.35, max: 4, default: 1.2 },
      width: { type: 'number', min: 0.2, max: 2, default: 0.6 },
      height: { type: 'number', min: 0.02, max: 0.18, default: 0.055 },
      primaryColor: { type: 'color', default: '#b7794b' },
    },
  },
  {
    id: 'desk.leg_set',
    family: 'desk',
    kind: 'leg_set',
    semanticRole: 'support_leg',
    aliases: ['legs', 'table_legs', 'desk_legs', 'support_legs', 'feet', 'supports'],
    required: true,
    attachTo: 'desk_top',
    layoutRole: 'four_corners_under_top',
    description: 'Four desk/table legs with rear stretcher.',
    params: {
      length: { type: 'number', min: 0.25, max: 4, default: 1.08 },
      width: { type: 'number', min: 0.15, max: 2, default: 0.5 },
      height: { type: 'number', min: 0.12, max: 1.4, default: 0.7 },
      radius: { type: 'number', min: 0.008, max: 0.09, default: 0.025 },
      metalColor: { type: 'color', default: '#9ca3af' },
    },
  },
  {
    id: 'desk.drawer_stack',
    family: 'desk',
    kind: 'drawer_stack',
    semanticRole: 'drawer_stack',
    aliases: ['drawer', 'drawers', 'drawer_stack', 'cabinet_drawers', 'side_drawers'],
    attachTo: 'desk_top',
    layoutRole: 'side_under_top',
    description: 'Optional drawer cabinet under one side of a desk.',
    params: {
      length: { type: 'number', min: 0.14, max: 1.2, default: 0.34 },
      width: { type: 'number', min: 0.12, max: 1, default: 0.44 },
      height: { type: 'number', min: 0.16, max: 1.1, default: 0.52 },
      count: { type: 'integer', min: 1, max: 6, default: 3 },
      primaryColor: { type: 'color', default: '#a16207' },
      secondaryColor: { type: 'color', default: '#c08457' },
    },
  },
]

export const AIRCRAFT_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'aircraft.aircraft_fuselage',
    family: 'aircraft',
    kind: 'aircraft_fuselage',
    semanticRole: 'aircraft_fuselage',
    aliases: [
      'aircraft',
      'airplane',
      'airliner',
      'plane',
      'jet',
      'fuselage',
      'fuselage_body',
      'streamlined_body',
      'airplane_body',
      'aircraft_body',
    ],
    required: true,
    description: 'Streamlined aircraft fuselage with conformal windows and livery stripes.',
    params: {
      length: { type: 'number', min: 0.4, max: 20 },
      width: { type: 'number', min: 0.05, max: 3 },
      height: { type: 'number', min: 0.04, max: 3 },
      count: { type: 'integer', min: 6, max: 40 },
      primaryColor: { type: 'color' },
      accentColor: { type: 'color' },
      noseRoundness: { type: 'number', min: 0, max: 1 },
      tailTaper: { type: 'number', min: 0, max: 1 },
      roofArc: { type: 'number', min: 0, max: 0.4 },
    },
  },
  {
    id: 'aircraft.aircraft_wing',
    family: 'aircraft',
    kind: 'aircraft_wing',
    semanticRole: 'aircraft_wing',
    aliases: [
      'wing',
      'wings',
      'main_wing',
      'main_wings',
      'left_wing',
      'right_wing',
      'swept_wing',
      'airfoil_blade',
      'lofted_panel',
    ],
    required: true,
    attachTo: 'aircraft_fuselage',
    layoutRole: 'main_low_wings',
    description: 'Symmetric swept aircraft wing pair.',
    params: {
      length: { type: 'number', min: 0.2, max: 16 },
      width: { type: 'number', min: 0.04, max: 1.2 },
      thickness: { type: 'number', min: 0.004, max: 0.08 },
      bladeSweep: { type: 'number', min: -0.5, max: 0.5 },
      verticalCurve: { type: 'number', min: -0.25, max: 0.25 },
      color: { type: 'color' },
    },
  },
  {
    id: 'aircraft.aircraft_engine',
    family: 'aircraft',
    kind: 'aircraft_engine',
    semanticRole: 'engine_nacelle',
    aliases: [
      'engine',
      'engines',
      'jet_engine',
      'jet_engines',
      'turbofan',
      'turbofans',
      'nacelle',
      'nacelles',
      'engine_nacelle',
      'engine_nacelles',
    ],
    required: true,
    attachTo: 'aircraft_wing',
    layoutRole: 'underwing_pair',
    description: 'Aircraft turbofan nacelles with intake lips and fan disks.',
    params: {
      count: { type: 'integer', min: 1, max: 4 },
      radius: { type: 'number', min: 0.018, max: 0.36 },
      length: { type: 'number', min: 0.05, max: 1.25 },
      width: { type: 'number', min: 0.06, max: 4 },
      color: { type: 'color' },
    },
  },
  {
    id: 'aircraft.aircraft_vertical_stabilizer',
    family: 'aircraft',
    kind: 'aircraft_vertical_stabilizer',
    semanticRole: 'vertical_stabilizer',
    aliases: [
      'vertical_stabilizer',
      'vertical_stabiliser',
      'vertical_tail',
      'vertical_fin',
      'tail_fin',
      'rudder',
    ],
    required: true,
    attachTo: 'aircraft_fuselage',
    layoutRole: 'tail_fin',
    description: 'Swept vertical tail fin.',
    params: {
      length: { type: 'number', min: 0.04, max: 1.5 },
      height: { type: 'number', min: 0.04, max: 1.4 },
      width: { type: 'number', min: 0.004, max: 0.16 },
      color: { type: 'color' },
    },
  },
  {
    id: 'aircraft.aircraft_horizontal_stabilizer',
    family: 'aircraft',
    kind: 'aircraft_horizontal_stabilizer',
    semanticRole: 'horizontal_stabilizer',
    aliases: [
      'horizontal_stabilizer',
      'horizontal_stabiliser',
      'horizontal_tail',
      'tailplane',
      't_tail',
      't_tail_stabilizer',
    ],
    required: true,
    attachTo: 'aircraft_vertical_stabilizer',
    layoutRole: 't_tail',
    description: 'Horizontal tail stabilizer pair.',
    params: {
      length: { type: 'number', min: 0.08, max: 2.5 },
      width: { type: 'number', min: 0.03, max: 0.8 },
      thickness: { type: 'number', min: 0.003, max: 0.08 },
      verticalCurve: { type: 'number', min: -0.25, max: 0.25 },
      color: { type: 'color' },
    },
  },
  {
    id: 'aircraft.aircraft_landing_gear',
    family: 'aircraft',
    kind: 'aircraft_landing_gear',
    semanticRole: 'landing_gear_wheel',
    aliases: [
      'landing_gear',
      'landing_wheel',
      'landing_wheels',
      'landing_gear_wheel',
      'nose_gear',
      'main_gear',
      'wheel_set',
      'wheels',
    ],
    required: true,
    attachTo: 'aircraft_fuselage',
    layoutRole: 'tricycle_gear',
    description: 'Tricycle landing gear wheels and struts.',
    params: {
      length: { type: 'number', min: 0.06, max: 2.5 },
      width: { type: 'number', min: 0.04, max: 1.4 },
      radius: { type: 'number', min: 0.012, max: 0.2 },
      wheelRadius: { type: 'number', min: 0.012, max: 0.2 },
      color: { type: 'color' },
    },
  },
]

export const GENERIC_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'generic.generic_body',
    family: 'generic',
    kind: 'generic_body',
    semanticRole: 'main_body',
    aliases: [
      'body',
      'main_body',
      'housing',
      'shell',
      'cabinet_body',
      'equipment_body',
      'building_body',
      'furniture_body',
    ],
    required: true,
    description: 'Generic primary body/housing for unknown long-tail objects.',
    params: {
      length: { type: 'number', min: 0.08, max: 8, default: 1 },
      width: { type: 'number', min: 0.05, max: 5, default: 0.65 },
      height: { type: 'number', min: 0.05, max: 5, default: 0.8 },
      primaryColor: { type: 'color', default: '#8b9aae' },
      cornerRadius: { type: 'number', min: 0, max: 0.5 },
    },
  },
  {
    id: 'generic.generic_base',
    family: 'generic',
    kind: 'generic_base',
    semanticRole: 'support_base',
    aliases: ['base', 'support_base', 'platform', 'cup_platform', 'plinth', 'skid'],
    required: true,
    description: 'Generic base, plinth, or platform.',
    params: {
      length: { type: 'number', min: 0.08, max: 8, default: 1.08 },
      width: { type: 'number', min: 0.05, max: 5, default: 0.72 },
      height: { type: 'number', min: 0.01, max: 0.8, default: 0.08 },
      thickness: { type: 'number', min: 0.01, max: 0.8 },
      darkColor: { type: 'color', default: '#1f2937' },
    },
  },
  {
    id: 'generic.generic_panel',
    family: 'generic',
    kind: 'generic_panel',
    semanticRole: 'panel',
    aliases: ['panel', 'front_panel', 'side_panel', 'access_panel', 'roof'],
    description: 'Generic flat panel or cover.',
    params: {
      length: { type: 'number', min: 0.02, max: 4, default: 0.3 },
      height: { type: 'number', min: 0.02, max: 3, default: 0.22 },
      thickness: { type: 'number', min: 0.002, max: 0.4, default: 0.025 },
      color: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'generic.generic_handle',
    family: 'generic',
    kind: 'generic_handle',
    semanticRole: 'handle',
    aliases: ['handle', 'pull_handle', 'door_handle'],
    description: 'Generic small handle or pull.',
    params: {
      length: { type: 'number', min: 0.03, max: 2, default: 0.22 },
      radius: { type: 'number', min: 0.004, max: 0.12, default: 0.018 },
      darkColor: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'generic.generic_spout',
    family: 'generic',
    kind: 'generic_spout',
    semanticRole: 'spout',
    aliases: ['spout', 'nozzle_spout', 'coffee_spout', 'dispense_spout'],
    description: 'Generic dispensing spout or short nozzle.',
    params: {
      length: { type: 'number', min: 0.02, max: 1.2, default: 0.2 },
      radius: { type: 'number', min: 0.004, max: 0.2, default: 0.035 },
      darkColor: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'generic.generic_control_panel',
    family: 'generic',
    kind: 'generic_control_panel',
    semanticRole: 'control_detail',
    aliases: ['control_panel', 'control_detail', 'buttons', 'button_panel'],
    description: 'Generic control/button panel.',
    params: {
      length: { type: 'number', min: 0.02, max: 4, default: 0.3 },
      height: { type: 'number', min: 0.02, max: 3, default: 0.22 },
      thickness: { type: 'number', min: 0.002, max: 0.4, default: 0.025 },
      accentColor: { type: 'color', default: '#38bdf8' },
    },
  },
  {
    id: 'generic.generic_display',
    family: 'generic',
    kind: 'generic_display',
    semanticRole: 'display',
    aliases: ['display', 'screen', 'readout'],
    description: 'Generic dark display or screen panel.',
    params: {
      length: { type: 'number', min: 0.02, max: 4, default: 0.28 },
      height: { type: 'number', min: 0.02, max: 3, default: 0.16 },
      thickness: { type: 'number', min: 0.002, max: 0.4, default: 0.025 },
      color: { type: 'color', default: '#0f172a' },
    },
  },
  {
    id: 'generic.generic_foot_set',
    family: 'generic',
    kind: 'generic_foot_set',
    semanticRole: 'support_foot',
    aliases: ['feet', 'foot_set', 'support_feet'],
    description: 'Generic four-foot support set.',
    params: {
      radius: { type: 'number', min: 0.006, max: 0.18, default: 0.035 },
      height: { type: 'number', min: 0.02, max: 0.8, default: 0.08 },
      darkColor: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'generic.generic_opening',
    family: 'generic',
    kind: 'generic_opening',
    semanticRole: 'opening',
    aliases: ['opening', 'door_opening', 'window_opening'],
    description: 'Generic dark door/window/opening panel.',
    params: {
      length: { type: 'number', min: 0.02, max: 4, default: 0.24 },
      height: { type: 'number', min: 0.02, max: 3, default: 0.28 },
      thickness: { type: 'number', min: 0.002, max: 0.4, default: 0.025 },
      color: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'generic.generic_detail_accent',
    family: 'generic',
    kind: 'generic_detail_accent',
    semanticRole: 'detail_accent',
    aliases: ['detail', 'detail_accent', 'accent', 'trim'],
    description: 'Generic small accent/detail marker.',
    params: {
      length: { type: 'number', min: 0.02, max: 4, default: 0.24 },
      height: { type: 'number', min: 0.02, max: 3, default: 0.14 },
      thickness: { type: 'number', min: 0.002, max: 0.4, default: 0.025 },
      accentColor: { type: 'color', default: '#38bdf8' },
    },
  },
]

export const KIOSK_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'kiosk.kiosk_body',
    family: 'kiosk',
    kind: 'kiosk_body',
    semanticRole: 'kiosk_body',
    aliases: ['body', 'kiosk_body', 'booth_body', 'stall_body', 'small_building_body', 'walls'],
    required: true,
    description: 'Main kiosk or booth wall volume.',
    params: {
      length: { type: 'number', min: 0.4, max: 8, default: 1.8 },
      width: { type: 'number', min: 0.3, max: 5, default: 1.2 },
      height: { type: 'number', min: 0.4, max: 5, default: 1.65 },
      primaryColor: { type: 'color', default: '#d1d5db' },
      cornerRadius: { type: 'number', min: 0, max: 0.3 },
    },
  },
  {
    id: 'kiosk.kiosk_roof',
    family: 'kiosk',
    kind: 'kiosk_roof',
    semanticRole: 'roof',
    aliases: ['roof', 'kiosk_roof', 'booth_roof', 'pavilion_roof', 'shed_roof'],
    required: true,
    attachTo: 'kiosk_body',
    layoutRole: 'top_overhang',
    description: 'Overhanging kiosk roof.',
    params: {
      length: { type: 'number', min: 0.4, max: 9, default: 2.1 },
      width: { type: 'number', min: 0.3, max: 6, default: 1.45 },
      height: { type: 'number', min: 0.04, max: 1.2, default: 0.28 },
      color: { type: 'color', default: '#7f1d1d' },
      variant: { type: 'enum', values: ['pitched', 'flat'], default: 'pitched' },
    },
  },
  {
    id: 'kiosk.kiosk_opening',
    family: 'kiosk',
    kind: 'kiosk_opening',
    semanticRole: 'opening',
    aliases: ['opening', 'window', 'service_window', 'ticket_window', 'serving_window', 'door'],
    required: true,
    attachTo: 'kiosk_body',
    layoutRole: 'front_service_opening',
    description: 'Front service window, ticket window, or door opening.',
    params: {
      length: { type: 'number', min: 0.08, max: 5, default: 0.8 },
      height: { type: 'number', min: 0.08, max: 4, default: 0.75 },
      thickness: { type: 'number', min: 0.004, max: 0.5, default: 0.035 },
      color: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'kiosk.kiosk_counter',
    family: 'kiosk',
    kind: 'kiosk_counter',
    semanticRole: 'service_counter',
    aliases: ['counter', 'service_counter', 'serving_counter', 'sales_counter', 'shelf'],
    attachTo: 'kiosk_opening',
    layoutRole: 'front_counter',
    description: 'Front service counter or shelf.',
    params: {
      length: { type: 'number', min: 0.08, max: 6, default: 1 },
      width: { type: 'number', min: 0.04, max: 2, default: 0.28 },
      thickness: { type: 'number', min: 0.02, max: 0.6, default: 0.08 },
      color: { type: 'color', default: '#9ca3af' },
    },
  },
  {
    id: 'kiosk.kiosk_sign',
    family: 'kiosk',
    kind: 'kiosk_sign',
    semanticRole: 'sign_panel',
    aliases: ['sign', 'signage', 'sign_panel', 'shop_sign', 'name_sign', 'ticket_sign'],
    attachTo: 'kiosk_body',
    layoutRole: 'front_upper_sign',
    description: 'Front sign panel.',
    params: {
      length: { type: 'number', min: 0.08, max: 6, default: 1 },
      height: { type: 'number', min: 0.04, max: 1.5, default: 0.26 },
      thickness: { type: 'number', min: 0.004, max: 0.4, default: 0.035 },
      accentColor: { type: 'color', default: '#facc15' },
    },
  },
  {
    id: 'kiosk.kiosk_awning',
    family: 'kiosk',
    kind: 'kiosk_awning',
    semanticRole: 'awning',
    aliases: ['awning', 'canopy', 'sunshade', 'front_awning'],
    attachTo: 'kiosk_body',
    layoutRole: 'front_canopy',
    description: 'Optional small canopy/awning over the opening.',
    params: {
      length: { type: 'number', min: 0.08, max: 7, default: 1.25 },
      width: { type: 'number', min: 0.04, max: 2.4, default: 0.45 },
      thickness: { type: 'number', min: 0.02, max: 0.8, default: 0.08 },
      color: { type: 'color', default: '#ef4444' },
    },
  },
]

export const PUMP_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'pump.skid_base',
    family: 'pump',
    kind: 'skid_base',
    semanticRole: 'support_base',
    aliases: ['base', 'skid', 'skid_base', 'pump_base', 'baseplate', 'foundation'],
    required: true,
    layoutRole: 'bottom_skid',
    description: 'Pump skid base or baseplate.',
    params: {
      length: { type: 'number', min: 0.3, max: 6, default: 1.2 },
      width: { type: 'number', min: 0.12, max: 3, default: 0.55 },
      height: { type: 'number', min: 0.02, max: 0.8, default: 0.08 },
      metalColor: { type: 'color', default: '#64748b' },
    },
  },
  {
    id: 'pump.ribbed_motor_body',
    family: 'pump',
    kind: 'ribbed_motor_body',
    semanticRole: 'drive_motor',
    aliases: ['motor', 'electric_motor', 'drive_motor', 'motor_body', 'ribbed_motor'],
    required: true,
    attachTo: 'skid_base',
    layoutRole: 'motor_on_skid',
    description: 'Ribbed electric motor driving the pump.',
    params: {
      length: { type: 'number', min: 0.12, max: 3, default: 0.48 },
      radius: { type: 'number', min: 0.04, max: 1, default: 0.18 },
      count: { type: 'integer', min: 3, max: 20, default: 8 },
      slatCount: { type: 'integer', min: 3, max: 20 },
      primaryColor: { type: 'color', default: '#64748b' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'pump.volute_casing',
    family: 'pump',
    kind: 'volute_casing',
    semanticRole: 'volute_casing',
    aliases: ['volute', 'pump_casing', 'volute_casing', 'casing', 'housing', 'pump_body'],
    required: true,
    attachTo: 'skid_base',
    layoutRole: 'front_pump_casing',
    description: 'Spiral volute casing for a centrifugal pump or blower.',
    params: {
      radius: { type: 'number', min: 0.05, max: 1.5, default: 0.22 },
      depth: { type: 'number', min: 0.04, max: 1.2, default: 0.14 },
      primaryColor: { type: 'color', default: '#64748b' },
    },
  },
  {
    id: 'pump.inlet_port',
    family: 'pump',
    kind: 'inlet_port',
    semanticRole: 'inlet_port',
    aliases: ['inlet', 'suction', 'suction_port', 'inlet_port', 'nozzle_inlet'],
    required: true,
    attachTo: 'volute_casing',
    layoutRole: 'volute_inlet',
    description: 'Pump suction inlet nozzle.',
    params: {
      radius: { type: 'number', min: 0.02, max: 0.7, default: 0.07 },
      length: { type: 'number', min: 0.04, max: 1.5, default: 0.22 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z' },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'pump.outlet_port',
    family: 'pump',
    kind: 'outlet_port',
    semanticRole: 'outlet_port',
    aliases: ['outlet', 'discharge', 'discharge_port', 'outlet_port', 'nozzle_outlet'],
    required: true,
    attachTo: 'volute_casing',
    layoutRole: 'volute_outlet',
    description: 'Pump discharge outlet nozzle.',
    params: {
      radius: { type: 'number', min: 0.02, max: 0.7, default: 0.06 },
      length: { type: 'number', min: 0.04, max: 1.5, default: 0.2 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'pump.flange_ring',
    family: 'pump',
    kind: 'flange_ring',
    semanticRole: 'flange',
    aliases: ['flange', 'flanges', 'flange_ring', 'pipe_flange'],
    attachTo: 'inlet_port',
    layoutRole: 'port_flange',
    description: 'Circular flange ring on a pump port.',
    params: {
      radius: { type: 'number', min: 0.03, max: 0.9, default: 0.12 },
      tubeRadius: { type: 'number', min: 0.004, max: 0.15, default: 0.018 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z' },
      boltCount: { type: 'integer', min: 4, max: 16, default: 8 },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'pump.impeller_blades',
    family: 'pump',
    kind: 'impeller_blades',
    semanticRole: 'impeller',
    aliases: ['impeller', 'impeller_blades', 'pump_impeller', 'rotor'],
    attachTo: 'volute_casing',
    layoutRole: 'inside_volute',
    description: 'Visible impeller blade set.',
    params: {
      count: { type: 'integer', min: 3, max: 14, default: 7 },
      radius: { type: 'number', min: 0.03, max: 1, default: 0.14 },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'pump.control_box',
    family: 'pump',
    kind: 'control_box',
    semanticRole: 'control_box',
    aliases: ['control_box', 'junction_box', 'terminal_box', 'controller'],
    attachTo: 'ribbed_motor_body',
    layoutRole: 'motor_top_box',
    description: 'Small control or terminal box on the motor.',
    params: {
      length: { type: 'number', min: 0.04, max: 1, default: 0.16 },
      width: { type: 'number', min: 0.03, max: 0.8, default: 0.12 },
      height: { type: 'number', min: 0.02, max: 0.6, default: 0.08 },
      primaryColor: { type: 'color', default: '#1f2937' },
    },
  },
]

export const CONVEYOR_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'conveyor.conveyor_frame',
    family: 'conveyor',
    kind: 'conveyor_frame',
    semanticRole: 'conveyor_frame',
    aliases: ['conveyor', 'belt_conveyor', 'frame', 'conveyor_frame', 'support_frame'],
    required: true,
    layoutRole: 'long_frame',
    description: 'Long conveyor support frame with rails and legs.',
    params: {
      length: { type: 'number', min: 0.4, max: 12, default: 3 },
      width: { type: 'number', min: 0.12, max: 3, default: 0.7 },
      height: { type: 'number', min: 0.12, max: 2.5, default: 0.65 },
      radius: { type: 'number', min: 0.006, max: 0.15, default: 0.025 },
      legCount: { type: 'integer', min: 2, max: 16 },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'conveyor.roller_array',
    family: 'conveyor',
    kind: 'roller_array',
    semanticRole: 'roller_array',
    aliases: ['rollers', 'roller_array', 'roller_bed', 'idlers'],
    required: true,
    attachTo: 'conveyor_frame',
    layoutRole: 'rollers_on_frame',
    description: 'Repeated rollers across the conveyor bed.',
    params: {
      count: { type: 'integer', min: 2, max: 32, default: 9 },
      length: { type: 'number', min: 0.3, max: 12, default: 2.8 },
      width: { type: 'number', min: 0.08, max: 3, default: 0.62 },
      radius: { type: 'number', min: 0.008, max: 0.2, default: 0.035 },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'conveyor.belt_surface',
    family: 'conveyor',
    kind: 'belt_surface',
    semanticRole: 'belt_surface',
    aliases: ['belt', 'belt_surface', 'conveyor_belt', 'rubber_belt'],
    required: true,
    attachTo: 'conveyor_frame',
    layoutRole: 'top_belt',
    description: 'Continuous dark belt surface.',
    params: {
      length: { type: 'number', min: 0.3, max: 12, default: 2.9 },
      width: { type: 'number', min: 0.08, max: 3, default: 0.62 },
      height: { type: 'number', min: 0.004, max: 0.16, default: 0.025 },
      darkColor: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'conveyor.ribbed_motor_body',
    family: 'conveyor',
    kind: 'ribbed_motor_body',
    semanticRole: 'drive_motor',
    aliases: ['drive_motor', 'motor', 'gear_motor', 'conveyor_motor'],
    attachTo: 'conveyor_frame',
    layoutRole: 'end_drive_motor',
    description: 'Side-mounted conveyor drive motor.',
    params: {
      length: { type: 'number', min: 0.08, max: 2, default: 0.28 },
      radius: { type: 'number', min: 0.03, max: 0.5, default: 0.08 },
      primaryColor: { type: 'color', default: '#64748b' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
]

export const ELECTRICAL_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'electrical.electrical_cabinet',
    family: 'electrical',
    kind: 'electrical_cabinet',
    semanticRole: 'electrical_cabinet',
    aliases: [
      'electrical_cabinet',
      'control_cabinet',
      'power_cabinet',
      'switchgear',
      'control_panel',
      'cabinet',
    ],
    required: true,
    layoutRole: 'upright_cabinet',
    description: 'Industrial electrical or control cabinet body.',
    params: {
      length: { type: 'number', min: 0.18, max: 4, default: 0.8 },
      width: { type: 'number', min: 0.08, max: 2, default: 0.32 },
      height: { type: 'number', min: 0.3, max: 4, default: 1.6 },
      doorCount: { type: 'integer', min: 1, max: 4 },
      slatCount: { type: 'integer', min: 2, max: 10 },
      primaryColor: { type: 'color', default: '#d1d5db' },
      darkColor: { type: 'color', default: '#111827' },
    },
  },
  {
    id: 'electrical.cable_tray',
    family: 'electrical',
    kind: 'cable_tray',
    semanticRole: 'cable_tray',
    aliases: ['cable_tray', 'wire_tray', 'cable_duct', 'cable_ladder'],
    attachTo: 'electrical_cabinet',
    layoutRole: 'top_cable_tray',
    description: 'Cable tray or cable duct connected to the cabinet.',
    params: {
      length: { type: 'number', min: 0.15, max: 8, default: 1.1 },
      width: { type: 'number', min: 0.04, max: 1, default: 0.16 },
      height: { type: 'number', min: 0.02, max: 0.5, default: 0.08 },
      slatCount: { type: 'integer', min: 2, max: 18 },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
]

export const PIPE_SYSTEM_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'pipe_system.pipe_run',
    family: 'pipe_system',
    kind: 'pipe_run',
    semanticRole: 'pipe_run',
    aliases: ['pipe', 'pipe_run', 'straight_pipe', 'pipeline', 'process_pipe', 'piping'],
    required: true,
    layoutRole: 'straight_run',
    description: 'Straight industrial pipe run.',
    params: {
      length: { type: 'number', min: 0.15, max: 20, default: 2 },
      radius: { type: 'number', min: 0.01, max: 1, default: 0.06 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'pipe_system.pipe_elbow',
    family: 'pipe_system',
    kind: 'pipe_elbow',
    semanticRole: 'pipe_elbow',
    aliases: ['elbow', 'pipe_elbow', 'bend', 'pipe_bend', 'elbow90'],
    attachTo: 'pipe_run',
    layoutRole: 'pipe_bend',
    description: 'Ninety-degree pipe elbow.',
    params: {
      radius: { type: 'number', min: 0.01, max: 1, default: 0.055 },
      bendRadius: { type: 'number', min: 0.03, max: 2, default: 0.22 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'pipe_system.flange_ring',
    family: 'pipe_system',
    kind: 'flange_ring',
    semanticRole: 'flange',
    aliases: ['flange', 'pipe_flange', 'flange_ring'],
    attachTo: 'pipe_run',
    layoutRole: 'pipe_end_flange',
    description: 'Pipe flange ring.',
    params: {
      radius: { type: 'number', min: 0.02, max: 1.2, default: 0.09 },
      tubeRadius: { type: 'number', min: 0.004, max: 0.18, default: 0.014 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      boltCount: { type: 'integer', min: 4, max: 16, default: 8 },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'pipe_system.valve_body',
    family: 'pipe_system',
    kind: 'valve_body',
    semanticRole: 'valve_body',
    aliases: ['valve', 'inline_valve', 'valve_body'],
    attachTo: 'pipe_run',
    layoutRole: 'inline_valve',
    description: 'Inline valve body for a pipe system.',
    params: {
      length: { type: 'number', min: 0.08, max: 2, default: 0.32 },
      radius: { type: 'number', min: 0.02, max: 1, default: 0.09 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      valveStyle: { type: 'string' },
      metalColor: { type: 'color', default: '#64748b' },
    },
  },
]

export const TANK_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'tank.cylindrical_tank',
    family: 'tank',
    kind: 'cylindrical_tank',
    aliases: ['tank', 'storage_tank', 'vessel', 'pressure_vessel', 'vertical_tank', '储罐', '罐体'],
    required: true,
    layoutRole: 'vessel_shell',
    description: 'Vertical or horizontal storage tank / pressure vessel shell.',
    params: {
      length: { type: 'number', min: 0.2, max: 10, default: 2.4 },
      radius: { type: 'number', min: 0.05, max: 3, default: 0.6 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'y' },
      primaryColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'tank.skid_base',
    family: 'tank',
    kind: 'skid_base',
    semanticRole: 'support_base',
    aliases: ['base', 'skid', 'saddle', 'support_base', 'tank_base', '支座'],
    attachTo: 'cylindrical_tank',
    layoutRole: 'tank_support',
    description: 'Tank support base or saddle.',
    params: {
      length: { type: 'number', min: 0.2, max: 10, default: 1.5 },
      width: { type: 'number', min: 0.08, max: 4, default: 0.8 },
      height: { type: 'number', min: 0.02, max: 1, default: 0.12 },
      metalColor: { type: 'color', default: '#64748b' },
    },
  },
  {
    id: 'tank.inlet_port',
    family: 'tank',
    kind: 'inlet_port',
    aliases: ['inlet', 'feed_nozzle', 'tank_inlet', 'top_nozzle', '入口', '进料口'],
    attachTo: 'cylindrical_tank',
    layoutRole: 'top_nozzle',
    description: 'Tank inlet / feed nozzle.',
    params: {
      radius: { type: 'number', min: 0.01, max: 1, default: 0.08 },
      length: { type: 'number', min: 0.03, max: 2, default: 0.22 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'y' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'tank.outlet_port',
    family: 'tank',
    kind: 'outlet_port',
    aliases: ['outlet', 'drain_nozzle', 'tank_outlet', 'bottom_nozzle', '出口', '排出口'],
    attachTo: 'cylindrical_tank',
    layoutRole: 'side_drain_nozzle',
    description: 'Tank outlet / drain nozzle.',
    params: {
      radius: { type: 'number', min: 0.01, max: 1, default: 0.07 },
      length: { type: 'number', min: 0.03, max: 2, default: 0.22 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'tank.platform_ladder',
    family: 'tank',
    kind: 'platform_ladder',
    semanticRole: 'access_platform',
    aliases: ['ladder', 'platform', 'access_platform', 'guard_platform', '爬梯', '平台'],
    attachTo: 'cylindrical_tank',
    layoutRole: 'side_access',
    description: 'Access platform and ladder for tank inspection.',
    params: {
      length: { type: 'number', min: 0.12, max: 4, default: 0.72 },
      width: { type: 'number', min: 0.12, max: 3, default: 0.48 },
      height: { type: 'number', min: 0.2, max: 6, default: 1.2 },
      radius: { type: 'number', min: 0.004, max: 0.08, default: 0.018 },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
]

export const REACTOR_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'reactor.agitator_tank',
    family: 'reactor',
    kind: 'agitator_tank',
    aliases: ['reactor', 'reaction_kettle', 'stirred_tank', 'agitator_tank', '反应釜', '搅拌罐'],
    required: true,
    layoutRole: 'stirred_vessel',
    description: 'Stirred reactor vessel with agitator motor, shaft, and impeller blades.',
    params: {
      height: { type: 'number', min: 0.2, max: 5, default: 1.4 },
      radius: { type: 'number', min: 0.06, max: 2, default: 0.42 },
      primaryColor: { type: 'color', default: '#94a3b8' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'reactor.inlet_port',
    family: 'reactor',
    kind: 'inlet_port',
    aliases: ['inlet', 'feed_nozzle', 'reactor_inlet', '进料口', '入口'],
    required: true,
    attachTo: 'agitator_tank',
    layoutRole: 'feed_nozzle',
    description: 'Reactor feed inlet nozzle.',
    params: {
      radius: { type: 'number', min: 0.01, max: 0.8, default: 0.06 },
      length: { type: 'number', min: 0.03, max: 1.5, default: 0.18 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'y' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'reactor.outlet_port',
    family: 'reactor',
    kind: 'outlet_port',
    aliases: ['outlet', 'discharge_nozzle', 'reactor_outlet', '出料口', '出口'],
    required: true,
    attachTo: 'agitator_tank',
    layoutRole: 'discharge_nozzle',
    description: 'Reactor discharge outlet nozzle.',
    params: {
      radius: { type: 'number', min: 0.01, max: 0.8, default: 0.055 },
      length: { type: 'number', min: 0.03, max: 1.5, default: 0.18 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'reactor.platform_ladder',
    family: 'reactor',
    kind: 'platform_ladder',
    semanticRole: 'access_platform',
    aliases: ['ladder', 'platform', 'access_platform', '爬梯', '平台'],
    attachTo: 'agitator_tank',
    layoutRole: 'side_access',
    description: 'Reactor access platform and ladder.',
    params: {
      length: { type: 'number', min: 0.12, max: 4, default: 0.72 },
      width: { type: 'number', min: 0.12, max: 3, default: 0.48 },
      height: { type: 'number', min: 0.2, max: 6, default: 1.2 },
      radius: { type: 'number', min: 0.004, max: 0.08, default: 0.018 },
      metalColor: { type: 'color', default: '#94a3b8' },
    },
  },
]

export const COMPRESSOR_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'compressor.skid_base',
    family: 'compressor',
    kind: 'skid_base',
    semanticRole: 'machine_base',
    aliases: ['base', 'skid', 'compressor_base', '底座'],
    required: true,
    layoutRole: 'machine_skid',
    description: 'Compressor skid base.',
    params: {
      length: { type: 'number', min: 0.3, max: 8, default: 1.8 },
      width: { type: 'number', min: 0.12, max: 4, default: 0.7 },
      height: { type: 'number', min: 0.02, max: 1, default: 0.12 },
      metalColor: { type: 'color', default: '#64748b' },
    },
  },
  {
    id: 'compressor.ribbed_motor_body',
    family: 'compressor',
    kind: 'ribbed_motor_body',
    semanticRole: 'motor_body',
    aliases: ['motor', 'drive_motor', 'electric_motor', '电机'],
    required: true,
    attachTo: 'skid_base',
    layoutRole: 'drive_motor',
    description: 'Ribbed electric drive motor.',
    params: {
      length: { type: 'number', min: 0.12, max: 3, default: 0.55 },
      radius: { type: 'number', min: 0.04, max: 1, default: 0.18 },
      slatCount: { type: 'integer', min: 3, max: 20, default: 8 },
      primaryColor: { type: 'color', default: '#64748b' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'compressor.rounded_machine_body',
    family: 'compressor',
    kind: 'rounded_machine_body',
    semanticRole: 'compressor_casing',
    aliases: ['compressor_casing', 'compressor_body', 'casing', '压缩机壳体'],
    required: true,
    attachTo: 'skid_base',
    layoutRole: 'compressor_casing',
    description: 'Rounded compressor casing.',
    params: {
      length: { type: 'number', min: 0.12, max: 4, default: 0.58 },
      width: { type: 'number', min: 0.08, max: 2, default: 0.36 },
      height: { type: 'number', min: 0.08, max: 2, default: 0.36 },
      primaryColor: { type: 'color', default: '#64748b' },
    },
  },
  {
    id: 'compressor.inlet_port',
    family: 'compressor',
    kind: 'inlet_port',
    aliases: ['inlet', 'suction', 'air_inlet', '入口', '进气口'],
    required: true,
    attachTo: 'rounded_machine_body',
    layoutRole: 'suction_port',
    description: 'Compressor inlet port.',
    params: {
      radius: { type: 'number', min: 0.01, max: 0.8, default: 0.07 },
      length: { type: 'number', min: 0.03, max: 1.5, default: 0.2 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'compressor.outlet_port',
    family: 'compressor',
    kind: 'outlet_port',
    aliases: ['outlet', 'discharge', 'air_outlet', '出口', '排气口'],
    required: true,
    attachTo: 'rounded_machine_body',
    layoutRole: 'discharge_port',
    description: 'Compressor discharge outlet port.',
    params: {
      radius: { type: 'number', min: 0.01, max: 0.8, default: 0.06 },
      length: { type: 'number', min: 0.03, max: 1.5, default: 0.2 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      metalColor: { type: 'color', default: '#cbd5e1' },
    },
  },
  {
    id: 'compressor.control_box',
    family: 'compressor',
    kind: 'control_box',
    semanticRole: 'control_box',
    aliases: ['control_box', 'controller', 'control_panel', '控制盒'],
    attachTo: 'skid_base',
    layoutRole: 'side_controller',
    description: 'Compressor control box.',
    params: {
      length: { type: 'number', min: 0.04, max: 1.2, default: 0.2 },
      width: { type: 'number', min: 0.03, max: 1, default: 0.14 },
      height: { type: 'number', min: 0.03, max: 1, default: 0.12 },
      primaryColor: { type: 'color', default: '#1f2937' },
    },
  },
]

export const HEAT_EXCHANGER_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'heat_exchanger.heat_exchanger',
    family: 'heat_exchanger',
    kind: 'heat_exchanger',
    aliases: ['heat_exchanger', 'condenser', 'cooler', 'shell_and_tube', '换热器', '冷凝器'],
    required: true,
    layoutRole: 'shell_and_tube_bundle',
    description: 'Shell-and-tube heat exchanger body with channel heads and nozzles.',
    params: {
      length: { type: 'number', min: 0.24, max: 8, default: 1.6 },
      radius: { type: 'number', min: 0.05, max: 1.5, default: 0.24 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
      primaryColor: { type: 'color', default: '#9ca3af' },
    },
  },
  {
    id: 'heat_exchanger.skid_base',
    family: 'heat_exchanger',
    kind: 'skid_base',
    semanticRole: 'support_base',
    aliases: ['support', 'saddle', 'base', 'skid', '支座'],
    attachTo: 'heat_exchanger',
    layoutRole: 'support_saddles',
    description: 'Heat exchanger support base.',
    params: {
      length: { type: 'number', min: 0.2, max: 8, default: 1.4 },
      width: { type: 'number', min: 0.08, max: 3, default: 0.48 },
      height: { type: 'number', min: 0.02, max: 1, default: 0.1 },
      metalColor: { type: 'color', default: '#64748b' },
    },
  },
]

export const MACHINE_TOOL_PART_DEFINITIONS: readonly PartDefinition[] = [
  {
    id: 'machine_tool.generic_base',
    family: 'machine_tool',
    kind: 'generic_base',
    semanticRole: 'machine_base',
    aliases: ['base', 'machine_base', 'bed', 'lathe_bed', '床身', '底座'],
    required: true,
    layoutRole: 'machine_bed',
    description: 'Machine tool base / bed.',
    params: {
      length: { type: 'number', min: 0.4, max: 10, default: 2.4 },
      width: { type: 'number', min: 0.18, max: 5, default: 1.0 },
      thickness: { type: 'number', min: 0.03, max: 1, default: 0.16 },
      darkColor: { type: 'color', default: '#1f2937' },
    },
  },
  {
    id: 'machine_tool.generic_body',
    family: 'machine_tool',
    kind: 'generic_body',
    semanticRole: 'machine_enclosure',
    aliases: ['enclosure', 'machine_body', 'cnc_enclosure', 'housing', '机床外壳'],
    required: true,
    attachTo: 'generic_base',
    layoutRole: 'machine_enclosure',
    description: 'Machine tool enclosure / main body.',
    params: {
      length: { type: 'number', min: 0.3, max: 8, default: 1.7 },
      width: { type: 'number', min: 0.16, max: 4, default: 0.8 },
      height: { type: 'number', min: 0.2, max: 4, default: 1.2 },
      primaryColor: { type: 'color', default: '#94a3b8' },
    },
  },
  {
    id: 'machine_tool.generic_panel',
    family: 'machine_tool',
    kind: 'generic_panel',
    semanticRole: 'spindle_head',
    aliases: ['spindle', 'spindle_head', 'tool_head', '主轴', '主轴头'],
    required: true,
    attachTo: 'generic_body',
    layoutRole: 'front_spindle_head',
    description: 'Spindle head or tool head panel.',
    params: {
      length: { type: 'number', min: 0.05, max: 3, default: 0.45 },
      height: { type: 'number', min: 0.05, max: 2, default: 0.36 },
      thickness: { type: 'number', min: 0.004, max: 0.4, default: 0.05 },
      color: { type: 'color', default: '#334155' },
    },
  },
  {
    id: 'machine_tool.viewing_panel',
    family: 'machine_tool',
    kind: 'generic_panel',
    semanticRole: 'viewing_panel',
    aliases: [
      'viewing_panel',
      'viewing_window',
      'observation_window',
      'front_window',
      'transparent_panel',
      'window',
      'glass',
      'inspection_window',
    ],
    attachTo: 'generic_body',
    layoutRole: 'front_viewing_window',
    description: 'Transparent front viewing window for an enclosed CNC machine.',
    params: {
      length: { type: 'number', min: 0.05, max: 4, default: 0.9 },
      height: { type: 'number', min: 0.05, max: 2.5, default: 0.65 },
      thickness: { type: 'number', min: 0.003, max: 0.16, default: 0.012 },
      color: { type: 'color', default: '#88CCEE' },
      opacity: { type: 'number', min: 0.1, max: 1, default: 0.48 },
    },
  },
  {
    id: 'machine_tool.work_table',
    family: 'machine_tool',
    kind: 'generic_panel',
    semanticRole: 'work_table',
    aliases: ['work_table', 'machine_table', 'fixture_table', 'bed_table', '工作台'],
    attachTo: 'generic_body',
    layoutRole: 'inside_work_table',
    description: 'Internal work table or fixture table below the spindle.',
    params: {
      length: { type: 'number', min: 0.08, max: 5, default: 1.0 },
      width: { type: 'number', min: 0.04, max: 3, default: 0.65 },
      thickness: { type: 'number', min: 0.01, max: 0.4, default: 0.06 },
      color: { type: 'color', default: '#555566' },
    },
  },
  {
    id: 'machine_tool.feed_chute',
    family: 'machine_tool',
    kind: 'generic_spout',
    semanticRole: 'feed_chute',
    aliases: ['feed_chute', 'feed_hopper', 'infeed', 'infeed_chute', 'material_inlet'],
    attachTo: 'generic_body',
    layoutRole: 'front_feed_chute',
    description: 'Feed chute, hopper, or material inlet for enclosed production machinery.',
    params: {
      length: { type: 'number', min: 0.04, max: 2, default: 0.34 },
      radius: { type: 'number', min: 0.008, max: 0.35, default: 0.08 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z' },
      darkColor: { type: 'color', default: '#374151' },
    },
  },
  {
    id: 'machine_tool.discharge_chute',
    family: 'machine_tool',
    kind: 'generic_spout',
    semanticRole: 'discharge_chute',
    aliases: ['discharge_chute', 'outfeed', 'outfeed_chute', 'material_outlet', 'product_exit'],
    attachTo: 'generic_body',
    layoutRole: 'rear_discharge_chute',
    description: 'Discharge chute or product outlet for enclosed production machinery.',
    params: {
      length: { type: 'number', min: 0.04, max: 2, default: 0.4 },
      radius: { type: 'number', min: 0.008, max: 0.35, default: 0.09 },
      axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'z' },
      darkColor: { type: 'color', default: '#374151' },
    },
  },
  {
    id: 'machine_tool.control_box',
    family: 'machine_tool',
    kind: 'control_box',
    semanticRole: 'control_panel',
    aliases: ['control_panel', 'control_box', 'operator_panel', '控制面板'],
    required: true,
    attachTo: 'generic_body',
    layoutRole: 'operator_panel',
    description: 'Operator control panel / pendant.',
    params: {
      length: { type: 'number', min: 0.04, max: 1.5, default: 0.28 },
      width: { type: 'number', min: 0.03, max: 1, default: 0.16 },
      height: { type: 'number', min: 0.03, max: 1.2, default: 0.36 },
      primaryColor: { type: 'color', default: '#1f2937' },
    },
  },
  {
    id: 'machine_tool.spindle_nose',
    family: 'machine_tool',
    kind: 'generic_spout',
    semanticRole: 'spindle_nose',
    aliases: ['spindle_nose', 'spindle_spout', 'tool_nose', 'tool_tip', 'cutter_nose'],
    attachTo: 'generic_panel',
    layoutRole: 'below_spindle_head',
    description: 'Short spindle nose or tool tip below the spindle head.',
    params: {
      length: { type: 'number', min: 0.03, max: 0.6, default: 0.14 },
      radius: { type: 'number', min: 0.008, max: 0.2, default: 0.04 },
      darkColor: { type: 'color', default: '#18181B' },
    },
  },
  {
    id: 'machine_tool.display_screen',
    family: 'machine_tool',
    kind: 'generic_display',
    semanticRole: 'display_screen',
    aliases: ['display', 'screen', 'display_screen', 'operator_screen', 'hmi_screen'],
    attachTo: 'control_box',
    layoutRole: 'control_panel_screen',
    description: 'Operator HMI screen on the control panel.',
    params: {
      length: { type: 'number', min: 0.03, max: 1, default: 0.26 },
      height: { type: 'number', min: 0.02, max: 0.8, default: 0.18 },
      thickness: { type: 'number', min: 0.002, max: 0.08, default: 0.008 },
      color: { type: 'color', default: '#1A1A2E' },
    },
  },
  {
    id: 'machine_tool.vent_panel',
    family: 'machine_tool',
    kind: 'vent_slats',
    semanticRole: 'vent_panel',
    aliases: ['vent', 'vents', 'vent_panel', 'vent_slats', 'louver', 'louvers', 'cooling_vent'],
    attachTo: 'generic_body',
    layoutRole: 'side_vent_panel',
    description: 'Side ventilation slats for heat dissipation.',
    params: {
      length: { type: 'number', min: 0.06, max: 3, default: 0.48 },
      height: { type: 'number', min: 0.04, max: 2, default: 0.48 },
      thickness: { type: 'number', min: 0.004, max: 0.12, default: 0.02 },
      slatCount: { type: 'integer', min: 2, max: 18, default: 6 },
      color: { type: 'color', default: '#475569' },
    },
  },
  {
    id: 'machine_tool.access_panel',
    family: 'machine_tool',
    kind: 'generic_detail_accent',
    semanticRole: 'access_panel',
    aliases: [
      'access_panel',
      'maintenance_panel',
      'inspection_panel',
      'service_panel',
      'door_panel',
    ],
    attachTo: 'generic_body',
    layoutRole: 'side_access_panel',
    required: true,
    description: 'Maintenance or inspection access panel on the machine enclosure.',
    params: {
      length: { type: 'number', min: 0.05, max: 3, default: 0.65 },
      height: { type: 'number', min: 0.04, max: 2, default: 0.45 },
      thickness: { type: 'number', min: 0.003, max: 0.12, default: 0.015 },
      accentColor: { type: 'color', default: '#666677' },
    },
  },
  {
    id: 'machine_tool.warning_label',
    family: 'machine_tool',
    kind: 'warning_label',
    semanticRole: 'warning_label',
    aliases: ['warning', 'warning_label', 'safety_label', 'hazard_label'],
    attachTo: 'generic_body',
    layoutRole: 'front_warning_label',
    description: 'Small safety warning label on the front enclosure.',
    params: {
      length: { type: 'number', min: 0.03, max: 0.8, default: 0.16 },
      height: { type: 'number', min: 0.02, max: 0.5, default: 0.08 },
      thickness: { type: 'number', min: 0.001, max: 0.04, default: 0.004 },
    },
  },
  {
    id: 'machine_tool.nameplate',
    family: 'machine_tool',
    kind: 'nameplate',
    semanticRole: 'nameplate',
    aliases: ['nameplate', 'brand_plate', 'manufacturer_plate', '铭牌'],
    attachTo: 'generic_body',
    layoutRole: 'front_nameplate',
    description: 'Manufacturer nameplate or model plate.',
    params: {
      length: { type: 'number', min: 0.03, max: 0.9, default: 0.2 },
      height: { type: 'number', min: 0.02, max: 0.45, default: 0.06 },
      thickness: { type: 'number', min: 0.001, max: 0.04, default: 0.004 },
    },
  },
]

const partDefinitionsByFamily = new Map<string, readonly PartDefinition[]>([
  ['vehicle', VEHICLE_PART_DEFINITIONS],
  ['desk', DESK_PART_DEFINITIONS],
  ['aircraft', AIRCRAFT_PART_DEFINITIONS],
  ['generic', GENERIC_PART_DEFINITIONS],
  ['kiosk', KIOSK_PART_DEFINITIONS],
  ['pump', PUMP_PART_DEFINITIONS],
  ['conveyor', CONVEYOR_PART_DEFINITIONS],
  ['electrical', ELECTRICAL_PART_DEFINITIONS],
  ['pipe_system', PIPE_SYSTEM_PART_DEFINITIONS],
  ['tank', TANK_PART_DEFINITIONS],
  ['reactor', REACTOR_PART_DEFINITIONS],
  ['compressor', COMPRESSOR_PART_DEFINITIONS],
  ['heat_exchanger', HEAT_EXCHANGER_PART_DEFINITIONS],
  ['machine_tool', MACHINE_TOOL_PART_DEFINITIONS],
])

const INDUSTRIAL_PART_FAMILIES = new Set([
  'pump',
  'conveyor',
  'electrical',
  'pipe_system',
  'tank',
  'reactor',
  'compressor',
  'heat_exchanger',
  'machine_tool',
])

const partAliasMapByFamily = new Map<string, Map<string, PartDefinition>>()

for (const [family, definitions] of partDefinitionsByFamily) {
  const aliasMap = new Map<string, PartDefinition>()
  const setAlias = (alias: string, definition: PartDefinition) => {
    const key = normalizeKey(alias)
    if (key && !aliasMap.has(key)) aliasMap.set(key, definition)
  }
  for (const definition of definitions) {
    setAlias(definition.kind, definition)
    aliasMap.set(normalizeKey(definition.id), definition)
    if (definition.semanticRole) setAlias(definition.semanticRole, definition)
    for (const alias of definition.aliases) setAlias(alias, definition)
  }
  partAliasMapByFamily.set(family, aliasMap)
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_-]+/g, '_')
        .toLowerCase()
    : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function partIdentityCandidates(part: Record<string, unknown>): string[] {
  return Array.from(
    new Set(
      [part.id, part.semanticRole, part.name, part.partName, part.kind, part.partType, part.type]
        .map(normalizeKey)
        .filter(Boolean),
    ),
  )
}

function definitionForPart(
  family: string,
  part: Record<string, unknown>,
): PartDefinition | undefined {
  const aliasMap = partAliasMapByFamily.get(family)
  if (!aliasMap) return undefined
  const identities = partIdentityCandidates(part)
  for (const identity of identities) {
    if (aliasMap.has(identity)) return aliasMap.get(identity)
  }
  for (const identity of identities) {
    for (const [alias, definition] of aliasMap) {
      if (identity.includes(alias) || alias.includes(identity)) return definition
    }
  }
  return undefined
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function vec3Value(value: unknown): [number, number, number] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    typeof value[2] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    !Number.isFinite(value[2])
  ) {
    return undefined
  }
  return [value[0], value[1], value[2]]
}

function clampParam(
  value: unknown,
  definition: PartParameterDefinition,
  label: string,
  warnings: string[],
) {
  if (definition.type === 'color' || definition.type === 'string' || definition.type === 'enum') {
    const raw = stringValue(value)
    if (!raw) return definition.default
    if (definition.values && !definition.values.includes(raw)) {
      warnings.push(`${label} ignored unsupported value "${raw}".`)
      return definition.default
    }
    return raw
  }
  if (definition.type === 'boolean') {
    return typeof value === 'boolean' ? value : definition.default
  }
  if (definition.values?.length) {
    const numeric = numberValue(value)
    if (numeric == null) return definition.default
    const closest = definition.values
      .filter((candidate): candidate is number => typeof candidate === 'number')
      .reduce((best, candidate) =>
        Math.abs(candidate - numeric) < Math.abs(best - numeric) ? candidate : best,
      )
    if (closest !== numeric) warnings.push(`${label} normalized from ${numeric} to ${closest}.`)
    return closest
  }
  const numeric = numberValue(value)
  if (numeric == null) return definition.default
  const min = definition.min ?? Number.NEGATIVE_INFINITY
  const max = definition.max ?? Number.POSITIVE_INFINITY
  const clamped = Math.max(min, Math.min(max, numeric))
  if (clamped !== numeric) warnings.push(`${label} clamped from ${numeric} to ${clamped}.`)
  return definition.type === 'integer' ? Math.round(clamped) : clamped
}

function normalizePartParams(
  definition: PartDefinition,
  raw: Record<string, unknown>,
  warnings: string[],
): Record<string, unknown> {
  const params = isRecord(raw.params) ? raw.params : {}
  const read = (key: string) => raw[key] ?? params[key]
  const normalized: Record<string, unknown> = {}
  for (const [key, paramDefinition] of Object.entries(definition.params)) {
    const value = clampParam(read(key), paramDefinition, `${definition.kind}.${key}`, warnings)
    if (value != null) normalized[key] = value
  }
  if (definition.kind === 'wheel_set') {
    normalized.radius = normalized.radius ?? normalized.wheelRadius
    normalized.width = normalized.width ?? normalized.wheelWidth
  }
  if (definition.kind === 'aircraft_landing_gear') {
    normalized.radius = normalized.radius ?? normalized.wheelRadius
  }
  return normalized
}

function mergeBodyDimensions(
  part: PartComposePartInput,
  input: Record<string, unknown>,
): PartComposePartInput {
  return {
    ...part,
    ...(numberValue(input.length) != null ? { length: numberValue(input.length) } : {}),
    ...(numberValue(input.width, input.depth) != null
      ? { width: numberValue(input.width, input.depth) }
      : {}),
    ...(numberValue(input.height) != null ? { height: numberValue(input.height) } : {}),
    ...(stringValue(input.primaryColor, input.color)
      ? { primaryColor: stringValue(input.primaryColor, input.color) }
      : {}),
  }
}

function mergeDeskTopDimensions(
  part: PartComposePartInput,
  input: Record<string, unknown>,
): PartComposePartInput {
  return {
    ...part,
    ...(numberValue(input.length) != null ? { length: numberValue(input.length) } : {}),
    ...(numberValue(input.width, input.depth) != null
      ? { width: numberValue(input.width, input.depth) }
      : {}),
    ...(stringValue(input.primaryColor, input.color)
      ? { primaryColor: stringValue(input.primaryColor, input.color) }
      : {}),
  }
}

function mergeAircraftFuselageDimensions(
  part: PartComposePartInput,
  input: Record<string, unknown>,
): PartComposePartInput {
  return {
    ...mergeBodyDimensions(part, input),
    ...(stringValue(input.accentColor) ? { accentColor: stringValue(input.accentColor) } : {}),
  }
}

function mergeKioskPartDimensions(
  definition: PartDefinition,
  part: PartComposePartInput,
  raw: Record<string, unknown>,
  input: Record<string, unknown>,
): PartComposePartInput {
  const params = isRecord(raw.params) ? raw.params : {}
  const hasRaw = (key: string) => raw[key] != null || params[key] != null
  const length = numberValue(input.length) ?? 1.8
  const width = numberValue(input.width, input.depth) ?? 1.2
  const height = numberValue(input.height) ?? 2.1
  if (definition.kind === 'kiosk_body') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length } : {}),
      ...(!hasRaw('width') ? { width } : {}),
      ...(!hasRaw('height') ? { height: height * 0.78 } : {}),
      ...(stringValue(input.primaryColor, input.color)
        ? { primaryColor: stringValue(input.primaryColor, input.color) }
        : {}),
    }
  }
  if (definition.kind === 'kiosk_roof') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length: length * 1.16 } : {}),
      ...(!hasRaw('width') ? { width: width * 1.18 } : {}),
      ...(!hasRaw('height') ? { height: height * 0.16 } : {}),
      ...(stringValue(input.secondaryColor) ? { color: stringValue(input.secondaryColor) } : {}),
    }
  }
  if (definition.kind === 'kiosk_opening') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length: length * 0.42 } : {}),
      ...(!hasRaw('height') ? { height: height * 0.34 } : {}),
    }
  }
  if (definition.kind === 'kiosk_counter') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length: length * 0.62 } : {}),
      ...(!hasRaw('width') ? { width: width * 0.2 } : {}),
      ...(!hasRaw('thickness') ? { thickness: height * 0.04 } : {}),
    }
  }
  if (definition.kind === 'kiosk_sign') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length: length * 0.64 } : {}),
      ...(!hasRaw('height') ? { height: height * 0.12 } : {}),
      ...(stringValue(input.accentColor) ? { accentColor: stringValue(input.accentColor) } : {}),
    }
  }
  if (definition.kind === 'kiosk_awning') {
    return {
      ...part,
      ...(!hasRaw('length') ? { length: length * 0.72 } : {}),
      ...(!hasRaw('width') ? { width: width * 0.32 } : {}),
      ...(!hasRaw('thickness') ? { thickness: height * 0.04 } : {}),
    }
  }
  return part
}

function mergeIndustrialPartDimensions(
  family: string,
  definition: PartDefinition,
  part: PartComposePartInput,
  raw: Record<string, unknown>,
  input: Record<string, unknown>,
): PartComposePartInput {
  const params = isRecord(raw.params) ? raw.params : {}
  const hasRaw = (key: string) => raw[key] != null || params[key] != null
  const rawNumber = (...keys: string[]) =>
    numberValue(...keys.map((key) => raw[key] ?? params[key]))
  const inputNumber = (...keys: string[]) => numberValue(...keys.map((key) => input[key]))
  const inputString = (...keys: string[]) => stringValue(...keys.map((key) => input[key]))
  const length =
    numberValue(input.length) ?? (family === 'conveyor' ? 3 : family === 'pipe_system' ? 2 : 1.2)
  const width = numberValue(input.width, input.depth, input.diameter) ?? 0.55
  const height = numberValue(input.height) ?? (family === 'electrical' ? 1.6 : 0.6)
  const color = stringValue(input.primaryColor, input.color)
  const metalColor = stringValue(input.metalColor, input.secondaryColor)

  if (family === 'pump') {
    const motorRadius =
      rawNumber('motorRadius') ??
      inputNumber('motorRadius', 'driveMotorRadius') ??
      Math.max(0.04, Math.min(width, height) * 0.28)
    const portRadius = Math.max(
      0.02,
      inputNumber('portRadius') ??
        (inputNumber('portDiameter') != null ? inputNumber('portDiameter')! / 2 : undefined) ??
        motorRadius * 0.42,
    )
    const inletRadius =
      inputNumber('inletRadius', 'suctionRadius') ??
      (inputNumber('inletDiameter', 'suctionDiameter') != null
        ? inputNumber('inletDiameter', 'suctionDiameter')! / 2
        : undefined)
    const outletRadius =
      inputNumber('outletRadius', 'dischargeRadius') ??
      (inputNumber('outletDiameter', 'dischargeDiameter') != null
        ? inputNumber('outletDiameter', 'dischargeDiameter')! / 2
        : undefined)
    const boltCount = rawNumber('boltCount') ?? inputNumber('boltCount', 'flangeBoltCount')
    if (definition.kind === 'skid_base') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('width') ? { width } : {}),
        ...(!hasRaw('height')
          ? { height: inputNumber('baseThickness', 'skidHeight') ?? Math.max(0.03, height * 0.12) }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'ribbed_motor_body') {
      return {
        ...part,
        ...(!hasRaw('length')
          ? { length: rawNumber('motorLength') ?? inputNumber('motorLength') ?? length * 0.38 }
          : {}),
        ...(!hasRaw('radius') ? { radius: motorRadius } : {}),
        ...(!hasRaw('slatCount') && !hasRaw('count')
          ? { slatCount: rawNumber('ribCount', 'finCount') ?? inputNumber('ribCount', 'finCount') }
          : {}),
        ...(color ? { primaryColor: color } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'volute_casing') {
      return {
        ...part,
        ...(!hasRaw('radius')
          ? {
              radius:
                inputNumber('casingRadius', 'voluteRadius') ??
                Math.max(0.05, Math.min(width, height) * 0.36),
            }
          : {}),
        ...(!hasRaw('depth')
          ? { depth: inputNumber('casingDepth', 'voluteDepth') ?? width * 0.28 }
          : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'inlet_port' || definition.kind === 'outlet_port') {
      const explicitPortRadius = definition.kind === 'inlet_port' ? inletRadius : outletRadius
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: explicitPortRadius ?? portRadius } : {}),
        ...(!hasRaw('length')
          ? {
              length:
                inputNumber(
                  definition.kind === 'inlet_port' ? 'inletLength' : 'outletLength',
                  definition.kind === 'inlet_port' ? 'suctionLength' : 'dischargeLength',
                ) ?? Math.max(0.06, width * 0.32),
            }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'flange_ring') {
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: portRadius * 1.65 } : {}),
        ...(!hasRaw('tubeRadius') ? { tubeRadius: portRadius * 0.22 } : {}),
        ...(!hasRaw('boltCount') && boltCount != null ? { boltCount } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'impeller_blades') {
      return {
        ...part,
        ...(!hasRaw('radius')
          ? {
              radius:
                inputNumber('impellerRadius') ?? Math.max(0.04, Math.min(width, height) * 0.23),
            }
          : {}),
        ...(!hasRaw('count') && inputNumber('impellerBladeCount') != null
          ? { count: inputNumber('impellerBladeCount') }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'conveyor') {
    const beltWidth = inputNumber('beltWidth')
    const rollerCount = inputNumber('rollerCount', 'idlerCount')
    const rollerRadius = inputNumber('rollerRadius', 'idlerRadius')
    if (definition.kind === 'conveyor_frame') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('width') ? { width } : {}),
        ...(!hasRaw('height') ? { height: inputNumber('frameHeight') ?? height } : {}),
        ...(!hasRaw('legCount') && inputNumber('legCount', 'supportCount') != null
          ? { legCount: inputNumber('legCount', 'supportCount') }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'roller_array') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: length * 0.94 } : {}),
        ...(!hasRaw('width') ? { width: beltWidth ?? width * 0.9 } : {}),
        ...(!hasRaw('radius')
          ? { radius: rollerRadius ?? Math.max(0.012, Math.min(width, height) * 0.045) }
          : {}),
        ...(!hasRaw('count')
          ? { count: rollerCount ?? Math.max(4, Math.min(32, Math.round(length * 4))) }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'belt_surface') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: length * 0.98 } : {}),
        ...(!hasRaw('width') ? { width: beltWidth ?? width * 0.9 } : {}),
        ...(!hasRaw('height')
          ? { height: inputNumber('beltThickness') ?? Math.max(0.008, height * 0.035) }
          : {}),
        ...(stringValue(input.darkColor) ? { darkColor: stringValue(input.darkColor) } : {}),
      }
    }
    if (definition.kind === 'ribbed_motor_body') {
      return {
        ...part,
        ...(!hasRaw('length')
          ? {
              length:
                inputNumber('motorLength', 'driveMotorLength') ?? Math.max(0.12, width * 0.34),
            }
          : {}),
        ...(!hasRaw('radius')
          ? {
              radius:
                inputNumber('motorRadius', 'driveMotorRadius') ?? Math.max(0.035, width * 0.09),
            }
          : {}),
        ...(color ? { primaryColor: color } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'electrical') {
    const doorCount = inputNumber('doorCount')
    const ventCount = inputNumber('ventCount', 'ventRows', 'slatCount')
    if (definition.kind === 'electrical_cabinet') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('width') ? { width } : {}),
        ...(!hasRaw('height') ? { height } : {}),
        ...(!hasRaw('doorCount') && doorCount != null ? { doorCount } : {}),
        ...(!hasRaw('slatCount') && !hasRaw('count') && ventCount != null
          ? { slatCount: ventCount }
          : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'cable_tray') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: inputNumber('cableTrayLength') ?? length * 1.25 } : {}),
        ...(!hasRaw('width') ? { width: inputNumber('cableTrayWidth') ?? width * 0.5 } : {}),
        ...(!hasRaw('height')
          ? { height: inputNumber('cableTrayHeight') ?? Math.max(0.03, height * 0.045) }
          : {}),
        ...(!hasRaw('slatCount') && inputNumber('cableTrayRungCount') != null
          ? { slatCount: inputNumber('cableTrayRungCount') }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'pipe_system') {
    const explicitRadius = numberValue(input.radius, input.pipeRadius)
    const explicitDiameter = numberValue(input.diameter, input.pipeDiameter)
    const pipeRadius =
      explicitRadius ??
      (explicitDiameter != null
        ? explicitDiameter / 2
        : Math.max(0.02, Math.min(width, height) * 0.5))
    if (definition.kind === 'pipe_run') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('radius') ? { radius: pipeRadius } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'pipe_elbow' || definition.kind === 'valve_body') {
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: pipeRadius } : {}),
        ...(definition.kind === 'pipe_elbow' && !hasRaw('bendRadius') && !hasRaw('length')
          ? { bendRadius: inputNumber('bendRadius', 'elbowRadius') ?? pipeRadius * 4.2 }
          : {}),
        ...(definition.kind === 'valve_body' && !hasRaw('length')
          ? { length: inputNumber('valveLength') ?? Math.max(0.08, pipeRadius * 5) }
          : {}),
        ...(definition.kind === 'valve_body' && !hasRaw('valveStyle') && inputString('valveStyle')
          ? { valveStyle: inputString('valveStyle') }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    const flangeBoltCount = inputNumber('boltCount', 'flangeBoltCount')
    if (definition.kind === 'flange_ring') {
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: pipeRadius * 1.55 } : {}),
        ...(!hasRaw('tubeRadius') ? { tubeRadius: Math.max(0.004, pipeRadius * 0.22) } : {}),
        ...(!hasRaw('boltCount') && flangeBoltCount != null ? { boltCount: flangeBoltCount } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'tank') {
    const tankHeight = inputNumber('tankHeight') ?? height
    const tankRadius =
      inputNumber('tankRadius', 'radius') ??
      (inputNumber('diameter', 'tankDiameter') != null
        ? inputNumber('diameter', 'tankDiameter')! / 2
        : Math.max(0.08, width * 0.5))
    const portRadius =
      inputNumber('portRadius') ??
      (inputNumber('portDiameter') != null ? inputNumber('portDiameter')! / 2 : undefined) ??
      tankRadius * 0.16
    if (definition.kind === 'cylindrical_tank') {
      const horizontal = /horizontal|卧式|卧罐/i.test(textOf(input))
      const shellLength = horizontal ? length : tankHeight
      return {
        ...part,
        ...(!hasRaw('length') ? { length: shellLength } : {}),
        ...(!hasRaw('radius') ? { radius: tankRadius } : {}),
        ...(!hasRaw('axis') ? { axis: horizontal ? 'x' : 'y' } : {}),
        ...(!hasRaw('position')
          ? { position: [0, horizontal ? tankRadius + 0.1 : shellLength / 2, 0] }
          : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'skid_base') {
      const baseHeight =
        inputNumber('baseHeight', 'supportHeight') ?? Math.max(0.06, tankHeight * 0.06)
      return {
        ...part,
        ...(!hasRaw('length') ? { length: Math.max(length, tankRadius * 2.2) } : {}),
        ...(!hasRaw('width') ? { width: tankRadius * 2.2 } : {}),
        ...(!hasRaw('height') ? { height: baseHeight } : {}),
        ...(!hasRaw('position') ? { position: [0, baseHeight / 2, 0] } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'inlet_port' || definition.kind === 'outlet_port') {
      const isInlet = definition.kind === 'inlet_port'
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: portRadius } : {}),
        ...(!hasRaw('length') ? { length: Math.max(0.06, tankRadius * 0.36) } : {}),
        ...(!hasRaw('axis') ? { axis: isInlet ? 'y' : 'x' } : {}),
        ...(!hasRaw('position')
          ? {
              position: isInlet
                ? [0, tankHeight + tankRadius * 0.18, 0]
                : [tankRadius * 1.08, tankHeight * 0.22, 0],
            }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'platform_ladder') {
      return {
        ...part,
        ...(!hasRaw('height') ? { height: tankHeight * 0.82 } : {}),
        ...(!hasRaw('position') ? { position: [tankRadius * 1.28, tankHeight * 0.48, 0] } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'reactor') {
    const reactorHeight = inputNumber('vesselHeight', 'tankHeight') ?? height
    const reactorRadius =
      inputNumber('vesselRadius', 'tankRadius', 'radius') ??
      (inputNumber('diameter', 'vesselDiameter') != null
        ? inputNumber('diameter', 'vesselDiameter')! / 2
        : Math.max(0.08, width * 0.5))
    const nozzleRadius =
      inputNumber('nozzleRadius') ??
      (inputNumber('nozzleDiameter') != null ? inputNumber('nozzleDiameter')! / 2 : undefined) ??
      reactorRadius * 0.15
    if (definition.kind === 'agitator_tank') {
      return {
        ...part,
        ...(!hasRaw('height') ? { height: reactorHeight } : {}),
        ...(!hasRaw('radius') ? { radius: reactorRadius } : {}),
        ...(!hasRaw('position') ? { position: [0, reactorHeight / 2, 0] } : {}),
        ...(color ? { primaryColor: color } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'inlet_port' || definition.kind === 'outlet_port') {
      const isInlet = definition.kind === 'inlet_port'
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: nozzleRadius } : {}),
        ...(!hasRaw('length') ? { length: Math.max(0.05, reactorRadius * 0.34) } : {}),
        ...(!hasRaw('axis') ? { axis: isInlet ? 'y' : 'x' } : {}),
        ...(!hasRaw('position')
          ? {
              position: isInlet
                ? [-reactorRadius * 0.34, reactorHeight + reactorRadius * 0.16, 0]
                : [reactorRadius * 1.08, reactorHeight * 0.22, 0],
            }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'platform_ladder') {
      return {
        ...part,
        ...(!hasRaw('height') ? { height: reactorHeight * 0.86 } : {}),
        ...(!hasRaw('position')
          ? { position: [reactorRadius * 1.32, reactorHeight * 0.48, 0] }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'compressor') {
    const motorRadius = inputNumber('motorRadius') ?? Math.max(0.05, Math.min(width, height) * 0.22)
    const casingRadius =
      inputNumber('casingRadius') ?? Math.max(0.08, Math.min(width, height) * 0.25)
    const portRadius =
      inputNumber('portRadius') ??
      (inputNumber('portDiameter') != null ? inputNumber('portDiameter')! / 2 : undefined) ??
      casingRadius * 0.28
    if (definition.kind === 'skid_base') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('width') ? { width } : {}),
        ...(!hasRaw('height') ? { height: Math.max(0.06, height * 0.14) } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'ribbed_motor_body') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: inputNumber('motorLength') ?? length * 0.34 } : {}),
        ...(!hasRaw('radius') ? { radius: motorRadius } : {}),
        ...(!hasRaw('position') ? { position: [-length * 0.22, height * 0.55, 0] } : {}),
        ...(color ? { primaryColor: color } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'rounded_machine_body') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: inputNumber('casingLength') ?? length * 0.34 } : {}),
        ...(!hasRaw('width') ? { width: casingRadius * 1.8 } : {}),
        ...(!hasRaw('height') ? { height: casingRadius * 1.8 } : {}),
        ...(!hasRaw('position') ? { position: [length * 0.24, height * 0.55, 0] } : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'inlet_port' || definition.kind === 'outlet_port') {
      const isInlet = definition.kind === 'inlet_port'
      return {
        ...part,
        ...(!hasRaw('radius') ? { radius: portRadius } : {}),
        ...(!hasRaw('length') ? { length: Math.max(0.06, width * 0.28) } : {}),
        ...(!hasRaw('axis') ? { axis: 'x' } : {}),
        ...(!hasRaw('position')
          ? { position: [length * (isInlet ? 0.02 : 0.46), height * 0.58, 0] }
          : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
    if (definition.kind === 'control_box') {
      return {
        ...part,
        ...(!hasRaw('position') ? { position: [-length * 0.42, height * 0.36, width * 0.38] } : {}),
      }
    }
  }

  if (family === 'heat_exchanger') {
    const shellRadius =
      inputNumber('shellRadius', 'radius') ??
      (inputNumber('diameter', 'shellDiameter') != null
        ? inputNumber('diameter', 'shellDiameter')! / 2
        : Math.max(0.06, Math.min(width, height) * 0.44))
    if (definition.kind === 'heat_exchanger') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('radius') ? { radius: shellRadius } : {}),
        ...(!hasRaw('axis') ? { axis: 'x' } : {}),
        ...(!hasRaw('position') ? { position: [0, shellRadius + 0.12, 0] } : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'skid_base') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: length * 0.86 } : {}),
        ...(!hasRaw('width') ? { width: shellRadius * 2.2 } : {}),
        ...(!hasRaw('height') ? { height: Math.max(0.06, shellRadius * 0.38) } : {}),
        ...(metalColor ? { metalColor } : {}),
      }
    }
  }

  if (family === 'machine_tool') {
    if (definition.kind === 'generic_base') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length } : {}),
        ...(!hasRaw('width') ? { width } : {}),
        ...(!hasRaw('thickness') ? { thickness: Math.max(0.08, height * 0.1) } : {}),
      }
    }
    if (definition.kind === 'generic_body') {
      return {
        ...part,
        ...(inputNumber('length') != null ? { length } : !hasRaw('length') ? { length } : {}),
        ...(inputNumber('width', 'depth') != null ? { width } : !hasRaw('width') ? { width } : {}),
        ...(inputNumber('height') != null ? { height } : !hasRaw('height') ? { height } : {}),
        ...(!hasRaw('position') ? { position: [0, height * 0.56, 0] } : {}),
        ...(color ? { primaryColor: color } : {}),
      }
    }
    if (definition.kind === 'generic_panel') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: length * 0.18 } : {}),
        ...(!hasRaw('height') ? { height: height * 0.24 } : {}),
        ...(!hasRaw('position') ? { position: [-length * 0.12, height * 0.58, width * 0.43] } : {}),
      }
    }
    if (definition.kind === 'control_box') {
      return {
        ...part,
        ...(!hasRaw('length') ? { length: length * 0.12 } : {}),
        ...(!hasRaw('height') ? { height: height * 0.34 } : {}),
        ...(!hasRaw('position') ? { position: [length * 0.38, height * 0.58, width * 0.5] } : {}),
      }
    }
  }

  return part
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function shouldIncludeDeskDrawers(input: Record<string, unknown>): boolean {
  const text = textOf([
    input.name,
    input.partName,
    input.object,
    input.prompt,
    input.style,
  ]).toLowerCase()
  return /drawer|drawers|cabinet|storage|office|writing/.test(text)
}

type GenericPartPlanCategory = 'equipment' | 'building' | 'furniture' | 'natural' | 'generic'

function genericPartPlanCategory(input: Record<string, unknown>): GenericPartPlanCategory {
  const text = textOf([
    input.name,
    input.partName,
    input.object,
    input.prompt,
    input.style,
    input.category,
    input.geometryBrief,
  ]).toLowerCase()
  if (/coffee|espresso|\u5496\u5561\u673a|machine|equipment|device|appliance|console/.test(text)) {
    return 'equipment'
  }
  if (
    /building|house|tower|pavilion|booth|kiosk|shed|\u5efa\u7b51|\u623f|\u4ead|\u68da/.test(text)
  ) {
    return 'building'
  }
  if (
    /furniture|chair|cabinet|shelf|sofa|bed|\u5bb6\u5177|\u6905|\u67dc|\u67b6|\u6c99\u53d1|\u5e8a/.test(
      text,
    )
  ) {
    return 'furniture'
  }
  if (
    /landscape|garden|terrain|hill|mountain|pond|\u666f\u89c2|\u82b1\u56ed|\u5c71|\u6c60/.test(text)
  ) {
    return 'natural'
  }
  return 'generic'
}

function isCoffeeLikeGeneric(input: Record<string, unknown>): boolean {
  return /coffee|espresso|\u5496\u5561\u673a/i.test(textOf(input))
}

function normalizePartForDefinition(
  family: string,
  definition: PartDefinition,
  raw: Record<string, unknown>,
  input: Record<string, unknown>,
  warnings: string[],
): PartComposePartInput {
  const params = normalizePartParams(definition, raw, warnings)
  const preserveLayoutFields = INDUSTRIAL_PART_FAMILIES.has(family)
  const position = preserveLayoutFields ? vec3Value(raw.position) : undefined
  const rotation = preserveLayoutFields ? vec3Value(raw.rotation) : undefined
  const id = preserveLayoutFields ? stringValue(raw.id) : undefined
  const name = preserveLayoutFields ? stringValue(raw.name, raw.partName) : undefined
  const side = preserveLayoutFields ? stringValue(raw.side) : undefined
  const connectTo = preserveLayoutFields ? stringValue(raw.connectTo) : undefined
  const connectPoint = preserveLayoutFields ? stringValue(raw.connectPoint) : undefined
  const childPoint = preserveLayoutFields ? stringValue(raw.childPoint) : undefined
  const centeredOn = preserveLayoutFields ? stringValue(raw.centeredOn) : undefined
  const alignAbove = preserveLayoutFields ? stringValue(raw.alignAbove) : undefined
  const alignBeside = preserveLayoutFields ? stringValue(raw.alignBeside) : undefined
  const semanticRole = definition.semanticRole
  let part: PartComposePartInput = {
    kind: definition.kind,
    ...(semanticRole ? { semanticRole } : {}),
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(position ? { position } : {}),
    ...(rotation ? { rotation } : {}),
    ...(side ? { side } : {}),
    ...(connectTo ? { connectTo } : {}),
    ...(connectPoint ? { connectPoint } : {}),
    ...(childPoint ? { childPoint } : {}),
    ...(centeredOn ? { centeredOn } : {}),
    ...(alignAbove ? { alignAbove } : {}),
    ...(alignBeside ? { alignBeside } : {}),
    ...params,
  }

  if (family === 'vehicle' && definition.kind === 'body_shell') {
    part = mergeBodyDimensions(part, input)
  }
  if (family === 'desk' && definition.kind === 'desk_top') {
    part = mergeDeskTopDimensions(part, input)
  }
  if (family === 'desk' && definition.kind === 'leg_set') {
    const topLength = numberValue(input.length)
    const topWidth = numberValue(input.width, input.depth)
    const overallHeight = numberValue(input.height)
    part = {
      ...part,
      ...(topLength != null ? { length: Math.max(0.25, topLength * 0.9) } : {}),
      ...(topWidth != null ? { width: Math.max(0.15, topWidth * 0.82) } : {}),
      ...(overallHeight != null ? { height: Math.max(0.12, overallHeight - 0.055) } : {}),
    }
  }
  if (family === 'aircraft' && definition.kind === 'aircraft_fuselage') {
    part = mergeAircraftFuselageDimensions(part, input)
  }
  if (family === 'generic' && definition.kind === 'generic_body') {
    part = mergeBodyDimensions(part, input)
  }
  if (family === 'generic' && definition.kind === 'generic_base') {
    const topLength = numberValue(input.length)
    const topWidth = numberValue(input.width, input.depth)
    const overallHeight = numberValue(input.height)
    part = {
      ...part,
      ...(topLength != null ? { length: Math.max(0.08, topLength * 1.08) } : {}),
      ...(topWidth != null ? { width: Math.max(0.05, topWidth * 1.08) } : {}),
      ...(overallHeight != null ? { thickness: Math.max(0.01, overallHeight * 0.08) } : {}),
    }
  }
  if (family === 'kiosk') {
    part = mergeKioskPartDimensions(definition, part, raw, input)
  }
  if (INDUSTRIAL_PART_FAMILIES.has(family)) {
    part = mergeIndustrialPartDimensions(family, definition, part, raw, input)
  }
  return part
}

function normalizeFamilyPartPlan(
  family: string,
  definitions: readonly PartDefinition[],
  input: Record<string, unknown>,
): NormalizedPartPlan {
  const warnings: string[] = []
  const rawParts = Array.isArray(input.parts) ? input.parts.filter(isRecord) : []
  const normalizedParts: PartComposePartInput[] = []
  const seen = new Set<string>()

  for (const raw of rawParts) {
    const definition = definitionForPart(family, raw)
    if (!definition) {
      warnings.push(
        `Unknown ${family} part "${String(raw.kind ?? raw.name ?? raw.semanticRole ?? 'part')}" ignored.`,
      )
      continue
    }
    if (seen.has(definition.id)) continue
    seen.add(definition.id)
    normalizedParts.push(normalizePartForDefinition(family, definition, raw, input, warnings))
  }

  for (const definition of definitions) {
    if (!definition.required || seen.has(definition.id)) continue
    normalizedParts.push(normalizePartForDefinition(family, definition, {}, input, warnings))
    seen.add(definition.id)
  }

  if (family === 'vehicle' && !seen.has('seam_ring')) normalizedParts.push({ kind: 'seam_ring' })
  if (family === 'desk' && !seen.has('drawer_stack') && shouldIncludeDeskDrawers(input)) {
    const drawerDefinition = definitions.find((definition) => definition.kind === 'drawer_stack')
    if (drawerDefinition) {
      normalizedParts.push(
        normalizePartForDefinition(family, drawerDefinition, {}, input, warnings),
      )
    }
  }
  if (family === 'kiosk') {
    if (!seen.has('kiosk_sign')) {
      const signDefinition = definitions.find((definition) => definition.kind === 'kiosk_sign')
      if (signDefinition) {
        normalizedParts.push(
          normalizePartForDefinition(family, signDefinition, {}, input, warnings),
        )
      }
    }
    if (!seen.has('kiosk_awning')) {
      const awningDefinition = definitions.find((definition) => definition.kind === 'kiosk_awning')
      if (awningDefinition) {
        normalizedParts.push(
          normalizePartForDefinition(family, awningDefinition, {}, input, warnings),
        )
      }
    }
  }

  const definitionOrder = new Map(definitions.map((definition, index) => [definition.id, index]))
  const orderForPart = (part: PartComposePartInput) => {
    const semanticRole = normalizeKey(part.semanticRole)
    const kind = normalizeKey(part.kind)
    const definition = definitions.find(
      (candidate) =>
        normalizeKey(candidate.kind) === kind &&
        (!semanticRole || normalizeKey(candidate.semanticRole) === semanticRole),
    )
    return definitionOrder.get(definition?.id ?? '') ?? Number.MAX_SAFE_INTEGER
  }
  normalizedParts.sort((left, right) => orderForPart(left) - orderForPart(right))

  return { family, parts: normalizedParts, warnings }
}

export function getPartDefinitions(family: string): readonly PartDefinition[] {
  return partDefinitionsByFamily.get(family) ?? []
}

export function partCapabilitySummary(family?: string): string {
  const definitions = family
    ? getPartDefinitions(family)
    : Array.from(partDefinitionsByFamily.values()).flat()
  return definitions
    .map((definition) => {
      const params = Object.entries(definition.params)
        .map(([key, param]) => {
          if (param.values?.length) return `${key}=${param.values.join('|')}`
          const range =
            param.min != null || param.max != null ? `[${param.min ?? ''},${param.max ?? ''}]` : ''
          return `${key}:${param.type}${range}`
        })
        .join(', ')
      return `${definition.id}: ${params}`
    })
    .join('\n')
}

export function normalizeVehiclePartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('vehicle', VEHICLE_PART_DEFINITIONS, input)
}

export function normalizeDeskPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('desk', DESK_PART_DEFINITIONS, input)
}

export function normalizeAircraftPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('aircraft', AIRCRAFT_PART_DEFINITIONS, input)
}

export function normalizeGenericPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  const category = genericPartPlanCategory(input)
  const plan = normalizeFamilyPartPlan('generic', GENERIC_PART_DEFINITIONS, input)
  const length = numberValue(input.length) ?? 1
  const width = numberValue(input.width, input.depth) ?? 0.65
  const height = numberValue(input.height) ?? 0.8
  const hasKind = (kind: string, role?: string) =>
    plan.parts.some(
      (part) => part.kind === kind && (role == null || normalizeKey(part.semanticRole) === role),
    )
  const add = (part: PartComposePartInput) => {
    if (!hasKind(String(part.kind), normalizeKey(part.semanticRole))) plan.parts.push(part)
  }

  for (const part of plan.parts) {
    if (part.kind === 'generic_body') {
      if (category === 'building') part.semanticRole = 'building_body'
      else if (category === 'furniture') part.semanticRole = 'furniture_body'
      else if (category === 'natural') part.semanticRole = 'natural_mass'
      else part.semanticRole = 'main_body'
    }
    if (part.kind === 'generic_base') {
      part.semanticRole = category === 'natural' ? 'terrain_base' : 'support_base'
    }
  }

  if (category === 'equipment') {
    add({
      kind: 'generic_control_panel',
      semanticRole: 'control_detail',
      length: length * 0.3,
      height: height * 0.28,
      accentColor: stringValue(input.accentColor) ?? '#38bdf8',
    })
    add({ kind: 'generic_foot_set', semanticRole: 'support_foot' })
    if (isCoffeeLikeGeneric(input)) {
      add({
        kind: 'generic_spout',
        semanticRole: 'spout',
        length: width * 0.22,
        radius: Math.min(length, width) * 0.035,
      })
      add({
        kind: 'generic_base',
        semanticRole: 'cup_platform',
        length: length * 0.44,
        width: width * 0.28,
        thickness: height * 0.055,
        position: [0, height * 0.18, width * 0.56],
      })
    }
  } else if (category === 'building') {
    add({
      kind: 'generic_panel',
      semanticRole: 'roof',
      length: length * 1.08,
      height: height * 0.18,
      color: '#7f1d1d',
      position: [0, height * 0.92, 0],
    })
    add({
      kind: 'generic_opening',
      semanticRole: 'opening',
      length: length * 0.22,
      height: height * 0.34,
    })
  } else if (category === 'furniture') {
    add({ kind: 'generic_foot_set', semanticRole: 'support_leg' })
    add({ kind: 'generic_detail_accent', semanticRole: 'detail_accent' })
  } else if (category === 'natural') {
    add({ kind: 'generic_detail_accent', semanticRole: 'detail_accent', accentColor: '#6b8f47' })
  } else {
    add({ kind: 'generic_detail_accent', semanticRole: 'detail_accent' })
  }

  return plan
}

export function normalizeKioskPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('kiosk', KIOSK_PART_DEFINITIONS, input)
}

export function normalizePumpPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('pump', PUMP_PART_DEFINITIONS, input)
}

export function normalizeConveyorPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('conveyor', CONVEYOR_PART_DEFINITIONS, input)
}

export function normalizeElectricalPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('electrical', ELECTRICAL_PART_DEFINITIONS, input)
}

export function normalizePipeSystemPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('pipe_system', PIPE_SYSTEM_PART_DEFINITIONS, input)
}

export function normalizeTankPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('tank', TANK_PART_DEFINITIONS, input)
}

export function normalizeReactorPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('reactor', REACTOR_PART_DEFINITIONS, input)
}

export function normalizeCompressorPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('compressor', COMPRESSOR_PART_DEFINITIONS, input)
}

export function normalizeHeatExchangerPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('heat_exchanger', HEAT_EXCHANGER_PART_DEFINITIONS, input)
}

export function normalizeMachineToolPartPlan(input: Record<string, unknown>): NormalizedPartPlan {
  return normalizeFamilyPartPlan('machine_tool', MACHINE_TOOL_PART_DEFINITIONS, input)
}

export function normalizePartPlanForFamily(
  family: string,
  input: Record<string, unknown>,
): NormalizedPartPlan | undefined {
  const definitions = getPartDefinitions(family)
  if (definitions.length === 0) return undefined
  return normalizeFamilyPartPlan(family, definitions, input)
}
