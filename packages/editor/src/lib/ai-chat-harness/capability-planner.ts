import { inferAssemblyFamily } from '@pascal-app/core/lib/assembly-constraints'
import {
  findIndustrialArchetype,
  type IndustrialArchetypeEntry,
} from '@pascal-app/core/lib/industrial-archetype-registry'

export type GeometryCapabilityRoute =
  | 'parametric_gear'
  | 'assembly'
  | 'mixer_parts'
  | 'recipe'
  | 'primitive'
  | 'revision_or_new'

export type GeometryCapabilityPlan = {
  intent: string
  requiredCapabilities: string[]
  availableCapabilities: string[]
  missingCapabilities: string[]
  route: GeometryCapabilityRoute
  recommendation: string
}

export const OPEN_ASSEMBLY_FAMILIES = new Set([
  'vehicle',
  'outdoor_ac',
  'fan',
  'pump',
  'conveyor',
  'machine_tool',
  'tank',
  'distillation_tower',
  'reactor',
  'compressor',
  'grate_cooler',
  'electrical',
])

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term))
}

function includesWord(text: string, term: string) {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
}

function includesAnyWord(text: string, terms: readonly string[]) {
  return terms.some((term) => includesWord(text, term))
}

function normalizedCapabilityRecipeId(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_-]+/g, '.')
        .toLowerCase()
    : ''
}

export function isOpenAssemblyFamily(family: unknown): family is string {
  return typeof family === 'string' && OPEN_ASSEMBLY_FAMILIES.has(family)
}

export function isOpenAssemblyRecipeId(value: unknown): boolean {
  const recipeId = normalizedCapabilityRecipeId(value)
  return (
    recipeId.startsWith('vehicle.') ||
    recipeId === 'appliance.airconditioneroutdoorunit' ||
    recipeId === 'fan.industrial' ||
    recipeId.startsWith('machinetool.') ||
    recipeId.startsWith('forming.') ||
    recipeId.startsWith('materialhandling.') ||
    recipeId.startsWith('fluidmachine.') ||
    recipeId.startsWith('process.')
  )
}

function isOpenAssemblyIndustrialArchetype(entry: IndustrialArchetypeEntry): boolean {
  return isOpenAssemblyRecipeId(entry.recipeId) || entry.archetypeId === 'packaging.inline_machine'
}

export function isOpenAssemblyCapabilityRequest(
  args: Record<string, unknown>,
  prompt: string,
): boolean {
  if (isOpenAssemblyRecipeId(args.recipeId ?? args.recipe ?? args.id ?? args.objectType)) {
    return true
  }
  return isOpenAssemblyFamily(inferAssemblyFamily(prompt, args))
}

function hasGearRecipeIntent(text: string) {
  if (includesAny(text, ['spur gear', 'toothed gear', '\u9f7f\u8f6e', '\u76f4\u9f7f'])) {
    return true
  }
  if (!includesWord(text, 'gear')) return false
  return !(
    /\b(shift|change|switch)\s+gears\b/i.test(text) ||
    /\bgear\s+(pump|box|reducer|motor|train|drive)\b/i.test(text) ||
    /\b(gearbox|gearmotor)\b/i.test(text)
  )
}

function hasFlangeRecipeIntent(text: string) {
  return includesAny(text, [
    'pipe flange',
    'standard flange',
    'ansi flange',
    'weld neck flange',
    '\u6cd5\u5170',
    '\u7ba1\u6cd5\u5170',
  ])
}

function hasHexBoltRecipeIntent(text: string) {
  if (includesAny(text, ['hex bolt', 'hex head bolt', '\u516d\u89d2\u87ba\u6813'])) return true
  return includesWord(text, 'bolt') && !includesAnyWord(text, ['pattern', 'circle', 'holes'])
}

function hasSprocketRecipeIntent(text: string) {
  return includesAny(text, ['chain sprocket', 'roller chain sprocket', 'sprocket', '\u94fe\u8f6e'])
}

function hasPipeElbowRecipeIntent(text: string) {
  return includesAny(text, [
    '90 degree elbow',
    'pipe elbow',
    'elbow fitting',
    '90 elbow',
    '\u5f2f\u5934',
  ])
}

function hasPillowBlockBearingRecipeIntent(text: string) {
  return includesAny(text, [
    'pillow block bearing',
    'plummer block bearing',
    'mounted bearing',
    'bearing block',
    '\u8f74\u627f\u5ea7',
    '\u5e26\u5ea7\u8f74\u627f',
  ])
}

function hasFlexibleCouplingRecipeIntent(text: string) {
  return includesAny(text, [
    'flexible coupling',
    'jaw coupling',
    'shaft coupling',
    'motor coupling',
    '\u8054\u8f74\u5668',
    '\u5f39\u6027\u8054\u8f74\u5668',
  ])
}

function hasPerforatedPlateRecipeIntent(text: string) {
  return includesAny(text, [
    'perforated plate',
    'sieve plate',
    'screen plate',
    'filter plate',
    '\u5b54\u677f',
    '\u7b5b\u677f',
  ])
}

function hasMixerPartsIntent(text: string) {
  if (
    includesAny(text, [
      'impeller',
      'agitator',
      'mixing paddle',
      'mud mixer',
      '\u6ce5\u6d46\u6405\u62cc',
      '\u6405\u62cc\u90e8\u4ef6',
      '\u6405\u62cc\u53f6\u7247',
      '\u53f6\u8f6e',
    ])
  ) {
    return true
  }

  return (
    includesWord(text, 'mixer') &&
    (includesAnyWord(text, ['component', 'blade', 'shaft', 'rod', 'paddle', 'impeller']) ||
      /\bmixing\s+(blade|shaft|rod|paddle|component)\b/i.test(text))
  )
}

function hasAircraftIntent(text: string) {
  return /aircraft|airplane|airliner|plane|jet|boeing|airbus|fuselage|\u98de\u673a|\u5ba2\u673a|\u6ce2\u97f3|\u7a7a\u5ba2/.test(
    text,
  )
}

export function planGeometryCapabilities(userRequest: string): GeometryCapabilityPlan {
  const text = userRequest.toLowerCase()

  if (hasGearRecipeIntent(text)) {
    return {
      intent: 'spur gear',
      requiredCapabilities: ['tooth_profile', 'bore_hole', 'keyway_cutout', 'metric_dimensions'],
      availableCapabilities: ['compose_recipe:gear.spur', 'extrude.profile', 'extrude.holes'],
      missingCapabilities: [],
      route: 'parametric_gear',
      recommendation:
        'Use compose_recipe with recipeId:"gear.spur" for toothed spur gears. Do not hand-author gear profile points unless the recipe cannot express the request.',
    }
  }

  if (hasFlangeRecipeIntent(text)) {
    return {
      intent: 'pipe flange',
      requiredCapabilities: ['annular_body', 'central_bore', 'bolt_circle', 'raised_face'],
      availableCapabilities: ['compose_recipe:pipe.flange'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"pipe.flange" for standard flanges. Preserve nominalDiameter, outerDiameter, thickness, boltCircleDiameter, and boltCount when provided.',
    }
  }

  if (hasHexBoltRecipeIntent(text)) {
    return {
      intent: 'hex bolt',
      requiredCapabilities: ['cylindrical_shank', 'hex_head', 'thread_crests'],
      availableCapabilities: ['compose_recipe:fastener.hexBolt'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"fastener.hexBolt" for standard hex-head bolts. Preserve nominalDiameter, shankLength, threadLength, and head dimensions when provided.',
    }
  }

  if (hasSprocketRecipeIntent(text)) {
    return {
      intent: 'roller chain sprocket',
      requiredCapabilities: ['tooth_profile', 'central_bore', 'hub'],
      availableCapabilities: ['compose_recipe:sprocket.chain'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"sprocket.chain" for roller-chain sprockets. Preserve teeth, pitch/module, boreDiameter, outerDiameter, and thickness when provided.',
    }
  }

  if (hasPipeElbowRecipeIntent(text)) {
    return {
      intent: 'pipe elbow fitting',
      requiredCapabilities: ['elbow_arc', 'nominal_diameter', 'bend_radius', 'end_collars'],
      availableCapabilities: ['compose_recipe:pipe.elbow90'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"pipe.elbow90" for standard pipe elbows. Preserve nominalDiameter, bendRadius, wall thickness, and angle when provided.',
    }
  }

  if (hasPillowBlockBearingRecipeIntent(text)) {
    return {
      intent: 'pillow block bearing',
      requiredCapabilities: ['base_foot', 'bearing_housing', 'shaft_bore', 'mounting_holes'],
      availableCapabilities: ['compose_recipe:bearing.pillowBlock'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"bearing.pillowBlock" for mounted bearing blocks. Preserve shaftDiameter, length, width, and boltSpacing when provided.',
    }
  }

  if (hasFlexibleCouplingRecipeIntent(text)) {
    return {
      intent: 'flexible shaft coupling',
      requiredCapabilities: ['two_hubs', 'shaft_bores', 'elastomer_spider', 'set_screws'],
      availableCapabilities: ['compose_recipe:coupling.flexible'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"coupling.flexible" for jaw/flexible shaft couplings. Preserve shaftDiameter, outerDiameter, length, and jawCount when provided.',
    }
  }

  if (hasPerforatedPlateRecipeIntent(text)) {
    return {
      intent: 'perforated plate',
      requiredCapabilities: ['plate_body', 'regular_hole_grid', 'hole_diameter'],
      availableCapabilities: ['compose_recipe:plate.perforated'],
      missingCapabilities: [],
      route: 'recipe',
      recommendation:
        'Use compose_recipe with recipeId:"plate.perforated" for sieve/perforated plates. Preserve length, width, thickness, rows, columns, and holeDiameter when provided.',
    }
  }

  if (
    includesAnyWord(text, ['car', 'sedan', 'suv', 'truck', 'vehicle']) ||
    includesAny(text, ['\u6c7d\u8f66', '\u5c0f\u6c7d\u8f66', '\u8f7f\u8f66'])
  ) {
    return {
      intent: 'vehicle',
      requiredCapabilities: ['body_shell', 'four_wheels', 'cabin', 'windows', 'lights', 'bumpers'],
      availableCapabilities: [
        'compose_assembly:vehicle',
        'generic_parts:vehicle_body/wheels/windows/lights',
      ],
      missingCapabilities: [],
      route: 'assembly',
      recommendation:
        'Use compose_assembly with family:"vehicle" and copy hard user constraints such as length, width, height, and primaryColor. Do not use vehicle.* recipes as the main path.',
    }
  }

  if (hasAircraftIntent(text)) {
    return {
      intent: 'aircraft',
      requiredCapabilities: [
        'aircraft_fuselage',
        'aircraft_wing',
        'aircraft_tail',
        'aircraft_engine',
        'aircraft_landing_gear',
        'aircraft_windows',
        'hard_length',
      ],
      availableCapabilities: ['compose_parts:aircraft_fuselage'],
      missingCapabilities: [],
      route: 'primitive',
      recommendation:
        'Use compose_parts with parts:[{kind:"aircraft_fuselage", id:"aircraft_fuselage"}] and pass top-level length/primaryColor. Let the aircraft defaults add wings, engines, T-tail, windows, and landing gear. Do not hand-place generic airfoil_blade or wheel_set parts for complete aircraft.',
    }
  }

  if (
    includesAny(text, [
      'reactor',
      'reaction kettle',
      'reaction vessel',
      '\u53cd\u5e94\u91dc',
      '\u53cd\u61c9\u91dc',
      '\u53cd\u5e94\u5668',
      '\u53cd\u61c9\u5668',
    ])
  ) {
    return {
      intent: 'reactor',
      requiredCapabilities: ['vertical_vessel_shell', 'agitator', 'process_ports', 'support_base'],
      availableCapabilities: ['compose_assembly:reactor'],
      missingCapabilities: [],
      route: 'assembly',
      recommendation:
        'Use compose_assembly with family:"reactor"; build a vertical vessel skeleton with agitator motor/shaft/blades and process nozzles.',
    }
  }

  if (
    includesAny(text, [
      'grate cooler',
      'clinker cooler',
      '\u7be6\u51b7\u673a',
      '\u7be6\u51b7\u6a5f',
    ])
  ) {
    return {
      intent: 'grate cooler',
      requiredCapabilities: [
        'cooler_housing',
        'grate_bed',
        'cooling_air_boxes',
        'inlet_outlet_chutes',
      ],
      availableCapabilities: ['compose_assembly:grate_cooler'],
      missingCapabilities: [],
      route: 'assembly',
      recommendation:
        'Use compose_assembly with family:"grate_cooler"; build a long cooler housing, inclined grate bed, cooling air boxes, chutes, and drive unit.',
    }
  }

  if (/(chimney|smoke[_\s-]?stack|\u70df\u56f1)/i.test(text)) {
    return {
      intent: 'industrial chimney',
      requiredCapabilities: ['tapered_chimney_body', 'base_plinth', 'top_rim', 'warning_bands'],
      availableCapabilities: ['compose_parts:chimney_stack'],
      missingCapabilities: [],
      route: 'primitive',
      recommendation:
        'Use compose_parts with parts:[{kind:"chimney_stack", semanticRole:"chimney_body", height, radius, warningStripes:true when red-white bands are requested}]. Do not use vertical_pole/circular_base/cylinder or compose_assembly family:"tower"; only distillation/chemical towers are assembly-supported.',
    }
  }

  if (
    includesAny(text, [
      'distillation tower',
      'distillation column',
      'fractionator',
      'rectification tower',
      '\u84b8\u998f\u5854',
      '\u84b8\u992e\u5854',
      '\u7cbe\u998f\u5854',
      '\u7cbe\u992e\u5854',
      '\u5854\u5668',
    ])
  ) {
    return {
      intent: 'distillation tower',
      requiredCapabilities: [
        'vertical_column_shell',
        'tray_levels',
        'process_nozzles',
        'access_platforms',
        'ladder',
        'hard_dimensions',
      ],
      availableCapabilities: ['compose_assembly:distillation_tower'],
      missingCapabilities: [],
      route: 'assembly',
      recommendation:
        'Use compose_assembly with family:"distillation_tower"; map user diameter to diameter/width and height to a vertical Y-axis column, not a horizontal tank.',
    }
  }

  if (hasMixerPartsIntent(text)) {
    return {
      intent: 'mixer impeller',
      requiredCapabilities: [
        'vertical_shaft',
        'radial_flat_blades',
        'blade_tilt',
        'hub_connection',
      ],
      availableCapabilities: ['compose_parts:propeller_blade_set'],
      missingCapabilities: [],
      route: 'mixer_parts',
      recommendation:
        'Use compose_parts with vertical_pole, circular_base, and propeller_blade_set for mud mixer / agitator / impeller requests. Do not create/use a whole-object recipe for shaft + hub + blades; let the part kernel compute blade placement and orientation.',
    }
  }

  const industrial = findIndustrialArchetype(userRequest)
  if (industrial) {
    const mappedFamily =
      isOpenAssemblyFamily(inferAssemblyFamily(userRequest)) ||
      isOpenAssemblyIndustrialArchetype(industrial)
    if (mappedFamily) {
      return {
        intent: industrial.label,
        requiredCapabilities: [
          'generic_functional_parts',
          'hard_constraints',
          'assembly_validation',
        ],
        availableCapabilities: ['compose_assembly', 'generic_part_taxonomy'],
        missingCapabilities: [],
        route: 'assembly',
        recommendation: `Use compose_assembly for ${industrial.label}. Treat archetype "${industrial.archetype}"${industrial.variant ? ` with variant "${industrial.variant}"` : ''} as semantic planning context, not a whole-object recipe.`,
      }
    }
    return {
      intent: industrial.label,
      requiredCapabilities: ['generic_functional_parts', 'semantic_parts'],
      availableCapabilities: ['compose_parts', 'generic_part_taxonomy'],
      missingCapabilities: [],
      route: 'primitive',
      recommendation: `compose_assembly does not have a built-in template for ${industrial.label} (archetype "${industrial.archetype}"${industrial.variant ? `, variant "${industrial.variant}"` : ''}). Use compose_parts with an explicit parts array: describe the main body, base frame, rotating or functional elements, ports/connections, and control box. Use alignAbove/centeredOn/connectTo relationship fields for positioning instead of raw coordinates.`,
    }
  }

  return {
    intent: 'general geometry',
    requiredCapabilities: [],
    availableCapabilities: [
      'compose_recipe',
      'compose_assembly',
      'compose_parts',
      'compose_primitive',
      'revise_geometry',
    ],
    missingCapabilities: [],
    route: 'revision_or_new',
    recommendation:
      'Use the latest artifact for follow-up edits; otherwise choose the most specific recipe/parts tool before raw primitives.',
  }
}
