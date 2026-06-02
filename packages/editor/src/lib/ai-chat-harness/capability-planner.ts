export type GeometryCapabilityRoute =
  | 'parametric_gear'
  | 'vehicle_recipe_v2'
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

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

export function planGeometryCapabilities(userRequest: string): GeometryCapabilityPlan {
  const text = userRequest.toLowerCase()

  if (includesAny(text, ['gear', 'spur gear', '齿轮', '直齿'])) {
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

  if (includesAny(text, ['car', 'sedan', 'suv', 'truck', 'vehicle', '汽车', '小汽车', '轿车'])) {
    return {
      intent: 'vehicle',
      requiredCapabilities: ['body_shell', 'four_wheels', 'cabin', 'windows', 'lights', 'bumpers'],
      availableCapabilities: ['compose_recipe:vehicle.*', 'compose_parts:vehicle_body'],
      missingCapabilities: [],
      route: 'vehicle_recipe_v2',
      recommendation:
        'Use compose_recipe vehicle.* for cars so the deterministic vehicle v2 recipe creates body, cabin, windows, wheels, lights, bumpers, and high-detail shaping.',
    }
  }

  return {
    intent: 'general geometry',
    requiredCapabilities: [],
    availableCapabilities: [
      'compose_recipe',
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
