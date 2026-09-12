export const OPENAI_REQUIRED_TOOL_HINTS = [
  'readOnlyHint',
  'destructiveHint',
  'openWorldHint',
] as const

type OpenAiToolHint = (typeof OPENAI_REQUIRED_TOOL_HINTS)[number]
type ToolAnnotations = Record<OpenAiToolHint, boolean>

const policy = (
  readOnlyHint: boolean,
  destructiveHint: boolean,
  openWorldHint: boolean,
): ToolAnnotations => ({ readOnlyHint, destructiveHint, openWorldHint })

export const EXPECTED_OPENAI_TOOL_ANNOTATIONS = {
  add_door: policy(false, false, false),
  add_window: policy(false, false, false),
  analyze_floorplan_image: policy(true, false, true),
  analyze_room_photo: policy(true, false, true),
  apply_patch: policy(false, true, false),
  check_collisions: policy(true, false, false),
  create_from_template: policy(false, true, false),
  create_house_from_brief: policy(false, true, false),
  create_level: policy(false, false, false),
  create_project: policy(false, false, false),
  create_roof: policy(false, false, false),
  create_room: policy(false, false, false),
  create_stair_between_levels: policy(false, true, false),
  create_story_shell: policy(false, false, false),
  create_wall: policy(false, false, false),
  cut_opening: policy(false, false, false),
  delete_node: policy(false, true, false),
  delete_scene: policy(false, true, false),
  describe_node: policy(true, false, false),
  duplicate_level: policy(false, false, false),
  export_glb: policy(true, false, false),
  export_json: policy(true, false, false),
  find_nodes: policy(true, false, false),
  furnish_room: policy(false, false, false),
  generate_variants: policy(false, false, false),
  get_level_summary: policy(true, false, false),
  get_node: policy(true, false, false),
  get_project_status: policy(false, true, false),
  get_scene: policy(true, false, false),
  get_walls: policy(true, false, false),
  get_zones: policy(true, false, false),
  list_levels: policy(true, false, false),
  list_scenes: policy(true, false, false),
  list_templates: policy(true, false, false),
  load_scene: policy(false, true, false),
  measure: policy(true, false, false),
  photo_to_scene: policy(false, true, true),
  place_item: policy(false, false, false),
  redo: policy(false, true, false),
  rename_scene: policy(false, true, false),
  save_scene: policy(false, true, false),
  search_assets: policy(true, false, false),
  set_zone: policy(false, false, false),
  undo: policy(false, true, false),
  validate_scene: policy(true, false, false),
  verify_scene: policy(true, false, false),
} as const satisfies Record<string, ToolAnnotations>

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted()
  const sortedExpected = [...expected].toSorted()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

export function validateOpenAiToolAnnotationPacket(value: unknown): string[] {
  const failures: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['OpenAI tool annotation packet must be an object']
  }

  const packet = value as Record<string, unknown>
  if (!exactKeys(packet, ['schema_version', 'required_hints', 'tools'])) {
    failures.push(
      'OpenAI tool annotation packet must contain only schema_version, required_hints, and tools',
    )
  }
  if (packet.schema_version !== 1)
    failures.push('OpenAI tool annotation packet schema_version must be 1')
  if (
    !Array.isArray(packet.required_hints) ||
    packet.required_hints.length !== OPENAI_REQUIRED_TOOL_HINTS.length ||
    packet.required_hints.some((hint, index) => hint !== OPENAI_REQUIRED_TOOL_HINTS[index])
  ) {
    failures.push(
      `OpenAI tool annotation packet required_hints must be exactly ${OPENAI_REQUIRED_TOOL_HINTS.join(', ')}`,
    )
  }
  if (!Array.isArray(packet.tools)) {
    failures.push('OpenAI tool annotation packet tools must be an array')
    return failures
  }

  const expectedNames = Object.keys(EXPECTED_OPENAI_TOOL_ANNOTATIONS).toSorted()
  const names: string[] = []
  for (const [index, rawTool] of packet.tools.entries()) {
    if (!rawTool || typeof rawTool !== 'object' || Array.isArray(rawTool)) {
      failures.push(`OpenAI tool annotation entry ${index} must be an object`)
      continue
    }
    const tool = rawTool as Record<string, unknown>
    if (!exactKeys(tool, ['name', 'annotations', 'justifications'])) {
      failures.push(
        `OpenAI tool annotation entry ${index} must contain only name, annotations, and justifications`,
      )
    }
    if (typeof tool.name !== 'string' || !tool.name) {
      failures.push(`OpenAI tool annotation entry ${index} needs a non-empty name`)
      continue
    }
    names.push(tool.name)
    const expected =
      EXPECTED_OPENAI_TOOL_ANNOTATIONS[tool.name as keyof typeof EXPECTED_OPENAI_TOOL_ANNOTATIONS]
    if (!expected) {
      failures.push(`OpenAI tool annotation packet contains unexpected tool ${tool.name}`)
      continue
    }
    if (
      !tool.annotations ||
      typeof tool.annotations !== 'object' ||
      Array.isArray(tool.annotations)
    ) {
      failures.push(`OpenAI tool annotation packet ${tool.name} annotations must be an object`)
    } else {
      const annotations = tool.annotations as Record<string, unknown>
      if (!exactKeys(annotations, OPENAI_REQUIRED_TOOL_HINTS)) {
        failures.push(
          `OpenAI tool annotation packet ${tool.name} annotations must contain exactly the required hints`,
        )
      }
      for (const hint of OPENAI_REQUIRED_TOOL_HINTS) {
        if (annotations[hint] !== expected[hint]) {
          failures.push(
            `OpenAI tool annotation packet ${tool.name} has ${hint}=${String(annotations[hint])}, expected ${String(expected[hint])}`,
          )
        }
      }
    }
    if (
      !tool.justifications ||
      typeof tool.justifications !== 'object' ||
      Array.isArray(tool.justifications)
    ) {
      failures.push(`OpenAI tool annotation packet ${tool.name} justifications must be an object`)
    } else {
      const justifications = tool.justifications as Record<string, unknown>
      if (!exactKeys(justifications, OPENAI_REQUIRED_TOOL_HINTS)) {
        failures.push(
          `OpenAI tool annotation packet ${tool.name} justifications must contain exactly the required hints`,
        )
      }
      for (const hint of OPENAI_REQUIRED_TOOL_HINTS) {
        const justification = justifications[hint]
        if (typeof justification !== 'string' || !justification.trim()) {
          failures.push(
            `OpenAI tool annotation packet ${tool.name} needs a non-empty ${hint} justification`,
          )
        } else if (justification !== justification.trim()) {
          failures.push(
            `OpenAI tool annotation packet ${tool.name} ${hint} justification must not have surrounding whitespace`,
          )
        }
      }
    }
  }

  const sortedNames = [...names].toSorted()
  if (new Set(names).size !== names.length)
    failures.push('OpenAI tool annotation packet tool names must be unique')
  if (names.some((name, index) => name !== sortedNames[index])) {
    failures.push('OpenAI tool annotation packet tools must be sorted by name')
  }
  if (
    sortedNames.length !== expectedNames.length ||
    sortedNames.some((name, index) => name !== expectedNames[index])
  ) {
    failures.push(
      `OpenAI tool annotation packet must contain the exact ${expectedNames.length}-tool inventory`,
    )
  }

  return failures
}
