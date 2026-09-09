import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillNames = ['pascal-3d', 'furniture-fit'] as const
const skillVersions = { 'pascal-3d': '0.1.0', 'furniture-fit': '0.1.3' } as const
const pluginVersion = '0.1.6'
const portablePluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const openAiListingLimits = {
  displayName: 30,
  shortDescription: 30,
  longDescription: 4000,
  developerName: 80,
} as const
const openAiDefaultPromptLimit = 128
const openAiCapabilityLimit = 20
const openAiCapabilityLengthLimit = 120
const openAiListingUrlLimit = 1024
const openAiImageByteLimit = 5 * 1024 * 1024
const openAiCategories = new Set([
  'Productivity',
  'Creativity',
  'Developer Tools',
  'Business & Operations',
  'Data & Analytics',
  'Communication',
  'Education & Research',
  'Security',
  'Finance',
  'Healthcare',
  'Travel',
  'Entertainment',
  'Other',
])
const furnitureNextActionKinds = [
  'request_measurement',
  'check_alternate_pose',
  'request_alternate_item_or_target',
  'complete_unresolved_check',
  'check_related_item_or_pose',
] as const
type FurnitureNextActionKind = (typeof furnitureNextActionKinds)[number]
const furnitureNextActionAuthority =
  'authority: Read-only; no account or workspace changes, publication, save, or project mutation authorized.'
const furnitureNextActionCost =
  'cost: No rendering, generation, paid operation, or additional spending authorized.'
const failures: string[] = []

function fail(message: string) {
  failures.push(message)
}

function read(path: string): string {
  if (!existsSync(path)) {
    fail(`Missing file: ${relative(root, path)}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function hasSupportedText(value: string, allowNewlines = false): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (allowNewlines && (codePoint === 10 || codePoint === 13)) continue
    if (
      codePoint <= 31 ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff
    ) {
      return false
    }
  }
  return true
}

function validateHttpsUrl(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value || value.length > maxLength || !hasSupportedText(value)) {
    fail(`${label} must be supported single-line text no longer than ${maxLength} characters`)
    return
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      fail(`${label} must be an HTTPS URL with a host and no embedded credentials`)
    }
  } catch {
    fail(`${label} must be a valid HTTPS URL`)
  }
}

function validateOpenAiSvg(path: string, label: string) {
  const size = statSync(path).size
  if (size > openAiImageByteLimit) fail(`${label} must not exceed 5 MiB`)
  if (extname(path).toLowerCase() !== '.svg') {
    fail(`${label} must be an SVG so this validator can verify its XML and dimensions`)
    return
  }
  const content = read(path)
  const xmlResult = XMLValidator.validate(content)
  if (xmlResult !== true) {
    fail(`${label} must contain well-formed UTF-8 XML`)
    return
  }
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(
    content,
  ) as { svg?: Record<string, unknown> }
  if (!parsed.svg) {
    fail(`${label} XML root element must be <svg>`)
    return
  }
  const svg = parsed.svg
  let width: number | undefined
  let height: number | undefined
  if (typeof svg['@_viewBox'] === 'string') {
    const values = svg['@_viewBox'].trim().split(/[ ,]+/u).map(Number)
    if (values.length === 4 && values.every(Number.isFinite)) {
      width = values[2]
      height = values[3]
    }
  }
  if (width === undefined || height === undefined) {
    if (typeof svg['@_width'] === 'number' && typeof svg['@_height'] === 'number') {
      width = svg['@_width']
      height = svg['@_height']
    }
  }
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 48 ||
    height < 48 ||
    width !== height
  ) {
    fail(`${label} must declare square numeric SVG dimensions of at least 48 by 48`)
  }
}

function parseJson(path: string): Record<string, unknown> {
  const content = read(path)
  if (!content) return {}
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch (error) {
    fail(`Invalid JSON in ${relative(root, path)}: ${String(error)}`)
    return {}
  }
}

function frontmatter(content: string, path: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    fail(`Missing YAML frontmatter in ${relative(root, path)}`)
    return {}
  }
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const entry = line.match(/^([a-z][a-z-]*):\s*(.*)$/)
    if (entry) fields[entry[1]!] = entry[2]!.replace(/^['"]|['"]$/g, '')
  }
  return fields
}

function validateLinks(content: string, path: string) {
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]!
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const file = resolve(dirname(path), target.split('#')[0]!)
    if (!existsSync(file)) fail(`Broken link in ${relative(root, path)}: ${target}`)
  }
}

function walk(path: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (lstatSync(full).isSymbolicLink()) {
      fail(`Skill bundles must be standalone, found symlink: ${relative(root, full)}`)
    } else if (entry.isDirectory()) {
      files.push(...walk(full))
    } else {
      files.push(full)
    }
  }
  return files
}

for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  if (entry.isDirectory() && !skillNames.includes(entry.name as (typeof skillNames)[number])) {
    fail(`OpenAI skills directory contains an unexpected non-skill directory: ${entry.name}`)
  }
}

for (const skillName of skillNames) {
  const skillRoot = join(root, 'skills', skillName)
  const skillFile = join(skillRoot, 'SKILL.md')
  const content = read(skillFile)
  const fields = frontmatter(content, skillFile)
  if (fields.name !== skillName) fail(`${skillName}: frontmatter name does not match directory`)
  if (!fields.description) fail(`${skillName}: description is required`)
  if (!content.includes(`version: "${skillVersions[skillName]}"`))
    fail(`${skillName}: metadata version must be ${skillVersions[skillName]}`)
  if (!/^ {2}source-reviewed: "\d{4}-\d{2}-\d{2}"$/m.test(content)) {
    fail(`${skillName}: an ISO source review date is required`)
  }
  if (!/^ {2}native-host-validation: "[a-z0-9-]+"$/m.test(content)) {
    fail(`${skillName}: native host validation state must be explicit`)
  }
  if (/^license:/m.test(content)) {
    fail(`${skillName}: per-skill license metadata conflicts with ClawHub's MIT-0 release contract`)
  }
  for (const requiredOpenClawMetadata of [
    '  openclaw:',
    '    homepage: https://editor.pascal.app/docs/developers/mcp',
    '    primaryEnv: PASCAL_API_KEY',
    '      - name: PASCAL_API_KEY',
    '        required: false',
  ]) {
    if (!content.includes(requiredOpenClawMetadata)) {
      fail(`${skillName}: missing OpenClaw metadata: ${requiredOpenClawMetadata.trim()}`)
    }
  }
  if (content.includes('last-verified:'))
    fail(`${skillName}: last-verified overstates the current validation state`)
  if (content.split('\n').length > 500) fail(`${skillName}: SKILL.md exceeds 500 lines`)

  const evalFile = join(skillRoot, 'evals', 'evals.json')
  const evals = parseJson(evalFile) as {
    skill_name?: string
    evals?: Array<Record<string, unknown>>
  }
  if (evals.skill_name !== skillName) fail(`${skillName}: eval skill_name mismatch`)
  if (!Array.isArray(evals.evals) || evals.evals.length < 3)
    fail(`${skillName}: needs at least 3 evals`)
  const ids = new Set<number>()
  for (const item of evals.evals ?? []) {
    if (typeof item.id !== 'number' || ids.has(item.id))
      fail(`${skillName}: eval ids must be unique numbers`)
    if (typeof item.id === 'number') ids.add(item.id)
    if (typeof item.prompt !== 'string' || !item.prompt)
      fail(`${skillName}: every eval needs a prompt`)
    if (!Array.isArray(item.expectations) || item.expectations.length === 0) {
      fail(`${skillName}: every eval needs expectations`)
    }
  }

  const triggerFile = join(skillRoot, 'evals', 'trigger-evals.json')
  const triggerEvals = parseJson(triggerFile) as {
    skill_name?: string
    evals?: Array<{ query?: unknown; should_trigger?: unknown }>
  }
  if (triggerEvals.skill_name !== skillName) fail(`${skillName}: trigger eval skill_name mismatch`)
  const triggers = triggerEvals.evals ?? []
  if (!Array.isArray(triggerEvals.evals) || triggers.length < 8) {
    fail(`${skillName}: needs at least 8 trigger evals`)
  }
  let positiveTriggers = 0
  let negativeTriggers = 0
  for (const item of triggers) {
    if (typeof item.query !== 'string' || !item.query)
      fail(`${skillName}: every trigger eval needs a query`)
    if (item.should_trigger === true) positiveTriggers++
    else if (item.should_trigger === false) negativeTriggers++
    else fail(`${skillName}: every trigger eval needs a boolean should_trigger`)
  }
  if (positiveTriggers < 5) fail(`${skillName}: needs at least 5 positive trigger evals`)
  if (negativeTriggers < 3) fail(`${skillName}: needs at least 3 negative trigger evals`)

  for (const path of walk(skillRoot)) {
    const data = read(path)
    if (path.endsWith('.md')) validateLinks(data, path)
    if (path.endsWith('.md')) {
      for (const match of data.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1]!
        if (/^(?:https?:|mailto:|#)/.test(target)) continue
        const resolvedTarget = resolve(dirname(path), target.split('#')[0]!)
        if (!resolvedTarget.startsWith(`${skillRoot}/`)) {
          fail(`${relative(root, path)} links outside its standalone skill bundle: ${target}`)
        }
      }
    }
    for (const forbidden of ['/Users/', 'worktrees/', '../plans/']) {
      if (data.includes(forbidden))
        fail(`${relative(root, path)} leaks private path text: ${forbidden}`)
    }
    if (/sk_(?:live|test)_[A-Za-z0-9]{8,}/.test(data)) {
      fail(`${relative(root, path)} contains a credential-shaped value`)
    }
  }
}

const furnitureSkill = read(join(root, 'skills', 'furniture-fit', 'SKILL.md'))
const furnitureReport = read(
  join(root, 'skills', 'furniture-fit', 'references', 'report-template.md'),
)
for (const kind of furnitureNextActionKinds) {
  if (!(furnitureSkill.includes(kind) && furnitureReport.includes(kind))) {
    fail(`furniture-fit: missing nextAction kind ${kind}`)
  }
}
for (const field of ['requiredInput:', 'context:']) {
  if (!furnitureReport.includes(field)) {
    fail(`furniture-fit report template is missing nextAction field ${field}`)
  }
}
for (const [label, content] of [
  ['skill', furnitureSkill],
  ['report template', furnitureReport],
] as const) {
  if (!content.includes(furnitureNextActionAuthority)) {
    fail(`furniture-fit ${label} is missing the canonical nextAction authority boundary`)
  }
  if (!content.includes(furnitureNextActionCost)) {
    fail(`furniture-fit ${label} is missing the canonical nextAction cost boundary`)
  }
}
const furnitureExamplesRoot = join(root, 'skills', 'furniture-fit', 'examples')
for (const entry of readdirSync(furnitureExamplesRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue
  const example = read(join(furnitureExamplesRoot, entry.name))
  if (!example.includes('nextAction:')) {
    fail(`furniture-fit example ${entry.name} is missing nextAction`)
  }
  if (!example.includes(`  ${furnitureNextActionAuthority}`)) {
    fail(`furniture-fit example ${entry.name} is missing the canonical authority boundary`)
  }
  if (!example.includes(`  ${furnitureNextActionCost}`)) {
    fail(`furniture-fit example ${entry.name} is missing the canonical cost boundary`)
  }
}

type FurnitureDecisionContext = {
  has_passing_footprint?: unknown
  has_failing_requested_pose?: unknown
  has_blocking_failure?: unknown
  missing_blocking_measurement?: unknown
  supported_unchecked_alternative?: unknown
  unresolved_requested_check_due_to_tool_limit?: unknown
}

const furnitureDecisionContextKeys = [
  'has_passing_footprint',
  'has_failing_requested_pose',
  'has_blocking_failure',
  'missing_blocking_measurement',
  'supported_unchecked_alternative',
  'unresolved_requested_check_due_to_tool_limit',
] as const
type RequiredFurnitureDecisionContext = Record<
  (typeof furnitureDecisionContextKeys)[number],
  boolean
>

function deriveFurnitureNextAction(context: FurnitureDecisionContext): FurnitureNextActionKind {
  if (context.missing_blocking_measurement === true) return 'request_measurement'
  if (context.has_blocking_failure === true) {
    return context.supported_unchecked_alternative === true
      ? 'check_alternate_pose'
      : 'request_alternate_item_or_target'
  }
  if (context.unresolved_requested_check_due_to_tool_limit === true) {
    return 'complete_unresolved_check'
  }
  return 'check_related_item_or_pose'
}

const furnitureEvalData = parseJson(
  join(root, 'skills', 'furniture-fit', 'evals', 'evals.json'),
) as {
  evals?: Array<{
    id?: unknown
    semantic_case?: unknown
    decision_context?: FurnitureDecisionContext
    expected_next_action?: {
      kind?: unknown
      target?: unknown
      must_not?: unknown
    }
  }>
}
const semanticDecisionCases = new Map<string, NonNullable<typeof furnitureEvalData.evals>[number]>()
for (const item of furnitureEvalData.evals ?? []) {
  if (typeof item.semantic_case !== 'string') continue
  if (semanticDecisionCases.has(item.semantic_case)) {
    fail(`furniture-fit: duplicate semantic nextAction case ${item.semantic_case}`)
  }
  semanticDecisionCases.set(item.semantic_case, item)
}
const requiredSemanticCases = new Map<
  string,
  {
    evalId: number
    kind: FurnitureNextActionKind
    context: RequiredFurnitureDecisionContext
  }
>([
  [
    'no-unresolved-requested-blocker',
    {
      evalId: 1,
      kind: 'check_related_item_or_pose',
      context: {
        has_passing_footprint: true,
        has_failing_requested_pose: false,
        has_blocking_failure: false,
        missing_blocking_measurement: false,
        supported_unchecked_alternative: false,
        unresolved_requested_check_due_to_tool_limit: false,
      },
    },
  ],
  [
    'mixed-passing-and-failing-poses-height-blocker',
    {
      evalId: 2,
      kind: 'request_measurement',
      context: {
        has_passing_footprint: true,
        has_failing_requested_pose: true,
        has_blocking_failure: false,
        missing_blocking_measurement: true,
        supported_unchecked_alternative: false,
        unresolved_requested_check_due_to_tool_limit: false,
      },
    },
  ],
  [
    'mixed-evidence-height-blocker',
    {
      evalId: 9,
      kind: 'request_measurement',
      context: {
        has_passing_footprint: true,
        has_failing_requested_pose: false,
        has_blocking_failure: false,
        missing_blocking_measurement: true,
        supported_unchecked_alternative: false,
        unresolved_requested_check_due_to_tool_limit: false,
      },
    },
  ],
  [
    'all-tested-poses-fail',
    {
      evalId: 10,
      kind: 'request_alternate_item_or_target',
      context: {
        has_passing_footprint: false,
        has_failing_requested_pose: true,
        has_blocking_failure: true,
        missing_blocking_measurement: false,
        supported_unchecked_alternative: false,
        unresolved_requested_check_due_to_tool_limit: false,
      },
    },
  ],
  [
    'prospective-candidate-door-limit',
    {
      evalId: 11,
      kind: 'complete_unresolved_check',
      context: {
        has_passing_footprint: true,
        has_failing_requested_pose: false,
        has_blocking_failure: false,
        missing_blocking_measurement: false,
        supported_unchecked_alternative: false,
        unresolved_requested_check_due_to_tool_limit: true,
      },
    },
  ],
  [
    'supported-untested-alternate',
    {
      evalId: 12,
      kind: 'check_alternate_pose',
      context: {
        has_passing_footprint: false,
        has_failing_requested_pose: true,
        has_blocking_failure: true,
        missing_blocking_measurement: false,
        supported_unchecked_alternative: true,
        unresolved_requested_check_due_to_tool_limit: false,
      },
    },
  ],
])
for (const [semanticCase, requirement] of requiredSemanticCases) {
  const item = semanticDecisionCases.get(semanticCase)
  if (!item?.decision_context) {
    fail(`furniture-fit: missing semantic nextAction case ${semanticCase}`)
    continue
  }
  if (item.id !== requirement.evalId) {
    fail(`furniture-fit: semantic case ${semanticCase} must be eval ${requirement.evalId}`)
  }
  const contextKeys = Object.keys(item.decision_context).sort()
  const expectedKeys = [...furnitureDecisionContextKeys].sort()
  if (
    contextKeys.length !== expectedKeys.length ||
    contextKeys.some((key, index) => key !== expectedKeys[index]) ||
    furnitureDecisionContextKeys.some((key) => typeof item.decision_context?.[key] !== 'boolean')
  ) {
    fail(`furniture-fit: semantic case ${semanticCase} needs the complete boolean decision context`)
  }
  for (const key of furnitureDecisionContextKeys) {
    if (item.decision_context[key] !== requirement.context[key]) {
      fail(
        `furniture-fit: semantic case ${semanticCase} has ${key}=${String(item.decision_context[key])}, expected ${String(requirement.context[key])}`,
      )
    }
  }
  if (
    item.decision_context.supported_unchecked_alternative === true &&
    item.decision_context.has_blocking_failure !== true
  ) {
    fail(`furniture-fit: semantic case ${semanticCase} cannot offer an alternate without a failure`)
  }
  if (
    item.decision_context.has_passing_footprint !== true &&
    item.decision_context.has_blocking_failure !== true &&
    item.decision_context.missing_blocking_measurement !== true &&
    item.decision_context.unresolved_requested_check_due_to_tool_limit !== true
  ) {
    fail(`furniture-fit: semantic case ${semanticCase} has no result or blocker`)
  }
  const expected = item.expected_next_action
  if (
    !expected ||
    !furnitureNextActionKinds.includes(expected.kind as FurnitureNextActionKind) ||
    typeof expected.target !== 'string' ||
    !expected.target ||
    !Array.isArray(expected.must_not) ||
    expected.must_not.length === 0 ||
    expected.must_not.some((value) => typeof value !== 'string' || !value)
  ) {
    fail(`furniture-fit: semantic case ${semanticCase} has an invalid expected_next_action`)
    continue
  }
  const derived = deriveFurnitureNextAction(item.decision_context)
  if (derived !== expected.kind || expected.kind !== requirement.kind) {
    fail(
      `furniture-fit: semantic case ${semanticCase} derives ${derived}, expected ${requirement.kind}`,
    )
  }
}

const publishingFile = join(root, 'plugin-evals', 'publishing-cases.json')
const publishing = parseJson(publishingFile) as {
  submission_route?: unknown
  status?: unknown
  blockers?: unknown
  cases?: Array<{
    id?: unknown
    skill?: unknown
    kind?: unknown
    prompt?: unknown
    expected?: unknown
    expected_result_shape?: unknown
    required_fixture?: unknown
    why_not?: unknown
    reproducibility_status?: unknown
    reproducibility_blocker?: unknown
  }>
}
if (publishing.submission_route !== 'with_mcp') {
  fail('Publishing suite must use the OpenAI With MCP submission route')
}
if (publishing.status !== 'blocked') {
  fail('Publishing suite must remain blocked until hosted MCP review prerequisites pass')
}
if (
  !Array.isArray(publishing.blockers) ||
  publishing.blockers.length === 0 ||
  publishing.blockers.some((value) => typeof value !== 'string' || !value)
) {
  fail('Publishing suite must name its current hosted MCP review blockers')
}
const publishingCases = publishing.cases ?? []
let positivePublishingCases = 0
let negativePublishingCases = 0
const publishingIds = new Set<string>()
for (const item of publishingCases) {
  if (typeof item.id !== 'string' || !item.id || publishingIds.has(item.id)) {
    fail('Publishing case ids must be unique non-empty strings')
  } else {
    publishingIds.add(item.id)
  }
  if (!skillNames.includes(item.skill as (typeof skillNames)[number])) {
    fail(`Publishing case ${String(item.id)} has an unknown skill`)
  }
  if (item.kind === 'positive') {
    positivePublishingCases++
    if (typeof item.expected_result_shape !== 'string' || !item.expected_result_shape) {
      fail(`Positive publishing case ${String(item.id)} needs an expected result shape`)
    }
    if (typeof item.required_fixture !== 'string' || !item.required_fixture) {
      fail(`Positive publishing case ${String(item.id)} needs a reproducible fixture`)
    }
    if (
      item.reproducibility_status !== 'blocked' ||
      typeof item.reproducibility_blocker !== 'string' ||
      !item.reproducibility_blocker
    ) {
      fail(
        `Positive publishing case ${String(item.id)} must remain explicitly blocked until its hosted reviewer fixture exists`,
      )
    }
  } else if (item.kind === 'negative') {
    negativePublishingCases++
    if (typeof item.why_not !== 'string' || !item.why_not) {
      fail(`Negative publishing case ${String(item.id)} needs a reason not to complete the action`)
    }
  } else fail(`Publishing case ${String(item.id)} needs kind positive or negative`)
  if (item.reproducibility_status !== 'blocked') {
    fail(`Publishing case ${String(item.id)} must declare reproducibility_status blocked`)
  }
  if (typeof item.prompt !== 'string' || !item.prompt)
    fail(`Publishing case ${String(item.id)} needs a prompt`)
  if (typeof item.expected !== 'string' || !item.expected) {
    fail(`Publishing case ${String(item.id)} needs an expected result`)
  }
}
if (positivePublishingCases < 5) fail('Publishing suite needs at least 5 positive cases')
if (negativePublishingCases < 3) fail('Publishing suite needs at least 3 negative cases')

const claudePlugin = parseJson(join(root, '.claude-plugin', 'plugin.json'))
const claudeMarketplace = parseJson(join(root, '.claude-plugin', 'marketplace.json'))
const portablePlugin = parseJson(join(root, 'plugin.json'))
const codexPlugin = parseJson(join(root, '.codex-plugin', 'plugin.json'))
const codexMarketplace = parseJson(join(root, '.agents', 'plugins', 'marketplace.json'))

for (const [label, manifest] of [
  ['Claude plugin', claudePlugin],
  ['Codex plugin', codexPlugin],
] as const) {
  if (manifest.name !== 'pascal-agent-skills') fail(`${label}: unexpected name`)
  if (manifest.version !== pluginVersion) fail(`${label}: version must be ${pluginVersion}`)
  if (typeof manifest.version !== 'string' || !semverPattern.test(manifest.version)) {
    fail(`${label}: version must use semantic versioning`)
  }
}

if (portablePlugin.$schema !== portablePluginSchema) {
  fail(`Portable plugin must declare ${portablePluginSchema}`)
}
if (portablePlugin.name !== codexPlugin.name) fail('Portable and Codex plugin names must match')
if (portablePlugin.version !== pluginVersion) {
  fail(`Portable plugin version must be ${pluginVersion}`)
}
if (typeof portablePlugin.version !== 'string' || !semverPattern.test(portablePlugin.version)) {
  fail('Portable plugin version must use semantic versioning')
}
if (
  typeof portablePlugin.name !== 'string' ||
  portablePlugin.name.length > 64 ||
  !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(portablePlugin.name)
) {
  fail('Portable plugin name must meet OpenAI final-directory name requirements')
}
if (
  typeof portablePlugin.description !== 'string' ||
  !portablePlugin.description ||
  portablePlugin.description.length > 1024 ||
  !hasSupportedText(portablePlugin.description, true)
) {
  fail('Portable plugin description must use supported text and be at most 1024 characters')
}
const portableAuthor = portablePlugin.author as Record<string, unknown> | undefined
if (
  typeof portableAuthor?.name !== 'string' ||
  !portableAuthor.name ||
  portableAuthor.name.length > 120 ||
  !hasSupportedText(portableAuthor.name)
) {
  fail('Portable plugin author name must use supported single-line text of at most 120 characters')
}
validateHttpsUrl(portableAuthor?.url, 'Portable plugin author URL', 2048)
validateHttpsUrl(portablePlugin.homepage, 'Portable plugin homepage', 2048)
if (portablePlugin.description !== codexPlugin.description) {
  fail('Portable and Codex plugin descriptions must match')
}
const extensions = portablePlugin.extensions as Record<string, unknown> | undefined
const openAiExtension = extensions?.['com.openai'] as Record<string, unknown> | undefined
const portableInterface = openAiExtension?.interface as Record<string, unknown> | undefined
const codexInterface = codexPlugin.interface as Record<string, unknown> | undefined
if (!portableInterface) fail('Portable plugin must declare extensions.com.openai.interface')
if (JSON.stringify(portableInterface) !== JSON.stringify(codexInterface)) {
  fail('Portable and Codex OpenAI interfaces must match')
}

for (const [field, limit] of Object.entries(openAiListingLimits)) {
  const value = portableInterface?.[field]
  const mustBeSingleLine = field !== 'longDescription'
  if (
    typeof value !== 'string' ||
    !value ||
    (mustBeSingleLine && value.includes('\n')) ||
    value.length > limit ||
    !hasSupportedText(value, !mustBeSingleLine)
  ) {
    fail(
      `OpenAI ${field} must be non-empty${mustBeSingleLine ? ', single-line,' : ''} and at most ${limit} characters`,
    )
  }
}
const defaultPrompts = portableInterface?.defaultPrompt
if (!Array.isArray(defaultPrompts) || defaultPrompts.length === 0 || defaultPrompts.length > 3) {
  fail('OpenAI defaultPrompt must contain between 1 and 3 prompts')
} else {
  const normalizedPrompts = new Set<string>()
  for (const prompt of defaultPrompts) {
    if (
      typeof prompt !== 'string' ||
      !prompt ||
      !hasSupportedText(prompt) ||
      prompt.length > openAiDefaultPromptLimit ||
      prompt.includes('@')
    ) {
      fail(
        `OpenAI default prompts must be non-empty single lines of at most ${openAiDefaultPromptLimit} characters without @mentions`,
      )
    }
    if (typeof prompt === 'string') {
      const normalized = prompt.normalize('NFKC').trim().replace(/\s+/gu, ' ')
      if (normalizedPrompts.has(normalized)) {
        fail('OpenAI default prompts must be unique after Unicode and whitespace normalization')
      }
      normalizedPrompts.add(normalized)
    }
  }
}
const capabilities = portableInterface?.capabilities
if (!Array.isArray(capabilities) || capabilities.length > openAiCapabilityLimit) {
  fail(`OpenAI capabilities must be a list with at most ${openAiCapabilityLimit} entries`)
} else {
  for (const capability of capabilities) {
    if (
      typeof capability !== 'string' ||
      !capability ||
      capability.length > openAiCapabilityLengthLimit ||
      !hasSupportedText(capability)
    ) {
      fail(
        `OpenAI capabilities must be non-empty supported single-line text of at most ${openAiCapabilityLengthLimit} characters`,
      )
    }
  }
}
if (
  typeof portableInterface?.category !== 'string' ||
  !openAiCategories.has(portableInterface.category)
) {
  fail('OpenAI category must use a supported final-directory value')
}
for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
  validateHttpsUrl(portableInterface?.[field], `OpenAI ${field}`, openAiListingUrlLimit)
}
for (const field of ['composerIcon', 'logo']) {
  const value = portableInterface?.[field]
  if (typeof value !== 'string' || !value.startsWith('./')) {
    fail(`OpenAI ${field} must be a plugin-relative path starting with ./`)
    continue
  }
  const asset = resolve(root, value)
  if (!asset.startsWith(`${root}/`) || !existsSync(asset) || !lstatSync(asset).isFile()) {
    fail(`OpenAI ${field} must reference an existing file inside the plugin`)
    continue
  }
  validateOpenAiSvg(asset, `OpenAI ${field}`)
}
if ('screenshots' in (portableInterface ?? {})) {
  fail('OpenAI package must not declare screenshots without a reviewed MCP custom UI')
}

if (codexPlugin.skills !== './skills/') fail('Codex plugin must point to canonical ./skills/')
if (codexMarketplace.name !== 'pascal') fail('Codex marketplace name must be pascal')
const codexEntries = codexMarketplace.plugins
if (!Array.isArray(codexEntries) || codexEntries.length !== 1) {
  fail('Codex marketplace must contain exactly one plugin')
} else {
  const entry = codexEntries[0] as Record<string, unknown>
  const source = entry.source as Record<string, unknown> | undefined
  const policy = entry.policy as Record<string, unknown> | undefined
  if (entry.name !== codexPlugin.name) fail('Codex marketplace plugin name must match its manifest')
  if (source?.source !== 'local' || source.path !== './') {
    fail('Codex marketplace must resolve the plugin from the repository root')
  }
  if (policy?.installation !== 'AVAILABLE' || policy.authentication !== 'ON_INSTALL') {
    fail('Codex marketplace must declare its install and authentication policy')
  }
  if (entry.category !== 'Productivity') fail('Codex marketplace category must be declared')
}
if (claudeMarketplace.name !== 'pascal') fail('Claude marketplace name must be pascal')
if (claudeMarketplace.version !== pluginVersion) {
  fail(`Claude marketplace version must be ${pluginVersion}`)
}
const marketplacePlugins = claudeMarketplace.plugins
if (!Array.isArray(marketplacePlugins) || marketplacePlugins.length !== 1) {
  fail('Claude marketplace must contain exactly one plugin')
} else {
  const plugin = marketplacePlugins[0] as Record<string, unknown>
  if (plugin.source !== './') fail('Claude marketplace plugin must use the repository root')
  if (plugin.version !== pluginVersion) {
    fail(`Claude marketplace plugin version must be ${pluginVersion}`)
  }
  const packagedSkills = plugin.skills
  for (const skillName of skillNames) {
    if (!Array.isArray(packagedSkills) || !packagedSkills.includes(`./skills/${skillName}`)) {
      fail(`Claude marketplace is missing ${skillName}`)
    }
  }
}

const readme = read(join(root, 'README.md'))
for (const expected of [
  'npx skills add pascalorg/editor',
  '/plugin marketplace add pascalorg/editor',
  'codex plugin marketplace add pascalorg/editor',
  'codex plugin add pascal-agent-skills@pascal',
  'OpenClaw installation becomes available after the skills are published',
]) {
  if (!readme.includes(expected)) fail(`README is missing install instruction: ${expected}`)
}

if (failures.length > 0) {
  console.error(`Skill validation failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Validated ${skillNames.length} skills (${skillNames.map((name) => `${name}@${skillVersions[name]}`).join(', ')}) and portable, Codex, and Claude plugin manifests at ${pluginVersion}.`,
)
