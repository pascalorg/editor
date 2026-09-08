import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillNames = ['pascal-3d', 'furniture-fit'] as const
const version = '0.1.0'
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

for (const skillName of skillNames) {
  const skillRoot = join(root, 'skills', skillName)
  const skillFile = join(skillRoot, 'SKILL.md')
  const content = read(skillFile)
  const fields = frontmatter(content, skillFile)
  if (fields.name !== skillName) fail(`${skillName}: frontmatter name does not match directory`)
  if (!fields.description) fail(`${skillName}: description is required`)
  if (!content.includes(`version: "${version}"`))
    fail(`${skillName}: metadata version must be ${version}`)
  if (!/^ {2}source-reviewed: "\d{4}-\d{2}-\d{2}"$/m.test(content)) {
    fail(`${skillName}: an ISO source review date is required`)
  }
  if (!/^ {2}native-host-validation: "[a-z0-9-]+"$/m.test(content)) {
    fail(`${skillName}: native host validation state must be explicit`)
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

const publishingFile = join(root, 'skills', 'evals', 'publishing-cases.json')
const publishing = parseJson(publishingFile) as {
  cases?: Array<{
    id?: unknown
    skill?: unknown
    kind?: unknown
    prompt?: unknown
    expected?: unknown
  }>
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
  if (item.kind === 'positive') positivePublishingCases++
  else if (item.kind === 'negative') negativePublishingCases++
  else fail(`Publishing case ${String(item.id)} needs kind positive or negative`)
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
const codexPlugin = parseJson(join(root, '.codex-plugin', 'plugin.json'))
const codexMarketplace = parseJson(join(root, '.agents', 'plugins', 'marketplace.json'))

for (const [label, manifest] of [
  ['Claude plugin', claudePlugin],
  ['Codex plugin', codexPlugin],
] as const) {
  if (manifest.name !== 'pascal-agent-skills') fail(`${label}: unexpected name`)
  if (manifest.version !== version) fail(`${label}: version must be ${version}`)
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
const marketplacePlugins = claudeMarketplace.plugins
if (!Array.isArray(marketplacePlugins) || marketplacePlugins.length !== 1) {
  fail('Claude marketplace must contain exactly one plugin')
} else {
  const plugin = marketplacePlugins[0] as Record<string, unknown>
  if (plugin.source !== './') fail('Claude marketplace plugin must use the repository root')
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
]) {
  if (!readme.includes(expected)) fail(`README is missing install instruction: ${expected}`)
}

if (failures.length > 0) {
  console.error(`Skill validation failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Validated ${skillNames.length} skills and both plugin manifests at version ${version}.`,
)
