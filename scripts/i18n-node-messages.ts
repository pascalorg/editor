import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MessageDescriptor } from '@lingui/core'
import {
  HINT_KEY_NAMES,
  nodeDescriptionDescriptor,
  nodeLabelDescriptor,
  toolHintChipDescriptor,
  toolHintDescriptor,
  toolHintKeyDescriptor,
} from '../packages/editor/src/i18n/node-messages'

/**
 * Generates `packages/nodes/src/i18n/definition-messages.ts`: one Lingui
 * descriptor per display string the built-in node definitions carry
 * (presentation label/description, tool and affordance hint labels, gesture
 * keys, chip labels and tooltips, plus the shared key names). The definitions
 * stay English; the editor looks these IDs up at display time, so this file
 * exists for extraction.
 */

const ROOT = process.env.I18N_ROOT
  ? resolve(process.env.I18N_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODES_ENTRY = join(ROOT, 'packages/nodes/src/index.ts')
export const DEFINITION_MESSAGES_PATH = join(ROOT, 'packages/nodes/src/i18n/definition-messages.ts')

type Hint = {
  key?: string
  label?: string
  chip?: { labels?: Record<string, string>; tooltip?: string }
}

type Definition = {
  kind?: string
  type?: string
  presentation?: { label?: string; description?: string }
  toolHints?: Hint[]
  affordanceHints?: Record<string, Hint[]>
}

type Manifest = {
  name?: string
  exports?: Record<string, string | { import?: string; default?: string }>
}

/**
 * A tsconfig whose `paths` send every `@pascal-app/<pkg>[/<subpath>]` export to
 * its TypeScript source instead of `dist/`, so the definitions load before any
 * build: i18n:check runs ahead of the build in CI.
 */
function workspaceSourcesTsconfig(): string {
  const paths: Record<string, string[]> = {}
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    const manifestPath = join(ROOT, 'packages', pkg, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    if (!manifest.name?.startsWith('@pascal-app/')) continue
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const file = typeof target === 'string' ? target : (target?.import ?? target?.default)
      if (!file) continue
      const source = file.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '')
      const resolved = [source, `${source}.ts`, `${source}.tsx`, `${source}/index.ts`]
        .map((candidate) => join('packages', pkg, candidate))
        .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(join(ROOT, candidate)))
      if (resolved) paths[`${manifest.name}${subpath.slice(1)}`] = [resolved]
    }
  }
  const path = join(mkdtempSync(join(tmpdir(), 'pascal-i18n-')), 'tsconfig.json')
  writeFileSync(path, JSON.stringify({ compilerOptions: { baseUrl: ROOT, paths } }))
  return path
}

function descriptorsOf(definitions: Definition[]): MessageDescriptor[] {
  const byId = new Map<string, MessageDescriptor>()
  const add = (descriptor: MessageDescriptor | undefined) => {
    if (!(descriptor?.message && /\p{L}{2}/u.test(descriptor.message))) return
    const message = descriptor.message
    const existing = byId.get(descriptor.id)
    if (existing && existing.message !== message) {
      throw new Error(
        `Definition copy "${message}" and "${existing.message}" both map to ${descriptor.id}; reword one`,
      )
    }
    byId.set(descriptor.id, { id: descriptor.id, message })
  }
  const addHint = (hint: Hint) => {
    if (hint.label) add(toolHintDescriptor(hint.label))
    if (hint.key) add(toolHintKeyDescriptor(hint.key))
    for (const [value, label] of Object.entries(hint.chip?.labels ?? {})) {
      add(toolHintChipDescriptor(value, label).descriptor)
    }
    if (hint.chip?.tooltip) add(toolHintDescriptor(hint.chip.tooltip))
  }
  for (const definition of definitions) {
    const kind = definition.kind ?? definition.type
    if (!kind) continue
    const { label, description } = definition.presentation ?? {}
    if (label) add(nodeLabelDescriptor(kind, label))
    if (description) add(nodeDescriptionDescriptor(kind, description))
    for (const hint of definition.toolHints ?? []) addHint(hint)
    for (const hints of Object.values(definition.affordanceHints ?? {})) {
      for (const hint of hints) addHint(hint)
    }
  }
  for (const key of HINT_KEY_NAMES) add(toolHintKeyDescriptor(key))
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Loads the built-in definitions from source in a child process and returns their descriptors. */
export async function definitionDescriptors(): Promise<MessageDescriptor[]> {
  const result = Bun.spawnSync(
    [
      process.execPath,
      `--tsconfig-override=${workspaceSourcesTsconfig()}`,
      fileURLToPath(import.meta.url),
      '--emit-json',
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) {
    throw new Error(`Could not load the node definitions:\n${result.stderr.toString()}`)
  }
  return JSON.parse(result.stdout.toString()) as MessageDescriptor[]
}

export function renderDefinitionMessages(descriptors: MessageDescriptor[]): string {
  const lines = descriptors.map(
    (descriptor) =>
      `  /* i18n */ { id: ${JSON.stringify(descriptor.id)}, message: ${JSON.stringify(descriptor.message)} },`,
  )
  return [
    '// Generated by `bun run i18n:extract` from the built-in node definitions; do not edit.',
    '// The editor translates definition copy at display time',
    '// (packages/editor/src/i18n/node-messages.ts); these descriptors exist so Lingui',
    '// extracts and translates those IDs.',
    'export const definitionMessages = [',
    ...lines,
    ']',
    '',
  ].join('\n')
}

export async function writeDefinitionMessages(): Promise<void> {
  // A checkout without the built-in nodes has no definition copy.
  if (!existsSync(NODES_ENTRY)) return
  mkdirSync(dirname(DEFINITION_MESSAGES_PATH), { recursive: true })
  writeFileSync(DEFINITION_MESSAGES_PATH, renderDefinitionMessages(await definitionDescriptors()))
}

export async function checkDefinitionMessages(): Promise<string[]> {
  if (!existsSync(NODES_ENTRY)) return []
  const expected = renderDefinitionMessages(await definitionDescriptors())
  const current = existsSync(DEFINITION_MESSAGES_PATH)
    ? readFileSync(DEFINITION_MESSAGES_PATH, 'utf8')
    : ''
  return current === expected
    ? []
    : [
        'packages/nodes/src/i18n/definition-messages.ts is not synchronized; run bun run i18n:extract',
      ]
}

if (import.meta.main && process.argv.includes('--emit-json')) {
  const { builtinPlugin } = (await import('../packages/nodes/src/index')) as {
    builtinPlugin: { nodes: Definition[] }
  }
  process.stdout.write(JSON.stringify(descriptorsOf(builtinPlugin.nodes)))
}
