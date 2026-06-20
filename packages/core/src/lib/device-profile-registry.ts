import {
  FAMILY_DEFINITIONS,
  getFamilyDefinition,
  getLayoutFamilyDefinition,
  type LayoutFamilyId,
  normalizeLayoutFamilyId,
} from './family-registry'
import type { PartComposeKind, PartComposePartInput } from './part-compose'
import { getPartDefinitions } from './part-registry'

export type DeviceArchetypeFamily =
  | 'rotating_fluid_machine'
  | 'material_handling'
  | 'process_vessel'
  | 'thermal_equipment'
  | 'enclosed_machine'
  | 'robotic_workcell'
  | 'electrical_enclosure'
  | 'pipe_valve_system'
  | 'generic_industrial'

export type DeviceProfileStatus =
  | 'runtime_draft'
  | 'candidate'
  | 'pending_review'
  | 'stable'
  | 'draft'
export type DeviceProfileSource = 'builtin' | 'workspace' | 'imported_pack' | 'generated_candidate'

const PROFILE_SOURCE_PRIORITY: Record<DeviceProfileSource, number> = {
  workspace: 4,
  imported_pack: 3,
  builtin: 2,
  generated_candidate: 1,
}

export interface DimensionDefaults {
  length?: number
  width?: number
  height?: number
  diameter?: number
}

export interface DimensionRule {
  from: 'length' | 'width' | 'height' | 'diameter'
  toPart: string
  toParam: string
  scale?: number
  offset?: number
  min?: number
  max?: number
}

export interface ProfilePartSpec extends PartComposePartInput {
  kind: PartComposeKind | string
  semanticRole: string
  required?: boolean
  preset?: string
  params?: Record<string, unknown>
  dimensionBindings?: Record<string, string>
}

export interface DeviceProfileSourcePack {
  id: string
  version: string
  industry?: string
}

export interface DeviceProfileOverrideInfo {
  id: string
  name: string
  source: DeviceProfileSource
  sourcePack?: DeviceProfileSourcePack
}

export interface DeviceProfileShapeCountRule {
  min?: number
  max?: number
}

export interface DeviceProfileRangeRule {
  min?: number
  max?: number
}

export interface DeviceProfileQualityRules {
  requiredRoles?: readonly string[]
  forbiddenRoles?: readonly string[]
  shapeCount?: DeviceProfileShapeCountRule
  dimensionExpectations?: {
    lengthToDiameterRatio?: DeviceProfileRangeRule
  }
}

export type DeviceProfileRuleRef = string | Record<string, unknown>

export type DeviceProfileDetailLevel = 'low' | 'medium' | 'high'

export interface DeviceProfilePartDetailBudget {
  detailLevel?: DeviceProfileDetailLevel
  count?: number
  ringCount?: number
  spokeCount?: number
  slatCount?: number
  rungCount?: number
  boltCount?: number
  radialSegments?: number
  levelCount?: number
}

export interface DeviceProfileDetailBudget {
  detailLevel?: DeviceProfileDetailLevel
  maxShapes?: number
  parts?: Record<string, DeviceProfilePartDetailBudget>
}

export type EditablePropertyType = 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string'

export type EditablePropertyRole =
  | 'structure'
  | 'dimension'
  | 'pose'
  | 'material'
  | 'detail'
  | 'workcell'

export interface EditablePropertyDefinition {
  type: EditablePropertyType
  default?: unknown
  min?: number
  max?: number
  values?: readonly unknown[]
  unit?: string
  aliases?: readonly string[]
  role?: EditablePropertyRole
  description?: string
}

export interface EditableSchemaDefinition {
  id: string
  name: string
  description?: string
  properties: Record<string, EditablePropertyDefinition>
}

export interface DeviceProfileDefinition {
  id: string
  name: string
  aliases: readonly string[]
  industry?: string
  layoutFamily?: LayoutFamilyId
  layoutTemplate?: string
  archetypeFamily: DeviceArchetypeFamily
  family: string
  defaultDimensions?: DimensionDefaults
  parts: readonly ProfilePartSpec[]
  primarySemanticRole: string
  dimensionRules?: readonly DimensionRule[]
  partPresets?: Record<string, string>
  resolvedPartPresets?: Record<string, Record<string, unknown>>
  proportionRules?: DeviceProfileRuleRef
  qualityRules?: DeviceProfileRuleRef
  detailBudget?: DeviceProfileDetailBudget
  visualCues?: readonly string[]
  layoutHints?: Record<string, unknown>
  roleAliases?: Record<string, readonly string[]>
  editableSchemaRef?: string
  editableOverrides?: Record<string, Partial<EditablePropertyDefinition>>
  resolvedEditableSchema?: EditableSchemaDefinition
  status: DeviceProfileStatus
  source: DeviceProfileSource
  sourcePack?: DeviceProfileSourcePack
  overrides?: readonly DeviceProfileOverrideInfo[]
  description: string
  forbiddenRoles?: readonly string[]
}

export interface DeviceProfileValidation {
  ok: boolean
  issues: string[]
  warnings: string[]
  score?: number
}

export interface DeviceProfileResolver {
  profiles: readonly DeviceProfileDefinition[]
  get: (profile: unknown) => DeviceProfileDefinition | undefined
  infer: (input: Record<string, unknown>) => DeviceProfileDefinition | undefined
  summary: () => string
}

export interface DeviceProfileMergeResult {
  profiles: DeviceProfileDefinition[]
  warnings: string[]
}

export interface DraftDeviceProfileResult {
  profile: DeviceProfileDefinition
  validation: DeviceProfileValidation
}

export interface DeviceProfileExecutionValidation extends DeviceProfileValidation {
  stages: {
    schema: DeviceProfileValidation
    registry: DeviceProfileValidation
    execution?: DeviceProfileValidation
  }
}

export interface DeviceProfileQualityInputShape {
  name?: string
  semanticRole?: string
  sourcePartKind?: string
  semanticGroup?: string
  position?: readonly number[]
  length?: number
  width?: number
  height?: number
  depth?: number
  radius?: number
  radiusTop?: number
  radiusBottom?: number
  thickness?: number
}

export interface DeviceProfileQualityScore {
  semanticScore: number
  geometryScore: number
  editabilityScore: number
  visualCompletenessScore: number
  overallScore: number
  warnings: string[]
  issues: string[]
  metrics: Record<string, number>
}

export const DEVICE_PROFILE_DEFINITIONS = [
  {
    id: 'centrifugal_pump',
    name: 'Centrifugal pump',
    aliases: ['centrifugal pump', 'process pump', 'chemical pump', 'li xin beng', 'gong yi beng'],
    layoutFamily: 'rotating_machine_layout',
    archetypeFamily: 'rotating_fluid_machine',
    family: 'pump',
    defaultDimensions: { length: 2.2, width: 0.9, height: 1.1 },
    parts: [
      { kind: 'skid_base', semanticRole: 'support_base' },
      { kind: 'volute_casing', semanticRole: 'volute_casing' },
      { kind: 'ribbed_motor_body', semanticRole: 'drive_motor' },
      { kind: 'inlet_port', semanticRole: 'inlet_port' },
      { kind: 'outlet_port', semanticRole: 'outlet_port' },
      { kind: 'flange_ring', semanticRole: 'flange' },
      { kind: 'control_box', semanticRole: 'control_box' },
    ],
    primarySemanticRole: 'volute_casing',
    status: 'stable',
    source: 'builtin',
    description: 'Skid-mounted centrifugal/process pump with motor, volute, ports, and flanges.',
  },
  {
    id: 'screw_compressor',
    name: 'Screw compressor',
    aliases: [
      'screw compressor',
      'air compressor',
      'gas compressor',
      'skid compressor',
      'luo gan ya suo ji',
    ],
    layoutFamily: 'rotating_machine_layout',
    archetypeFamily: 'rotating_fluid_machine',
    family: 'compressor',
    defaultDimensions: { length: 2.4, width: 0.9, height: 1.05 },
    parts: [
      { kind: 'skid_base', semanticRole: 'machine_base' },
      { kind: 'rounded_machine_body', semanticRole: 'compressor_casing' },
      { kind: 'ribbed_motor_body', semanticRole: 'motor_body' },
      { kind: 'inlet_port', semanticRole: 'inlet_port' },
      { kind: 'outlet_port', semanticRole: 'outlet_port' },
      { kind: 'control_box', semanticRole: 'control_box' },
    ],
    primarySemanticRole: 'compressor_casing',
    status: 'stable',
    source: 'builtin',
    description:
      'Skid-mounted compressor with drive motor, casing, process ports, and control box.',
  },
  {
    id: 'belt_conveyor',
    name: 'Belt conveyor',
    aliases: ['belt conveyor', 'conveyor line', 'material conveyor', 'pi dai shu song ji'],
    layoutFamily: 'linear_transport_layout',
    archetypeFamily: 'material_handling',
    family: 'conveyor',
    defaultDimensions: { length: 4, width: 0.8, height: 0.75 },
    parts: [
      { kind: 'conveyor_frame', semanticRole: 'conveyor_frame' },
      { kind: 'roller_array', semanticRole: 'roller_array' },
      { kind: 'belt_surface', semanticRole: 'belt_surface' },
      { kind: 'ribbed_motor_body', semanticRole: 'drive_motor' },
    ],
    primarySemanticRole: 'conveyor_frame',
    status: 'stable',
    source: 'builtin',
    description:
      'Long belt conveyor with frame, support legs, repeated rollers, belt, and drive motor.',
  },
  {
    id: 'vertical_storage_tank',
    name: 'Vertical storage tank',
    aliases: [
      'vertical storage tank',
      'chemical storage tank',
      'vertical tank',
      'li shi chu guan',
      'hua gong chu guan',
    ],
    layoutFamily: 'vessel_layout',
    archetypeFamily: 'process_vessel',
    family: 'tank',
    defaultDimensions: { diameter: 1.4, height: 3.2 },
    parts: [
      { kind: 'cylindrical_tank', semanticRole: 'vessel_shell' },
      { kind: 'skid_base', semanticRole: 'support_base' },
      { kind: 'inlet_port', semanticRole: 'inlet_port' },
      { kind: 'outlet_port', semanticRole: 'outlet_port' },
      { kind: 'platform_ladder', semanticRole: 'access_platform' },
    ],
    primarySemanticRole: 'vessel_shell',
    status: 'stable',
    source: 'builtin',
    description:
      'Vertical vessel with support base, top inlet, lower outlet, and access ladder/platform.',
  },
  {
    id: 'stirred_reactor',
    name: 'Stirred reactor',
    aliases: [
      'stirred reactor',
      'reaction vessel',
      'agitator tank',
      'fan ying fu',
      'jiao ban guan',
    ],
    layoutFamily: 'vessel_layout',
    archetypeFamily: 'process_vessel',
    family: 'reactor',
    defaultDimensions: { diameter: 1.2, height: 2.4 },
    parts: [
      { kind: 'agitator_tank', semanticRole: 'reactor_vessel_shell' },
      { kind: 'inlet_port', semanticRole: 'inlet_port' },
      { kind: 'outlet_port', semanticRole: 'outlet_port' },
      { kind: 'platform_ladder', semanticRole: 'access_platform' },
    ],
    primarySemanticRole: 'reactor_vessel_shell',
    status: 'stable',
    source: 'builtin',
    description:
      'Agitated reactor vessel with mixer, feed/discharge nozzles, and optional access platform.',
  },
  {
    id: 'shell_tube_heat_exchanger',
    name: 'Shell-and-tube heat exchanger',
    aliases: ['shell and tube heat exchanger', 'heat exchanger', 'condenser', 'huan re qi'],
    layoutFamily: 'vessel_layout',
    archetypeFamily: 'thermal_equipment',
    family: 'heat_exchanger',
    defaultDimensions: { length: 3, width: 0.55, height: 0.75, diameter: 0.5 },
    parts: [
      { kind: 'heat_exchanger', semanticRole: 'heat_exchanger_shell' },
      { kind: 'skid_base', semanticRole: 'support_base' },
    ],
    primarySemanticRole: 'heat_exchanger_shell',
    status: 'stable',
    source: 'builtin',
    description:
      'Horizontal shell-and-tube exchanger with channel heads, nozzles, and saddle supports.',
  },
  {
    id: 'cnc_machining_center',
    name: 'CNC machining center',
    aliases: [
      'cnc machining center',
      'cnc machine',
      'cnc mill',
      'jia gong zhong xin',
      'shu kong ji chuang',
    ],
    layoutFamily: 'box_enclosure_layout',
    archetypeFamily: 'enclosed_machine',
    family: 'machine_tool',
    defaultDimensions: { length: 2.8, width: 1.1, height: 1.7 },
    parts: [
      { kind: 'generic_base', semanticRole: 'machine_base' },
      { kind: 'generic_body', semanticRole: 'machine_enclosure' },
      { kind: 'viewing_panel', semanticRole: 'viewing_panel' },
      { kind: 'work_table', semanticRole: 'work_table' },
      { kind: 'generic_panel', semanticRole: 'spindle_head' },
      { kind: 'control_box', semanticRole: 'control_panel' },
      { kind: 'display_screen', semanticRole: 'display_screen' },
      { kind: 'vent_panel', semanticRole: 'vent_panel' },
      { kind: 'access_panel', semanticRole: 'access_panel' },
    ],
    primarySemanticRole: 'machine_enclosure',
    status: 'stable',
    source: 'builtin',
    description:
      'Enclosed CNC/machine-tool body with bed, viewing panel, spindle head, table, and controls.',
  },
  {
    id: 'packaging_machine',
    name: 'Packaging machine',
    aliases: ['packaging machine', 'bagging machine', 'cartoning machine', 'bao zhuang ji'],
    layoutFamily: 'box_enclosure_layout',
    archetypeFamily: 'enclosed_machine',
    family: 'machine_tool',
    defaultDimensions: { length: 2.6, width: 1, height: 1.6 },
    parts: [
      { kind: 'generic_base', semanticRole: 'machine_base' },
      { kind: 'generic_body', semanticRole: 'machine_enclosure' },
      {
        kind: 'generic_spout',
        semanticRole: 'feed_chute',
        position: [-0.62, 0.92, 0.58],
        axis: 'z',
        length: 0.34,
        radius: 0.08,
      },
      {
        kind: 'generic_spout',
        semanticRole: 'discharge_chute',
        position: [0.72, 0.48, -0.58],
        axis: 'z',
        length: 0.4,
        radius: 0.09,
      },
      { kind: 'control_box', semanticRole: 'control_panel' },
      { kind: 'display_screen', semanticRole: 'display_screen' },
      { kind: 'vent_panel', semanticRole: 'vent_panel' },
    ],
    primarySemanticRole: 'machine_enclosure',
    status: 'stable',
    source: 'builtin',
    description: 'Enclosed packaging/bagging machine mapped to the enclosed-machine archetype.',
  },
  {
    id: 'robot_welding_cell',
    name: 'Robot welding cell',
    aliases: ['robot welding cell', 'robotic welding cell', 'industrial robot workstation'],
    layoutFamily: 'robot_workcell_layout',
    archetypeFamily: 'robotic_workcell',
    family: 'robot_arm',
    defaultDimensions: { length: 2.2, width: 1.6, height: 1.8 },
    parts: [
      { kind: 'generic_base', semanticRole: 'robot_base' },
      { kind: 'generic_body', semanticRole: 'upper_arm' },
      { kind: 'generic_body', semanticRole: 'forearm' },
      { kind: 'generic_panel', semanticRole: 'work_table' },
      { kind: 'control_box', semanticRole: 'control_panel' },
      { kind: 'warning_label', semanticRole: 'warning_label' },
    ],
    primarySemanticRole: 'robot_base',
    status: 'stable',
    source: 'builtin',
    description:
      'Robot workcell profile with arm, fixture table, control cabinet, and safety cues.',
  },
  {
    id: 'palletizer_cell',
    name: 'Palletizer cell',
    aliases: ['palletizer', 'palletizing robot', 'robot palletizer', 'ma duo ji'],
    layoutFamily: 'robot_workcell_layout',
    archetypeFamily: 'robotic_workcell',
    family: 'robot_arm',
    defaultDimensions: { length: 2.6, width: 1.8, height: 2 },
    parts: [
      { kind: 'generic_base', semanticRole: 'robot_base' },
      { kind: 'generic_body', semanticRole: 'upper_arm' },
      { kind: 'generic_body', semanticRole: 'forearm' },
      { kind: 'generic_panel', semanticRole: 'work_table' },
      { kind: 'control_box', semanticRole: 'control_panel' },
      { kind: 'warning_label', semanticRole: 'warning_label' },
    ],
    primarySemanticRole: 'robot_base',
    status: 'stable',
    source: 'builtin',
    description: 'Palletizing robot cell mapped to the robotic-workcell archetype.',
  },
] as const satisfies readonly DeviceProfileDefinition[]

export type DeviceProfileId = (typeof DEVICE_PROFILE_DEFINITIONS)[number]['id']

export const EDITABLE_SCHEMA_DEFINITIONS = [
  {
    id: 'robot_arm.common',
    name: 'Common robot arm editable properties',
    description: 'Shared editable controls for articulated industrial robot arms.',
    properties: {
      axisCount: {
        type: 'integer',
        min: 3,
        max: 7,
        default: 6,
        aliases: ['axis count', 'axes', 'joint count', '轴数', '几轴'],
        role: 'structure',
      },
      reach: {
        type: 'number',
        min: 0.8,
        max: 8,
        default: 1.58,
        unit: 'm',
        aliases: ['reach', 'arm span', 'working radius', '臂展', '工作半径'],
        role: 'dimension',
      },
      height: {
        type: 'number',
        min: 0.8,
        max: 4,
        default: 2.2,
        unit: 'm',
        aliases: ['height', 'overall height', '高度'],
        role: 'dimension',
      },
      pose: {
        type: 'enum',
        values: ['work-ready', 'reach-forward', 'rest'],
        default: 'work-ready',
        aliases: ['pose', 'posture', '姿态'],
        role: 'pose',
      },
      endEffector: {
        type: 'enum',
        values: ['tool-flange', 'gripper', 'suction'],
        default: 'tool-flange',
        aliases: ['end effector', 'tool', '末端', '末端工具', '夹爪', '吸盘', '法兰'],
        role: 'structure',
      },
      primaryColor: {
        type: 'color',
        default: '#facc15',
        aliases: ['main color', 'body color', '主体颜色', '颜色'],
        role: 'material',
      },
      secondaryColor: {
        type: 'color',
        default: '#111827',
        aliases: ['joint color', 'secondary color', '关节颜色'],
        role: 'material',
      },
      metalColor: {
        type: 'color',
        default: '#cbd5e1',
        aliases: ['metal color', 'flange color', '金属色'],
        role: 'material',
      },
      includeCableHarness: {
        type: 'boolean',
        default: true,
        aliases: ['cable', 'cable harness', '线缆', '线束'],
        role: 'detail',
      },
      includeWorkcell: {
        type: 'boolean',
        default: false,
        aliases: ['workcell', 'station', '工作站', '工位'],
        role: 'workcell',
      },
      detailLevel: {
        type: 'enum',
        values: ['low', 'medium', 'high'],
        default: 'medium',
        aliases: ['detail', 'complexity', '细节', '精细度'],
        role: 'detail',
      },
    },
  },
  {
    id: 'vessel.common',
    name: 'Common vessel editable properties',
    description: 'Shared editable controls for tanks, reactors, silos, and process vessels.',
    properties: {
      height: {
        type: 'number',
        min: 0.2,
        max: 40,
        default: 1.6,
        unit: 'm',
        aliases: ['height', 'overall height', 'vessel height'],
        role: 'dimension',
      },
      diameter: {
        type: 'number',
        min: 0.1,
        max: 20,
        default: 1,
        unit: 'm',
        aliases: ['diameter', 'vessel diameter', 'tank diameter'],
        role: 'dimension',
      },
      length: {
        type: 'number',
        min: 0.2,
        max: 80,
        default: 2,
        unit: 'm',
        aliases: ['length', 'shell length', 'tank length'],
        role: 'dimension',
      },
      primaryColor: {
        type: 'color',
        default: '#94a3b8',
        aliases: ['main color', 'body color', 'color'],
        role: 'material',
      },
      metalColor: {
        type: 'color',
        default: '#cbd5e1',
        aliases: ['metal color', 'stainless color'],
        role: 'material',
      },
      supportCount: {
        type: 'integer',
        min: 0,
        max: 12,
        default: 4,
        aliases: ['support count', 'leg count'],
        role: 'structure',
      },
    },
  },
  {
    id: 'conveyor.common',
    name: 'Common conveyor editable properties',
    description: 'Shared editable controls for belt, screw, and bucket conveying equipment.',
    properties: {
      length: {
        type: 'number',
        min: 0.5,
        max: 80,
        default: 4,
        unit: 'm',
        aliases: ['length', 'conveyor length'],
        role: 'dimension',
      },
      width: {
        type: 'number',
        min: 0.15,
        max: 8,
        default: 0.8,
        unit: 'm',
        aliases: ['width', 'belt width', 'trough width'],
        role: 'dimension',
      },
      height: {
        type: 'number',
        min: 0.1,
        max: 12,
        default: 0.8,
        unit: 'm',
        aliases: ['height', 'support height'],
        role: 'dimension',
      },
      inclineAngle: {
        type: 'number',
        min: -35,
        max: 35,
        default: 0,
        unit: 'deg',
        aliases: ['incline', 'slope angle'],
        role: 'pose',
      },
      primaryColor: {
        type: 'color',
        default: '#64748b',
        aliases: ['main color', 'frame color', 'color'],
        role: 'material',
      },
    },
  },
  {
    id: 'rotary_equipment.common',
    name: 'Common rotary equipment editable properties',
    description: 'Shared editable controls for kilns, mills, drums, and rotating shells.',
    properties: {
      length: {
        type: 'number',
        min: 0.5,
        max: 120,
        default: 6,
        unit: 'm',
        aliases: ['length', 'shell length', 'drum length'],
        role: 'dimension',
      },
      diameter: {
        type: 'number',
        min: 0.1,
        max: 20,
        default: 1,
        unit: 'm',
        aliases: ['diameter', 'shell diameter', 'drum diameter'],
        role: 'dimension',
      },
      primaryColor: {
        type: 'color',
        default: '#6b7280',
        aliases: ['main color', 'shell color', 'color'],
        role: 'material',
      },
      metalColor: {
        type: 'color',
        default: '#9ca3af',
        aliases: ['metal color', 'ring color'],
        role: 'material',
      },
    },
  },
  {
    id: 'enclosure.common',
    name: 'Common enclosure editable properties',
    description: 'Shared editable controls for enclosed machines and electrical cabinets.',
    properties: {
      length: {
        type: 'number',
        min: 0.3,
        max: 20,
        default: 2,
        unit: 'm',
        aliases: ['length', 'machine length'],
        role: 'dimension',
      },
      width: {
        type: 'number',
        min: 0.2,
        max: 12,
        default: 1,
        unit: 'm',
        aliases: ['width', 'machine width', 'depth'],
        role: 'dimension',
      },
      height: {
        type: 'number',
        min: 0.2,
        max: 12,
        default: 1.4,
        unit: 'm',
        aliases: ['height', 'machine height'],
        role: 'dimension',
      },
      primaryColor: {
        type: 'color',
        default: '#94a3b8',
        aliases: ['main color', 'body color', 'color'],
        role: 'material',
      },
      secondaryColor: {
        type: 'color',
        default: '#475569',
        aliases: ['panel color', 'secondary color'],
        role: 'material',
      },
    },
  },
  {
    id: 'mobile_platform.common',
    name: 'Common mobile platform editable properties',
    description: 'Shared editable controls for AGV and AMR mobile equipment.',
    properties: {
      length: {
        type: 'number',
        min: 0.3,
        max: 8,
        default: 1.4,
        unit: 'm',
        aliases: ['length', 'vehicle length'],
        role: 'dimension',
      },
      width: {
        type: 'number',
        min: 0.2,
        max: 4,
        default: 0.9,
        unit: 'm',
        aliases: ['width', 'vehicle width'],
        role: 'dimension',
      },
      height: {
        type: 'number',
        min: 0.08,
        max: 2,
        default: 0.32,
        unit: 'm',
        aliases: ['height', 'vehicle height'],
        role: 'dimension',
      },
      primaryColor: {
        type: 'color',
        default: '#e5e7eb',
        aliases: ['main color', 'body color', 'color'],
        role: 'material',
      },
      secondaryColor: {
        type: 'color',
        default: '#334155',
        aliases: ['bumper color', 'secondary color'],
        role: 'material',
      },
    },
  },
  {
    id: 'tower_frame.common',
    name: 'Common tower frame editable properties',
    description:
      'Shared editable controls for industrial towers, frames, and preheater structures.',
    properties: {
      height: {
        type: 'number',
        min: 1,
        max: 80,
        default: 12,
        unit: 'm',
        aliases: ['height', 'tower height'],
        role: 'dimension',
      },
      width: {
        type: 'number',
        min: 0.5,
        max: 30,
        default: 4,
        unit: 'm',
        aliases: ['width', 'tower width', 'frame width'],
        role: 'dimension',
      },
      depth: {
        type: 'number',
        min: 0.5,
        max: 30,
        default: 3,
        unit: 'm',
        aliases: ['depth', 'tower depth', 'frame depth'],
        role: 'dimension',
      },
      levelCount: {
        type: 'integer',
        min: 1,
        max: 12,
        default: 5,
        aliases: ['levels', 'floor count', 'platform count'],
        role: 'structure',
      },
      primaryColor: {
        type: 'color',
        default: '#64748b',
        aliases: ['main color', 'frame color', 'color'],
        role: 'material',
      },
    },
  },
] as const satisfies readonly EditableSchemaDefinition[]

function editablePropertyDefinition(value: unknown): EditablePropertyDefinition | undefined {
  if (!isRecord(value)) return undefined
  const type = typeof value.type === 'string' ? value.type : undefined
  if (
    type !== 'number' &&
    type !== 'integer' &&
    type !== 'boolean' &&
    type !== 'enum' &&
    type !== 'color' &&
    type !== 'string'
  ) {
    return undefined
  }
  const role = typeof value.role === 'string' ? value.role : undefined
  return {
    type,
    ...(value.default != null ? { default: value.default } : {}),
    ...(typeof value.min === 'number' && Number.isFinite(value.min) ? { min: value.min } : {}),
    ...(typeof value.max === 'number' && Number.isFinite(value.max) ? { max: value.max } : {}),
    ...(Array.isArray(value.values) ? { values: value.values } : {}),
    ...(typeof value.unit === 'string' && value.unit.trim() ? { unit: value.unit.trim() } : {}),
    ...(stringArray(value.aliases).length ? { aliases: stringArray(value.aliases) } : {}),
    ...(role === 'structure' ||
    role === 'dimension' ||
    role === 'pose' ||
    role === 'material' ||
    role === 'detail' ||
    role === 'workcell'
      ? { role }
      : {}),
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
  }
}

export function normalizeEditableSchemaInput(value: unknown): EditableSchemaDefinition | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id
  const properties = isRecord(value.properties) ? value.properties : undefined
  if (!id || !name || !properties) return undefined
  const normalizedProperties = Object.fromEntries(
    Object.entries(properties).flatMap(([key, raw]) => {
      const property = editablePropertyDefinition(raw)
      return property ? [[key, property] as const] : []
    }),
  )
  if (Object.keys(normalizedProperties).length === 0) return undefined
  return {
    id,
    name,
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
    properties: normalizedProperties,
  }
}

export function editableSchemaById(
  schemas: readonly EditableSchemaDefinition[] = EDITABLE_SCHEMA_DEFINITIONS,
) {
  return new Map(schemas.map((schema) => [normalizeKey(schema.id), schema]))
}

function inferredEditableSchemaRef(profile: DeviceProfileDefinition): string | undefined {
  const id = normalizeKey(profile.id)
  const family = normalizeKey(profile.family)
  const layoutFamily = normalizeKey(profile.layoutFamily)
  const archetypeFamily = normalizeKey(profile.archetypeFamily)
  const parts = profile.parts
    .map((part) => normalizeKey([part.kind, part.semanticRole, part.id].filter(Boolean).join(' ')))
    .join(' ')
  const text = [id, family, layoutFamily, archetypeFamily, parts].join(' ')
  if (family === 'robot_arm' || archetypeFamily === 'robotic_workcell') return 'robot_arm.common'
  if (text.includes('mobile_platform') || /\bagv\b|\bamr\b/.test(text)) {
    return 'mobile_platform.common'
  }
  if (text.includes('preheater') || text.includes('tower_frame') || text.includes('tower')) {
    return 'tower_frame.common'
  }
  if (
    archetypeFamily === 'rotating_fluid_machine' ||
    archetypeFamily === 'thermal_equipment' ||
    text.includes('rotary_kiln') ||
    text.includes('mill_shell') ||
    text.includes('drum')
  ) {
    return 'rotary_equipment.common'
  }
  if (family === 'conveyor' || archetypeFamily === 'material_handling') return 'conveyor.common'
  if (
    family === 'tank' ||
    family === 'reactor' ||
    layoutFamily === 'vessel_layout' ||
    archetypeFamily === 'process_vessel'
  ) {
    return 'vessel.common'
  }
  if (
    family === 'machine_tool' ||
    family === 'electrical' ||
    layoutFamily === 'box_enclosure_layout' ||
    archetypeFamily === 'enclosed_machine' ||
    archetypeFamily === 'electrical_enclosure'
  ) {
    return 'enclosure.common'
  }
  return undefined
}

export function resolveEditableSchemaForProfile(
  profile: DeviceProfileDefinition,
  schemas: readonly EditableSchemaDefinition[] = EDITABLE_SCHEMA_DEFINITIONS,
): EditableSchemaDefinition | undefined {
  const schemaRef = profile.editableSchemaRef ?? inferredEditableSchemaRef(profile)
  const base =
    profile.resolvedEditableSchema ??
    (schemaRef ? editableSchemaById(schemas).get(normalizeKey(schemaRef)) : undefined)
  if (!base) return undefined
  const overrides = profile.editableOverrides ?? {}
  const properties = { ...base.properties }
  for (const [key, override] of Object.entries(overrides)) {
    const existing = properties[key]
    if (!existing) continue
    properties[key] = { ...existing, ...override }
  }
  return { ...base, properties }
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_.-]+/g, '_')
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

function containsAliasToken(normalizedText: string, alias: string): boolean {
  if (!alias) return false
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

function requestedRobotAxisCount(input: Record<string, unknown>): number | undefined {
  const text = textOf([input.object, input.name, input.category, input.prompt, input.style])
  if (/(seven[_\s-]?axis|7[_\s-]?axis|\u4e03\u8f74)/i.test(text)) return 7
  if (/(six[_\s-]?axis|6[_\s-]?axis|\u516d\u8f74|fanuc|kuka|abb)/i.test(text)) return 6
  if (/(five[_\s-]?axis|5[_\s-]?axis|\u4e94\u8f74)/i.test(text)) return 5
  if (/(four[_\s-]?axis|4[_\s-]?axis|\u56db\u8f74|scara)/i.test(text)) return 4
  if (/(three[_\s-]?axis|3[_\s-]?axis|\u4e09\u8f74)/i.test(text)) return 3
  return undefined
}

function profileRobotAxisCount(profile: DeviceProfileDefinition): number | undefined {
  const robotDefaults = isRecord(profile.layoutHints?.robotArmDefaults)
    ? profile.layoutHints.robotArmDefaults
    : undefined
  const raw = robotDefaults?.axisCount ?? robotDefaults?.axes
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : undefined
}

function profileCompatibleWithPromptAxis(
  profile: DeviceProfileDefinition,
  input: Record<string, unknown>,
): boolean {
  const requestedAxisCount = requestedRobotAxisCount(input)
  if (requestedAxisCount == null) return true
  if (profile.family !== 'robot_arm' && profile.layoutFamily !== 'robot_workcell_layout')
    return true
  const profileAxisCount = profileRobotAxisCount(profile)
  return profileAxisCount == null || profileAxisCount === requestedAxisCount
}

const profileAliasMap = new Map<string, DeviceProfileDefinition>()
for (const profile of DEVICE_PROFILE_DEFINITIONS) {
  profileAliasMap.set(normalizeKey(profile.id), profile)
  for (const alias of profile.aliases) profileAliasMap.set(normalizeKey(alias), profile)
}

function sourcePriority(profile: DeviceProfileDefinition): number {
  return PROFILE_SOURCE_PRIORITY[profile.source] ?? 0
}

function compareProfilePriority(
  left: DeviceProfileDefinition,
  right: DeviceProfileDefinition,
): number {
  return sourcePriority(right) - sourcePriority(left)
}

function profileOverrideInfo(profile: DeviceProfileDefinition): DeviceProfileOverrideInfo {
  return {
    id: profile.id,
    name: profile.name,
    source: profile.source,
    ...(profile.sourcePack ? { sourcePack: profile.sourcePack } : {}),
  }
}

function withProfileOverride(
  winner: DeviceProfileDefinition,
  overridden: DeviceProfileDefinition,
): DeviceProfileDefinition {
  const existing = winner.overrides ?? []
  if (
    existing.some(
      (entry) =>
        normalizeKey(entry.id) === normalizeKey(overridden.id) &&
        entry.source === overridden.source,
    )
  ) {
    return winner
  }
  return {
    ...winner,
    overrides: [...existing, profileOverrideInfo(overridden)],
  }
}

export function mergeDeviceProfiles(
  profileSources: readonly (readonly DeviceProfileDefinition[])[],
): DeviceProfileMergeResult {
  const warnings: string[] = []
  const byId = new Map<string, DeviceProfileDefinition>()

  for (const profiles of profileSources) {
    for (const profile of profiles) {
      const key = normalizeKey(profile.id)
      if (!key) {
        warnings.push('Ignored device profile with empty id.')
        continue
      }
      const existing = byId.get(key)
      if (!existing || sourcePriority(profile) >= sourcePriority(existing)) {
        if (existing && existing.source !== profile.source) {
          warnings.push(
            `Device profile "${profile.id}" from ${profile.source} overrides ${existing.source}.`,
          )
        }
        byId.set(key, existing ? withProfileOverride(profile, existing) : profile)
      } else {
        warnings.push(
          `Device profile "${profile.id}" from ${profile.source} ignored because ${existing.source} has higher priority.`,
        )
        byId.set(key, withProfileOverride(existing, profile))
      }
    }
  }

  const profiles = Array.from(byId.values()).sort((left, right) => {
    const priority = compareProfilePriority(left, right)
    return priority !== 0 ? priority : left.id.localeCompare(right.id)
  })
  return { profiles, warnings }
}

function buildProfileAliasMap(profiles: readonly DeviceProfileDefinition[]) {
  const aliasMap = new Map<string, DeviceProfileDefinition>()
  for (const profile of [...profiles].sort(compareProfilePriority)) {
    const aliases = [profile.id, profile.name, ...profile.aliases]
    for (const alias of aliases) {
      const key = normalizeKey(alias)
      if (key && !aliasMap.has(key)) aliasMap.set(key, profile)
    }
  }
  return aliasMap
}

function inferDeviceProfileFromProfiles(
  input: Record<string, unknown>,
  profiles: readonly DeviceProfileDefinition[],
): DeviceProfileDefinition | undefined {
  const aliasMap = buildProfileAliasMap(profiles)
  const explicit =
    aliasMap.get(normalizeKey(input.deviceProfile)) ??
    aliasMap.get(normalizeKey(input.profile)) ??
    aliasMap.get(normalizeKey(input.deviceType))
  if (explicit) return explicit

  const text = textOf([input.object, input.name, input.category, input.prompt, input.style])
  const normalizedText = normalizeKey(text)
  const matches = profiles
    .flatMap((profile) =>
      [profile.id, profile.name, ...profile.aliases].map((alias) => ({
        profile,
        alias: normalizeKey(alias),
      })),
    )
    .filter((candidate) => containsAliasToken(normalizedText, candidate.alias))
    .filter((candidate) => profileCompatibleWithPromptAxis(candidate.profile, input))
  matches.sort((left, right) => {
    const priority = compareProfilePriority(left.profile, right.profile)
    return priority !== 0 ? priority : right.alias.length - left.alias.length
  })
  return matches[0]?.profile
}

export function createDeviceProfileResolver(
  profiles: readonly DeviceProfileDefinition[] = DEVICE_PROFILE_DEFINITIONS,
): DeviceProfileResolver {
  const merged = mergeDeviceProfiles([profiles])
  const aliasMap = buildProfileAliasMap(merged.profiles)
  return {
    profiles: merged.profiles,
    get: (profile: unknown) => aliasMap.get(normalizeKey(profile)),
    infer: (input: Record<string, unknown>) =>
      inferDeviceProfileFromProfiles(input, merged.profiles),
    summary: () => deviceProfileCapabilitySummary(merged.profiles),
  }
}

export function getDeviceProfileDefinition(profile: unknown): DeviceProfileDefinition | undefined {
  return profileAliasMap.get(normalizeKey(profile))
}

export function inferDeviceProfileDefinition(
  input: Record<string, unknown>,
  profiles: readonly DeviceProfileDefinition[] = DEVICE_PROFILE_DEFINITIONS,
): DeviceProfileDefinition | undefined {
  if (profiles !== DEVICE_PROFILE_DEFINITIONS) {
    const aliasMap = buildProfileAliasMap(profiles)
    const explicit =
      aliasMap.get(normalizeKey(input.deviceProfile)) ??
      aliasMap.get(normalizeKey(input.profile)) ??
      aliasMap.get(normalizeKey(input.deviceType))
    if (explicit) return explicit

    return inferDeviceProfileFromProfiles(input, profiles)
  }
  const explicit =
    getDeviceProfileDefinition(input.deviceProfile) ??
    getDeviceProfileDefinition(input.profile) ??
    getDeviceProfileDefinition(input.deviceType)
  if (explicit) return explicit

  const text = textOf([input.object, input.name, input.category, input.prompt, input.style])
  const normalizedText = normalizeKey(text)
  const matches = DEVICE_PROFILE_DEFINITIONS.flatMap((profile) =>
    [profile.id, ...profile.aliases].map((alias) => ({
      profile,
      alias: normalizeKey(alias),
    })),
  )
    .filter((candidate) => containsAliasToken(normalizedText, candidate.alias))
    .filter((candidate) => profileCompatibleWithPromptAxis(candidate.profile, input))
  matches.sort((left, right) => right.alias.length - left.alias.length)
  return matches[0]?.profile
}

function archetypeForLayoutFamily(layoutFamily: LayoutFamilyId): DeviceArchetypeFamily {
  switch (layoutFamily) {
    case 'rotating_machine_layout':
      return 'rotating_fluid_machine'
    case 'linear_transport_layout':
      return 'material_handling'
    case 'vessel_layout':
      return 'process_vessel'
    case 'box_enclosure_layout':
      return 'enclosed_machine'
    case 'robot_workcell_layout':
      return 'robotic_workcell'
    case 'pipe_valve_layout':
      return 'pipe_valve_system'
    case 'generic_industrial_layout':
      return 'generic_industrial'
    default:
      return 'enclosed_machine'
  }
}

function draftProfileId(label: string): string {
  const key = normalizeKey(label)
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
  return `${key || 'unknown_device'}_draft`
}

function draftProfileForKnownUnknown(prompt: string): DeviceProfileDefinition | undefined {
  const text = prompt.toLowerCase()
  if (/freeze\s*dryer|lyophili[sz]er|dong\s*gan|冻干/.test(text)) {
    return {
      id: 'freeze_dryer_draft',
      name: 'Freeze dryer',
      aliases: ['freeze dryer', 'lyophilizer', 'dong gan ji'],
      layoutFamily: 'generic_industrial_layout',
      archetypeFamily: 'generic_industrial',
      family: 'generic',
      defaultDimensions: { length: 2.2, width: 1.1, height: 1.8 },
      parts: [
        { kind: 'generic_base', semanticRole: 'machine_base', required: true },
        { kind: 'generic_body', semanticRole: 'vacuum_chamber', required: true },
        { kind: 'access_panel', semanticRole: 'sealed_door' },
        { kind: 'control_box', semanticRole: 'control_panel' },
        { kind: 'generic_display', semanticRole: 'display_screen' },
        { kind: 'generic_spout', semanticRole: 'vacuum_port' },
        { kind: 'generic_detail_accent', semanticRole: 'vent_panel' },
      ],
      primarySemanticRole: 'vacuum_chamber',
      status: 'runtime_draft',
      source: 'generated_candidate',
      description: 'Draft enclosed-machine profile for a freeze dryer / lyophilizer.',
    }
  }
  if (/filter\s*press|plate\s*frame|plate-and-frame|ya\s*lv|压滤/.test(text)) {
    return {
      id: 'filter_press_draft',
      name: 'Filter press',
      aliases: ['filter press', 'plate frame filter press', 'ban kuang ya lv ji'],
      layoutFamily: 'generic_industrial_layout',
      archetypeFamily: 'generic_industrial',
      family: 'generic',
      defaultDimensions: { length: 3.2, width: 1.0, height: 1.35 },
      parts: [
        { kind: 'generic_base', semanticRole: 'machine_base', required: true },
        { kind: 'generic_body', semanticRole: 'press_frame', required: true },
        { kind: 'generic_panel', semanticRole: 'filter_plate_stack', required: true },
        { kind: 'generic_spout', semanticRole: 'slurry_inlet' },
        { kind: 'generic_spout', semanticRole: 'filtrate_outlet' },
        { kind: 'control_box', semanticRole: 'control_panel' },
        { kind: 'warning_label', semanticRole: 'warning_label' },
      ],
      primarySemanticRole: 'press_frame',
      status: 'runtime_draft',
      source: 'generated_candidate',
      description: 'Draft enclosed-machine/process profile for a plate-and-frame filter press.',
    }
  }
  if (/screw\s*conveyor|auger|luo\s*xuan|螺旋输送/.test(text)) {
    return {
      id: 'screw_conveyor_draft',
      name: 'Screw conveyor',
      aliases: ['screw conveyor', 'auger conveyor', 'luo xuan shu song ji'],
      layoutFamily: 'linear_transport_layout',
      archetypeFamily: 'material_handling',
      family: 'conveyor',
      defaultDimensions: { length: 4.0, width: 0.65, height: 0.8 },
      parts: [
        { kind: 'conveyor_frame', semanticRole: 'conveyor_frame', required: true },
        { kind: 'roller_array', semanticRole: 'screw_flight', required: true },
        { kind: 'belt_surface', semanticRole: 'trough_cover' },
        { kind: 'ribbed_motor_body', semanticRole: 'drive_motor' },
        { kind: 'warning_label', semanticRole: 'warning_label' },
      ],
      primarySemanticRole: 'conveyor_frame',
      status: 'runtime_draft',
      source: 'generated_candidate',
      description: 'Draft linear-transport profile for a screw/auger conveyor.',
    }
  }
  return undefined
}

export function buildDraftDeviceProfile(
  prompt: string,
  intent: Record<string, unknown> = {},
): DraftDeviceProfileResult {
  const explicitDraft = isRecord(intent.deviceProfileDraft)
    ? normalizeDeviceProfileInput(intent.deviceProfileDraft, 'generated_candidate', 'runtime_draft')
    : undefined
  const profile = explicitDraft ??
    draftProfileForKnownUnknown(textOf([prompt, intent])) ?? {
      id: draftProfileId(
        textOf([intent.name, intent.object, intent.category, prompt]).slice(0, 64),
      ),
      name:
        typeof intent.name === 'string' && intent.name.trim()
          ? intent.name.trim()
          : 'Generic industrial equipment',
      aliases: [],
      layoutFamily: 'generic_industrial_layout',
      archetypeFamily: archetypeForLayoutFamily('generic_industrial_layout'),
      family: 'generic',
      parts: [
        { kind: 'generic_base', semanticRole: 'support_base', required: true },
        { kind: 'generic_body', semanticRole: 'main_body', required: true },
        { kind: 'generic_detail_accent', semanticRole: 'detail_accent' },
      ],
      primarySemanticRole: 'main_body',
      status: 'runtime_draft',
      source: 'generated_candidate',
      description: 'Generic industrial fallback draft profile.',
    }
  const validation = validateDeviceProfileDefinition(profile)
  return { profile, validation }
}

function partSpecMatchesDefinition(
  part: ProfilePartSpec,
  definition: { id: string; kind: string; semanticRole?: string; aliases: readonly string[] },
) {
  const candidates = [part.kind].map(normalizeKey).filter(Boolean)
  const definitionKeys = [definition.id, definition.kind, ...definition.aliases]
    .map(normalizeKey)
    .filter(Boolean)
  return candidates.some((candidate) =>
    definitionKeys.some((definitionKey) => candidate === definitionKey),
  )
}

function resolveProfilePartDefinition(profile: DeviceProfileDefinition, part: ProfilePartSpec) {
  const familyDefinition = getPartDefinitions(profile.family).find((definition) =>
    partSpecMatchesDefinition(part, definition),
  )
  if (familyDefinition) return familyDefinition

  for (const family of FAMILY_DEFINITIONS) {
    const definition = getPartDefinitions(family.id).find((candidate) =>
      partSpecMatchesDefinition(part, candidate),
    )
    if (definition) return definition
  }
  return undefined
}

export function validateDeviceProfileDefinition(
  profile: DeviceProfileDefinition,
): DeviceProfileValidation {
  const issues: string[] = []
  const warnings: string[] = []

  if (!profile.id.trim()) issues.push('Profile id is required.')
  if (!profile.name.trim()) issues.push(`Profile ${profile.id || '<unknown>'} name is required.`)
  if (!getFamilyDefinition(profile.family)) {
    issues.push(`Profile ${profile.id} references unknown family "${profile.family}".`)
  }

  const resolvedLayoutFamily = normalizeLayoutFamilyId(profile.layoutFamily ?? profile.family)
  if (!resolvedLayoutFamily) {
    issues.push(`Profile ${profile.id} cannot resolve a layout family.`)
  } else if (profile.layoutFamily && profile.layoutFamily !== resolvedLayoutFamily) {
    issues.push(
      `Profile ${profile.id} layoutFamily "${profile.layoutFamily}" does not resolve to a known layout family.`,
    )
  }

  const executableLayout = getLayoutFamilyDefinition(profile.family)
  if (
    profile.layoutFamily &&
    executableLayout &&
    executableLayout.id !== profile.layoutFamily &&
    profile.family !== 'generic'
  ) {
    warnings.push(
      `Profile ${profile.id} uses family "${profile.family}" from layout "${executableLayout.id}" but declares layoutFamily "${profile.layoutFamily}".`,
    )
  }

  if (!profile.primarySemanticRole.trim()) {
    issues.push(`Profile ${profile.id} primarySemanticRole is required.`)
  }

  if (profile.parts.length === 0) {
    issues.push(`Profile ${profile.id} must declare at least one part.`)
  }

  const resolvedParts = profile.parts.map((part) => ({
    part,
    definition: resolveProfilePartDefinition(profile, part),
  }))
  for (const { part, definition } of resolvedParts) {
    if (!definition) {
      issues.push(
        `Profile ${profile.id} references unknown ${profile.family} part "${String(
          part.kind ?? part.semanticRole ?? 'part',
        )}".`,
      )
    }
    if (!part.semanticRole?.trim()) {
      issues.push(`Profile ${profile.id} part "${String(part.kind)}" is missing semanticRole.`)
    }
  }

  const primaryRoleExists = resolvedParts.some(({ part, definition }) => {
    const primary = normalizeKey(profile.primarySemanticRole)
    return (
      normalizeKey(part.semanticRole) === primary ||
      normalizeKey(definition?.semanticRole) === primary ||
      normalizeKey(definition?.kind) === primary
    )
  })
  if (profile.primarySemanticRole && !primaryRoleExists) {
    issues.push(
      `Profile ${profile.id} primarySemanticRole "${profile.primarySemanticRole}" is not represented by its parts.`,
    )
  }

  return { ok: issues.length === 0, issues, warnings }
}

export function validateDeviceProfileSchema(
  profile: DeviceProfileDefinition,
): DeviceProfileValidation {
  const issues: string[] = []
  const warnings: string[] = []
  if (!profile.id || typeof profile.id !== 'string') issues.push('Profile id must be a string.')
  if (!profile.name || typeof profile.name !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} name must be a string.`)
  }
  if (!profile.family || typeof profile.family !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} family must be a string.`)
  }
  if (!Array.isArray(profile.aliases))
    warnings.push(`Profile ${profile.id} aliases should be an array.`)
  if (profile.industry != null && typeof profile.industry !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} industry must be a string.`)
  }
  if (profile.layoutTemplate != null && typeof profile.layoutTemplate !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} layoutTemplate must be a string.`)
  }
  if (
    profile.partPresets != null &&
    (!isRecord(profile.partPresets) ||
      Object.values(profile.partPresets).some((value) => typeof value !== 'string'))
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} partPresets must map roles to preset ids.`)
  }
  if (
    profile.resolvedPartPresets != null &&
    (!isRecord(profile.resolvedPartPresets) ||
      Object.values(profile.resolvedPartPresets).some((value) => !isRecord(value)))
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} resolvedPartPresets must map ids to objects.`)
  }
  if (
    profile.proportionRules != null &&
    typeof profile.proportionRules !== 'string' &&
    !isRecord(profile.proportionRules)
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} proportionRules must be a string or object.`)
  }
  if (
    profile.qualityRules != null &&
    typeof profile.qualityRules !== 'string' &&
    !isRecord(profile.qualityRules)
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} qualityRules must be a string or object.`)
  }
  if (profile.detailBudget != null) {
    if (!isRecord(profile.detailBudget)) {
      issues.push(`Profile ${profile.id || '<unknown>'} detailBudget must be an object.`)
    } else {
      if (
        profile.detailBudget.detailLevel != null &&
        !detailLevel(profile.detailBudget.detailLevel)
      ) {
        issues.push(
          `Profile ${profile.id || '<unknown>'} detailBudget.detailLevel must be low, medium, or high.`,
        )
      }
      if (
        profile.detailBudget.maxShapes != null &&
        optionalNonNegativeInteger(profile.detailBudget.maxShapes) == null
      ) {
        issues.push(`Profile ${profile.id || '<unknown>'} detailBudget.maxShapes must be >= 0.`)
      }
      if (profile.detailBudget.parts != null && !isRecord(profile.detailBudget.parts)) {
        issues.push(`Profile ${profile.id || '<unknown>'} detailBudget.parts must be an object.`)
      }
      const qualityRules = qualityRulesObject(profile)
      const shapeMax = optionalPositiveNumber(qualityRules?.shapeCount?.max)
      const budgetMax = optionalNonNegativeInteger(profile.detailBudget.maxShapes)
      if (shapeMax != null && budgetMax != null && budgetMax > shapeMax) {
        warnings.push(
          `Profile ${profile.id} detailBudget.maxShapes exceeds qualityRules.shapeCount.max.`,
        )
      }
    }
  }
  if (
    profile.sourcePack != null &&
    (!isRecord(profile.sourcePack) ||
      typeof profile.sourcePack.id !== 'string' ||
      typeof profile.sourcePack.version !== 'string')
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} sourcePack must include id and version.`)
  }
  if (profile.editableSchemaRef != null && typeof profile.editableSchemaRef !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} editableSchemaRef must be a string.`)
  }
  if (
    profile.editableOverrides != null &&
    (!isRecord(profile.editableOverrides) ||
      Object.values(profile.editableOverrides).some((value) => !isRecord(value)))
  ) {
    issues.push(
      `Profile ${profile.id || '<unknown>'} editableOverrides must map properties to objects.`,
    )
  }
  if (
    profile.overrides != null &&
    (!Array.isArray(profile.overrides) ||
      profile.overrides.some(
        (entry) =>
          !isRecord(entry) ||
          typeof entry.id !== 'string' ||
          typeof entry.name !== 'string' ||
          typeof entry.source !== 'string',
      ))
  ) {
    issues.push(`Profile ${profile.id || '<unknown>'} overrides must be an array of profiles.`)
  }
  if (!Array.isArray(profile.parts) || profile.parts.length === 0) {
    issues.push(`Profile ${profile.id || '<unknown>'} parts must be a non-empty array.`)
  }
  for (const [index, part] of profile.parts.entries()) {
    if (!part.kind || typeof part.kind !== 'string') {
      issues.push(`Profile ${profile.id} part[${index}].kind must be a string.`)
    }
    if (!part.semanticRole || typeof part.semanticRole !== 'string') {
      issues.push(`Profile ${profile.id} part[${index}].semanticRole must be a string.`)
    }
  }
  if (!profile.primarySemanticRole || typeof profile.primarySemanticRole !== 'string') {
    issues.push(`Profile ${profile.id || '<unknown>'} primarySemanticRole must be a string.`)
  }
  return { ok: issues.length === 0, issues, warnings, score: issues.length === 0 ? 1 : 0 }
}

export function validateDeviceProfileForExecution(
  profile: DeviceProfileDefinition,
  execution?: DeviceProfileValidation,
): DeviceProfileExecutionValidation {
  const schema = validateDeviceProfileSchema(profile)
  const registry = validateDeviceProfileDefinition(profile)
  const stages = { schema, registry, ...(execution ? { execution } : {}) }
  const issues = [...schema.issues, ...registry.issues, ...(execution?.issues ?? [])]
  const warnings = [...schema.warnings, ...registry.warnings, ...(execution?.warnings ?? [])]
  const stageScores = [schema.score ?? (schema.ok ? 1 : 0), registry.score ?? (registry.ok ? 1 : 0)]
  if (execution) stageScores.push(execution.score ?? (execution.ok ? 1 : 0))
  const score = stageScores.reduce((sum, value) => sum + value, 0) / stageScores.length
  return {
    ok: issues.length === 0 && (!execution || execution.ok),
    issues,
    warnings,
    score,
    stages,
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function roleKey(value: unknown) {
  return normalizeKey(typeof value === 'string' ? value : '')
}

function shapeRoleTokens(shape: DeviceProfileQualityInputShape): string[] {
  return [shape.semanticRole, shape.sourcePartKind, shape.semanticGroup, shape.name]
    .map(roleKey)
    .filter(Boolean)
}

function profileRoleTokens(profile: DeviceProfileDefinition, role: string): string[] {
  return [role, ...(profile.roleAliases?.[role] ?? [])].map(roleKey).filter(Boolean)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function shapeExtents(shape: DeviceProfileQualityInputShape): [number, number, number] {
  const radius = positiveNumber(shape.radius) ?? positiveNumber(shape.radiusTop) ?? 0
  const diameter = radius > 0 ? radius * 2 : undefined
  const length = positiveNumber(shape.length) ?? diameter ?? positiveNumber(shape.thickness) ?? 0.05
  const width =
    positiveNumber(shape.width) ??
    positiveNumber(shape.depth) ??
    diameter ??
    positiveNumber(shape.thickness) ??
    0.05
  const height = positiveNumber(shape.height) ?? diameter ?? positiveNumber(shape.thickness) ?? 0.05
  return [length, width, height]
}

function profileShapeBounds(shapes: readonly DeviceProfileQualityInputShape[]) {
  if (shapes.length === 0) return undefined
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  for (const shape of shapes) {
    const [x = 0, y = 0, z = 0] = Array.isArray(shape.position) ? shape.position : []
    const [length, width, height] = shapeExtents(shape)
    const half: [number, number, number] = [length / 2, height / 2, width / 2]
    const center: [number, number, number] = [x, y, z]
    min[0] = Math.min(min[0], center[0] - half[0])
    min[1] = Math.min(min[1], center[1] - half[1])
    min[2] = Math.min(min[2], center[2] - half[2])
    max[0] = Math.max(max[0], center[0] + half[0])
    max[1] = Math.max(max[1], center[1] + half[1])
    max[2] = Math.max(max[2], center[2] + half[2])
  }
  const size: [number, number, number] = [
    Math.max(0, max[0] - min[0]),
    Math.max(0, max[1] - min[1]),
    Math.max(0, max[2] - min[2]),
  ]
  return { min, max, size }
}

function dimensionMatchScore(actual: number | undefined, expected: number | undefined) {
  if (!actual || !expected || actual <= 0 || expected <= 0) return 0.75
  const ratio = actual > expected ? actual / expected : expected / actual
  return clamp01(1 - Math.max(0, ratio - 1) / 2)
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function qualityRulesObject(
  profile: DeviceProfileDefinition,
): DeviceProfileQualityRules | undefined {
  return isRecord(profile.qualityRules)
    ? (profile.qualityRules as unknown as DeviceProfileQualityRules)
    : undefined
}

function uniqueStrings(values: readonly unknown[]) {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.trim() !== ''),
    ),
  )
}

function rangeContains(value: number, range: DeviceProfileRangeRule | undefined) {
  if (!range) return true
  if (typeof range.min === 'number' && value < range.min) return false
  if (typeof range.max === 'number' && value > range.max) return false
  return true
}

function rangeScore(value: number, range: DeviceProfileRangeRule | undefined) {
  if (!range || rangeContains(value, range)) return 1
  const min = optionalPositiveNumber(range.min)
  const max = optionalPositiveNumber(range.max)
  const target = min && value < min ? min : max && value > max ? max : value
  if (!target || target <= 0) return 0.5
  const ratio = value > target ? value / target : target / value
  return clamp01(1 - Math.max(0, ratio - 1))
}

export function evaluateDeviceProfileQuality(
  profile: DeviceProfileDefinition,
  shapes: readonly DeviceProfileQualityInputShape[],
  options: { visualScore?: number; maxShapes?: number } = {},
): DeviceProfileQualityScore {
  const issues: string[] = []
  const warnings: string[] = []
  const qualityRules = qualityRulesObject(profile)
  const shapeTokens = shapes.flatMap(shapeRoleTokens)
  const hasToken = (role: string) =>
    profileRoleTokens(profile, role).some((token) => shapeTokens.includes(token))
  const requiredRoles = uniqueStrings([
    ...profile.parts.filter((part) => part.required).map((part) => part.semanticRole),
    ...(qualityRules?.requiredRoles ?? []),
  ])
  const requiredCoverage =
    requiredRoles.length === 0
      ? 1
      : requiredRoles.filter((role) => hasToken(role)).length / requiredRoles.length
  const primaryPresent = hasToken(profile.primarySemanticRole)
  const forbiddenHits = uniqueStrings([
    ...(profile.forbiddenRoles ?? []),
    ...(qualityRules?.forbiddenRoles ?? []),
  ]).filter((role) => hasToken(role))
  if (!primaryPresent) issues.push(`Primary role "${profile.primarySemanticRole}" is missing.`)
  if (requiredCoverage < 1) warnings.push('Not all required profile roles are represented.')
  if (forbiddenHits.length > 0) {
    issues.push(`Forbidden roles appeared: ${forbiddenHits.join(', ')}.`)
  }
  const shapeCountMin = optionalPositiveNumber(qualityRules?.shapeCount?.min)
  const shapeCountMax =
    options.maxShapes ??
    optionalPositiveNumber(qualityRules?.shapeCount?.max) ??
    optionalPositiveNumber(profile.detailBudget?.maxShapes) ??
    96
  if (shapeCountMin && shapes.length < shapeCountMin) {
    warnings.push(`Shape count ${shapes.length} is below profile minimum ${shapeCountMin}.`)
  }
  if (shapeCountMax && shapes.length > shapeCountMax) {
    issues.push(`Shape count ${shapes.length} exceeds profile maximum ${shapeCountMax}.`)
  }

  const semanticScore = clamp01(
    (primaryPresent ? 0.45 : 0) + requiredCoverage * 0.45 + (forbiddenHits.length === 0 ? 0.1 : 0),
  )
  const bounds = profileShapeBounds(shapes)
  const defaults = profile.defaultDimensions ?? {}
  const dimensionScore = bounds
    ? (dimensionMatchScore(bounds.size[0], defaults.length) +
        dimensionMatchScore(bounds.size[2], defaults.width) +
        dimensionMatchScore(bounds.size[1], defaults.height)) /
      3
    : 0
  const shapeCountScore =
    shapes.length === 0
      ? 0
      : shapeCountMin && shapes.length < shapeCountMin
        ? shapes.length / shapeCountMin
        : shapes.length > shapeCountMax
          ? shapeCountMax / shapes.length
          : 1
  const ratioRule = qualityRules?.dimensionExpectations?.lengthToDiameterRatio
  const lengthToDiameterRatio =
    bounds && Math.min(bounds.size[1], bounds.size[2]) > 0
      ? bounds.size[0] / Math.min(bounds.size[1], bounds.size[2])
      : undefined
  if (
    typeof lengthToDiameterRatio === 'number' &&
    ratioRule &&
    !rangeContains(lengthToDiameterRatio, ratioRule)
  ) {
    warnings.push(
      `Length-to-diameter ratio ${lengthToDiameterRatio.toFixed(2)} is outside profile expectation.`,
    )
  }
  const ratioExpectationScore =
    typeof lengthToDiameterRatio === 'number' && ratioRule
      ? rangeScore(lengthToDiameterRatio, ratioRule)
      : 1
  const geometryScore = clamp01(
    dimensionScore * 0.45 + shapeCountScore * 0.35 + ratioExpectationScore * 0.2,
  )
  const editableShapes = shapes.filter(
    (shape) => shape.sourcePartKind || shape.semanticRole || shape.semanticGroup,
  ).length
  const editabilityScore = shapes.length > 0 ? editableShapes / shapes.length : 0
  const visualCompletenessScore = clamp01(
    semanticScore * 0.4 + shapeCountScore * 0.25 + (options.visualScore ?? 0.75) * 0.35,
  )
  const overallScore = clamp01(
    semanticScore * 0.35 +
      geometryScore * 0.25 +
      editabilityScore * 0.2 +
      visualCompletenessScore * 0.2,
  )

  return {
    semanticScore,
    geometryScore,
    editabilityScore,
    visualCompletenessScore,
    overallScore,
    warnings,
    issues,
    metrics: {
      shapeCount: shapes.length,
      requiredCoverage,
      primaryPresent: primaryPresent ? 1 : 0,
      forbiddenRoleCount: forbiddenHits.length,
      dimensionScore,
      shapeCountScore,
      ...(bounds
        ? {
            boundsLength: bounds.size[0],
            boundsWidth: bounds.size[2],
            boundsHeight: bounds.size[1],
          }
        : {}),
      ...(typeof lengthToDiameterRatio === 'number'
        ? {
            lengthToDiameterRatio,
            ratioExpectationScore,
          }
        : {}),
    },
  }
}

export function validateDeviceProfiles(
  profiles: readonly DeviceProfileDefinition[] = DEVICE_PROFILE_DEFINITIONS,
): DeviceProfileValidation {
  const issues: string[] = []
  const warnings: string[] = []
  for (const profile of profiles) {
    const result = validateDeviceProfileDefinition(profile)
    issues.push(...result.issues)
    warnings.push(...result.warnings)
  }
  return { ok: issues.length === 0, issues, warnings }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function dimensionDefaults(value: unknown): DimensionDefaults | undefined {
  if (!isRecord(value)) return undefined
  const dimensions: DimensionDefaults = {}
  for (const key of ['length', 'width', 'height', 'diameter'] as const) {
    const raw = value[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) dimensions[key] = raw
  }
  return Object.keys(dimensions).length > 0 ? dimensions : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, raw]) =>
    typeof raw === 'string' && raw.trim() ? [[key, raw.trim()] as const] : [],
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function ruleRef(value: unknown): DeviceProfileRuleRef | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (isRecord(value)) return value
  return undefined
}

function detailLevel(value: unknown): DeviceProfileDetailLevel | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function profilePartDetailBudget(value: unknown): DeviceProfilePartDetailBudget | undefined {
  if (!isRecord(value)) return undefined
  const budget: DeviceProfilePartDetailBudget = {
    ...(detailLevel(value.detailLevel) ? { detailLevel: detailLevel(value.detailLevel) } : {}),
    ...(optionalNonNegativeInteger(value.count) != null
      ? { count: optionalNonNegativeInteger(value.count) }
      : {}),
    ...(optionalNonNegativeInteger(value.ringCount) != null
      ? { ringCount: optionalNonNegativeInteger(value.ringCount) }
      : {}),
    ...(optionalNonNegativeInteger(value.spokeCount) != null
      ? { spokeCount: optionalNonNegativeInteger(value.spokeCount) }
      : {}),
    ...(optionalNonNegativeInteger(value.slatCount) != null
      ? { slatCount: optionalNonNegativeInteger(value.slatCount) }
      : {}),
    ...(optionalNonNegativeInteger(value.rungCount) != null
      ? { rungCount: optionalNonNegativeInteger(value.rungCount) }
      : {}),
    ...(optionalNonNegativeInteger(value.boltCount) != null
      ? { boltCount: optionalNonNegativeInteger(value.boltCount) }
      : {}),
    ...(optionalNonNegativeInteger(value.radialSegments) != null
      ? { radialSegments: optionalNonNegativeInteger(value.radialSegments) }
      : {}),
    ...(optionalNonNegativeInteger(value.levelCount) != null
      ? { levelCount: optionalNonNegativeInteger(value.levelCount) }
      : {}),
  }
  return Object.keys(budget).length > 0 ? budget : undefined
}

function profileDetailBudget(value: unknown): DeviceProfileDetailBudget | undefined {
  if (!isRecord(value)) return undefined
  const parts = isRecord(value.parts)
    ? Object.fromEntries(
        Object.entries(value.parts).flatMap(([key, raw]) => {
          const budget = profilePartDetailBudget(raw)
          return budget ? [[key, budget] as const] : []
        }),
      )
    : undefined
  const budget: DeviceProfileDetailBudget = {
    ...(detailLevel(value.detailLevel) ? { detailLevel: detailLevel(value.detailLevel) } : {}),
    ...(optionalNonNegativeInteger(value.maxShapes) != null
      ? { maxShapes: optionalNonNegativeInteger(value.maxShapes) }
      : {}),
    ...(parts && Object.keys(parts).length > 0 ? { parts } : {}),
  }
  return Object.keys(budget).length > 0 ? budget : undefined
}

function editableOverrides(
  value: unknown,
): Record<string, Partial<EditablePropertyDefinition>> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, raw]) =>
    isRecord(raw) ? [[key, raw as Partial<EditablePropertyDefinition>] as const] : [],
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function sourcePack(value: unknown): DeviceProfileSourcePack | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined
  const version =
    typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined
  if (!id || !version) return undefined
  return {
    id,
    version,
    ...(typeof value.industry === 'string' && value.industry.trim()
      ? { industry: value.industry.trim() }
      : {}),
  }
}

function profileOverrides(value: unknown): DeviceProfileOverrideInfo[] | undefined {
  if (!Array.isArray(value)) return undefined
  const overrides = value.filter(isRecord).flatMap((entry) => {
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : undefined
    const name =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : (id ?? undefined)
    const source: DeviceProfileSource | undefined =
      entry.source === 'builtin' ||
      entry.source === 'workspace' ||
      entry.source === 'imported_pack' ||
      entry.source === 'generated_candidate'
        ? entry.source
        : undefined
    if (!id || !name || !source) return []
    return [
      {
        id,
        name,
        source,
        ...(sourcePack(entry.sourcePack) ? { sourcePack: sourcePack(entry.sourcePack) } : {}),
      },
    ]
  })
  return overrides.length > 0 ? overrides : undefined
}

function profileParts(value: unknown): ProfilePartSpec[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).flatMap((part) => {
    const kind = typeof part.kind === 'string' ? part.kind : undefined
    const semanticRole = typeof part.semanticRole === 'string' ? part.semanticRole : undefined
    if (!kind || !semanticRole) return []
    return [{ ...part, kind, semanticRole } as ProfilePartSpec]
  })
}

function detailBudgetForPart(
  budget: DeviceProfileDetailBudget | undefined,
  part: ProfilePartSpec,
): DeviceProfilePartDetailBudget | undefined {
  const entries = budget?.parts ? Object.entries(budget.parts) : []
  const keys = [part.id, part.semanticRole, part.kind]
    .filter(Boolean)
    .map((key) => normalizeKey(key))
  const matched = entries.find(([key]) => keys.includes(normalizeKey(key)))?.[1]
  if (matched) return matched
  return budget?.detailLevel ? { detailLevel: budget.detailLevel } : undefined
}

function applyDeviceProfileDetailBudget(
  parts: readonly ProfilePartSpec[],
  budget: DeviceProfileDetailBudget | undefined,
): ProfilePartSpec[] {
  if (!budget) return [...parts]
  return parts.map((part) => {
    const partBudget = detailBudgetForPart(budget, part)
    if (!partBudget) return part
    return {
      ...part,
      ...(partBudget.detailLevel ? { detailLevel: partBudget.detailLevel } : {}),
      ...(partBudget.count != null ? { count: partBudget.count } : {}),
      ...(partBudget.ringCount != null ? { ringCount: partBudget.ringCount } : {}),
      ...(partBudget.spokeCount != null ? { spokeCount: partBudget.spokeCount } : {}),
      ...(partBudget.slatCount != null ? { slatCount: partBudget.slatCount } : {}),
      ...(partBudget.rungCount != null ? { rungCount: partBudget.rungCount } : {}),
      ...(partBudget.boltCount != null ? { boltCount: partBudget.boltCount } : {}),
      ...(partBudget.radialSegments != null ? { radialSegments: partBudget.radialSegments } : {}),
      ...(partBudget.levelCount != null ? { levelCount: partBudget.levelCount } : {}),
    }
  })
}

export function normalizeDeviceProfileInput(
  value: Record<string, unknown>,
  source: DeviceProfileSource = 'workspace',
  status: DeviceProfileStatus = 'stable',
): DeviceProfileDefinition {
  const family =
    typeof value.family === 'string' && value.family.trim() ? value.family.trim() : 'generic'
  const layoutFamily =
    typeof value.layoutFamily === 'string'
      ? normalizeLayoutFamilyId(value.layoutFamily)
      : normalizeLayoutFamilyId(family)
  const inferredArchetype = layoutFamily
    ? archetypeForLayoutFamily(layoutFamily)
    : 'enclosed_machine'
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : draftProfileId(String(value.name ?? value.deviceType ?? 'device'))
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : id.replace(/[_-]+/g, ' ')
  const parts = profileParts(value.parts)
  const primarySemanticRole =
    typeof value.primarySemanticRole === 'string' && value.primarySemanticRole.trim()
      ? value.primarySemanticRole.trim()
      : (parts.find((part) => part.required)?.semanticRole ?? parts[0]?.semanticRole ?? 'main_body')
  return {
    id,
    name,
    aliases: stringArray(value.aliases),
    ...(typeof value.industry === 'string' && value.industry.trim()
      ? { industry: value.industry.trim() }
      : {}),
    ...(layoutFamily ? { layoutFamily } : {}),
    ...(typeof value.layoutTemplate === 'string' && value.layoutTemplate.trim()
      ? { layoutTemplate: value.layoutTemplate.trim() }
      : {}),
    archetypeFamily:
      typeof value.archetypeFamily === 'string'
        ? (value.archetypeFamily as DeviceArchetypeFamily)
        : inferredArchetype,
    family,
    ...(dimensionDefaults(value.defaultDimensions)
      ? { defaultDimensions: dimensionDefaults(value.defaultDimensions) }
      : {}),
    parts,
    primarySemanticRole,
    dimensionRules: Array.isArray(value.dimensionRules)
      ? (value.dimensionRules.filter(isRecord) as unknown as DimensionRule[])
      : undefined,
    ...(stringRecord(value.partPresets) ? { partPresets: stringRecord(value.partPresets) } : {}),
    ...(isRecord(value.resolvedPartPresets)
      ? {
          resolvedPartPresets: value.resolvedPartPresets as Record<string, Record<string, unknown>>,
        }
      : {}),
    ...(ruleRef(value.proportionRules) ? { proportionRules: ruleRef(value.proportionRules) } : {}),
    ...(ruleRef(value.qualityRules) ? { qualityRules: ruleRef(value.qualityRules) } : {}),
    ...(profileDetailBudget(value.detailBudget)
      ? { detailBudget: profileDetailBudget(value.detailBudget) }
      : {}),
    visualCues: stringArray(value.visualCues),
    layoutHints: isRecord(value.layoutHints) ? value.layoutHints : undefined,
    roleAliases: isRecord(value.roleAliases)
      ? Object.fromEntries(
          Object.entries(value.roleAliases).flatMap(([role, aliases]) => {
            const normalizedAliases = stringArray(aliases)
            return normalizedAliases.length > 0 ? [[role, normalizedAliases]] : []
          }),
        )
      : undefined,
    ...(typeof value.editableSchemaRef === 'string' && value.editableSchemaRef.trim()
      ? { editableSchemaRef: value.editableSchemaRef.trim() }
      : {}),
    ...(editableOverrides(value.editableOverrides)
      ? { editableOverrides: editableOverrides(value.editableOverrides) }
      : {}),
    ...(normalizeEditableSchemaInput(value.resolvedEditableSchema)
      ? { resolvedEditableSchema: normalizeEditableSchemaInput(value.resolvedEditableSchema) }
      : {}),
    status:
      value.status === 'runtime_draft' ||
      value.status === 'candidate' ||
      value.status === 'pending_review' ||
      value.status === 'stable' ||
      value.status === 'draft'
        ? value.status
        : status,
    source:
      value.source === 'generated'
        ? 'generated_candidate'
        : value.source === 'builtin' ||
            value.source === 'workspace' ||
            value.source === 'imported_pack' ||
            value.source === 'generated_candidate'
          ? value.source
          : source,
    ...(sourcePack(value.sourcePack) ? { sourcePack: sourcePack(value.sourcePack) } : {}),
    ...(profileOverrides(value.overrides) ? { overrides: profileOverrides(value.overrides) } : {}),
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : `Device profile for ${name}.`,
    forbiddenRoles: stringArray(value.forbiddenRoles),
  }
}

export function applyDeviceProfileToPartInput(
  profile: DeviceProfileDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const dimensions = profile.defaultDimensions ?? {}
  const explicitParts = Array.isArray(input.parts) ? input.parts.filter(isRecord) : []
  const parts = applyDeviceProfileDetailBudget(
    [...explicitParts, ...profile.parts] as ProfilePartSpec[],
    profile.detailBudget,
  )
  return {
    ...input,
    family: profile.family,
    deviceProfile: profile.id,
    layoutFamily: profile.layoutFamily ?? normalizeLayoutFamilyId(profile.family),
    layoutTemplate: profile.layoutTemplate,
    archetypeFamily: profile.archetypeFamily,
    profileIndustry: profile.industry,
    profileSource: profile.source,
    profileSourcePack: profile.sourcePack,
    profilePackId: profile.sourcePack?.id,
    profilePackVersion: profile.sourcePack?.version,
    profileOverrides: profile.overrides,
    overrodeBuiltin: profile.overrides?.some((entry) => entry.source === 'builtin') === true,
    primarySemanticRole: profile.primarySemanticRole,
    partPresets: profile.partPresets,
    resolvedPartPresets: profile.resolvedPartPresets,
    proportionRules: profile.proportionRules,
    qualityRules: profile.qualityRules,
    detailBudget: profile.detailBudget,
    visualCues: profile.visualCues,
    layoutHints: profile.layoutHints,
    roleAliases: profile.roleAliases,
    editableSchemaRef: profile.editableSchemaRef,
    editableOverrides: profile.editableOverrides,
    resolvedEditableSchema: profile.resolvedEditableSchema,
    length: input.length ?? dimensions.length,
    width: input.width ?? input.depth ?? input.diameter ?? dimensions.width ?? dimensions.diameter,
    height: input.height ?? dimensions.height,
    parts,
  }
}

export function deviceProfileCapabilitySummary(
  profiles: readonly DeviceProfileDefinition[] = DEVICE_PROFILE_DEFINITIONS,
): string {
  return (profiles as readonly DeviceProfileDefinition[])
    .map(
      (profile) =>
        `${profile.id}: status=${profile.status} source=${profile.source}${profile.sourcePack ? ` pack=${profile.sourcePack.id}@${profile.sourcePack.version}` : ''} layoutFamily=${profile.layoutFamily ?? normalizeLayoutFamilyId(profile.family) ?? 'unknown'}${profile.layoutTemplate ? ` layoutTemplate=${profile.layoutTemplate}` : ''} family=${profile.family} primary=${profile.primarySemanticRole} aliases=${profile.aliases.join('|')} parts=${profile.parts
          .map((part) => `${part.kind}:${part.semanticRole ?? part.kind}`)
          .join(', ')}`,
    )
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
