import { CATALOG_ITEMS, searchCatalogItems } from '@pascal-app/core/lib/asset-catalog'
import type { AssetInput } from '@pascal-app/core/schema'

type CatalogSummaryOptions = {
  query?: string
  maxItems?: number
}

const FACTORY_RELEVANT_TAGS = new Set([
  'factory',
  'industrial',
  'equipment',
  'electrical',
  'pipe',
  'storage',
  'floor',
  'safety',
])

function itemTags(item: AssetInput) {
  return Array.isArray(item.tags) ? item.tags : []
}

function scoreCatalogItem(item: AssetInput, queryTerms: string[]) {
  const text = [item.id, item.name, item.category, ...itemTags(item)].join(' ').toLowerCase()
  let score = 0
  for (const term of queryTerms) {
    if (text.includes(term)) score += 5
  }
  if (itemTags(item).some((tag) => FACTORY_RELEVANT_TAGS.has(tag.toLowerCase()))) score += 2
  if (item.category === 'equipment') score += 1
  return score
}

function catalogLine(item: AssetInput) {
  const tags = itemTags(item).slice(0, 6).join(',')
  const dimensions = Array.isArray(item.dimensions) ? ` dims=${item.dimensions.join('x')}m` : ''
  const attachTo = typeof item.attachTo === 'string' ? ` attach=${item.attachTo}` : ''
  return `- id:${item.id} | name:${item.name} | category:${item.category} | tags:${tags}${dimensions}${attachTo}`
}

export function buildFactoryCatalogSummary(options: CatalogSummaryOptions = {}) {
  const maxItems = Math.max(10, Math.min(options.maxItems ?? 60, 120))
  const queryTerms = (options.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const queryMatches = options.query ? searchCatalogItems({ query: options.query }) : []
  const factoryItems = CATALOG_ITEMS.filter((item) =>
    itemTags(item).some((tag) => FACTORY_RELEVANT_TAGS.has(tag.toLowerCase())),
  )
  const ranked = [...queryMatches, ...factoryItems, ...CATALOG_ITEMS]
    .filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .sort((a, b) => scoreCatalogItem(b, queryTerms) - scoreCatalogItem(a, queryTerms))
    .slice(0, maxItems)

  const categories = new Map<string, number>()
  for (const item of CATALOG_ITEMS) {
    categories.set(item.category, (categories.get(item.category) ?? 0) + 1)
  }

  return [
    `Catalog size: ${CATALOG_ITEMS.length} placeable items.`,
    `Categories: ${[...categories.entries()].map(([category, count]) => `${category}:${count}`).join(', ')}.`,
    'Relevant placeable item ids available to the factory agent:',
    ...ranked.map(catalogLine),
  ].join('\n')
}

export function buildFactoryAgentSystemPrompt(options: CatalogSummaryOptions = {}) {
  return [
    '===== FACTORY AGENT SYSTEM PROMPT =====',
    'You are the Pascal factory creation and modification agent.',
    'Your job is to turn user language into a factory/room/layout plan and a reviewable scene patch plan.',
    '',
    '===== DECISION ORDER =====',
    '1. If the user asks for a process workshop or production process (for example water electrolysis / hydrogen generation), return a process_line plan with stations and connections. Do not collapse it to a plain factory shell.',
    '2. If the user asks for a room, house, workshop shell, walls, doors, windows, floors, zones, aisles, or layout dimensions, use scene/layout operations. Do NOT ask geometry generation to model a whole room or house.',
    '3. If the user asks for a concrete item/equipment and a matching catalog item exists, use the catalog item id and place_item semantics. Prefer exact id/name/tag matches.',
    '4. For process-line stations, prefer native parametric nodes first (box, tank, pipe, pipe-fitting, cable-tray), and call primitive geometry only for missing core equipment. Avoid catalog GLB assets inside automatic process-line station resolution.',
    '5. If neither native nodes nor geometry can safely satisfy the request, return missingAssets with the missing name and reason.',
    '',
    '===== SCENE / MCP LAYOUT CAPABILITIES =====',
    '- Project/scene: create_project, save_scene, validate_scene, verify_scene, get_scene.',
    '- Architectural layout: create_story_shell, create_room, create_wall, create_level, duplicate_level.',
    '- Openings and building elements: add_door, add_window, create_stair_between_levels, create_roof, cut_opening.',
    '- Items and bulk graph edits: search_assets, place_item, apply_patch.',
    '- Use these for buildings, rooms, factory shells, zones, walls, doors, windows, slabs, ceilings, and placement of known catalog assets.',
    '- Process-line layout: compose station zones, station placements, connection routes, and metadata-rich create patches.',
    '- Native industrial nodes available for factory composition: box, tank, pipe, pipe-fitting, cable-tray.',
    '',
    '===== CATALOG ITEMS PROVIDED BY SYSTEM =====',
    buildFactoryCatalogSummary(options),
    '',
    '===== GEOMETRY GENERATION CAPABILITIES =====',
    '- Geometry tools can create editable generated equipment from primitives, parts, recipes, or assemblies.',
    '- Available routes: compose_recipe, compose_assembly, compose_parts, compose_robot_arm, compose_primitive, revise_geometry.',
    '- Good geometry-generation targets: conveyor, pump, fan, tank, compressor, heat exchanger, machine tool, robot arm, electrical/control cabinet, pipe system, valve, custom industrial device, custom long-tail equipment.',
    '- For missing core equipment, call the geometry generation service after native-node lookup fails.',
    '- For reaction kettles/reactors/stirred tanks/pressure vessels (反应釜/反应器/搅拌罐/压力容器), prefer compose_assembly with family:"reactor" instead of hand-written compose_parts; the reactor assembly template supplies reactor_vessel_shell, heads, agitator, ports, and support base.',
    '- Good reusable generated parts include: conveyor_frame, roller_array, belt_surface, ribbed_motor_body, volute_casing, inlet_port, outlet_port, flange_ring, electrical_cabinet, cable_tray, pipe_run, pipe_elbow, valve_body, cylindrical_tank, platform_ladder, heat_exchanger, agitator_tank, pipe_rack.',
    '- Geometry generation outputs GeneratedGeometryArtifact only; factory agent must convert that artifact to patches and decide placement.',
    '- Do not use geometry generation for whole houses, rooms, factory shells, walls, floors, doors, windows, or layout rectangles. Use scene/MCP layout operations for those.',
    '',
    '===== OUTPUT EXPECTATIONS =====',
    '- Prefer explicit ids: catalogItemId for catalog items, artifactId for generated geometry, nodeIds for created patch nodes.',
    '- Keep a missingAssets list whenever a requested equipment item cannot be resolved.',
    '- For production lines, resolve each station in order: native node first, generated geometry second, placeholder/missingAsset last.',
  ].join('\n')
}

export function buildFactoryGeometryRequestPrompt(input: {
  userRequest: string
  equipmentName?: string
  lineRole?: string
  desiredDimensions?: Record<string, unknown>
}) {
  const desiredDimensions = input.desiredDimensions
    ? JSON.stringify(input.desiredDimensions)
    : undefined
  return [
    buildFactoryAgentSystemPrompt({ query: input.userRequest }),
    '',
    '===== CURRENT GEOMETRY REQUEST =====',
    'The factory agent is considering geometry generation for a missing/custom equipment item.',
    input.equipmentName ? `Equipment: ${input.equipmentName}` : undefined,
    input.lineRole ? `Factory line role: ${input.lineRole}` : undefined,
    desiredDimensions ? `Desired dimensions: ${desiredDimensions}` : undefined,
    `User request: ${input.userRequest.trim()}`,
    /反应釜|反应器|搅拌罐|压力容器|reactor|stirred tank|pressure vessel/i.test(input.userRequest)
      ? 'Route hint: call compose_assembly with family:"reactor" for this reactor equipment; do not use compose_parts unless compose_assembly explicitly fails as unsupported.'
      : undefined,
    '',
    'If this request is actually architectural/layout work rather than equipment, do not invent a whole building as primitive geometry; explain through missingAssets/plan that layout tools are required.',
  ]
    .filter(Boolean)
    .join('\n')
}
