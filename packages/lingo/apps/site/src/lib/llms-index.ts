import { isMarkdownSectionId } from '@/lib/docs.md'
import { docsNavGroups } from '@/lib/docs-catalog'

const SITE = 'https://lingo.pascal.app'

function link(href: string, title: string, description: string) {
  return `- [${title}](${href}): ${description}`
}

export function buildLlmsIndex() {
  const lines = [
    '# lingo',
    '',
    '> Make forms easier, LLM tools safer. Zero-dependency TypeScript library that parses natural-language quantities, units, dates, and ranges into canonical SI-anchored values; converts, validates, formats, and humanizes. Entries: `@pascal-app/lingo`, `@pascal-app/lingo/date`, `@pascal-app/lingo/dom`, `@pascal-app/lingo/element`, `@pascal-app/lingo/react`, `@pascal-app/lingo/react-native`, `@pascal-app/lingo/ai`, `@pascal-app/lingo/mcp`, `@pascal-app/lingo/describe`, `@pascal-app/lingo/catalog`, `@pascal-app/lingo/complete`, `@pascal-app/lingo/schema`, `@pascal-app/lingo/locales/{en,en-gb,es,fr,pt,zh,ja}`, `@pascal-app/lingo/core`.',
    '',
    'Agent fetch order: read this index first, then fetch section markdown at `/docs/<section>.md` for the topic you need, or `/llms-full.txt` for the complete narrative. For offline or compressed reference, fetch `/llms-small.txt` (npm-shipped package reference). Keep user measurements as strings in tool schemas; call lingo to convert, validate, surface spans, and handle ambiguity.',
    '',
    '## Documentation sets',
    '',
    link(
      `${SITE}/llms-full.txt`,
      'Complete documentation',
      'Full `/docs` page as markdown — installation through API reference.',
    ),
    link(
      `${SITE}/llms-small.txt`,
      'Compressed reference',
      'Self-contained API reference shipped in the npm package.',
    ),
    link(
      `${SITE}/llms.md`,
      'Legacy full markdown',
      'Same content as llms-full.txt; prefer `/llms-full.txt` or per-section `.md` URLs.',
    ),
    '',
  ]

  // Top-level catalog pages each own a `##` markdown section; sub-pages
  // (depth 3) fold into their parent via markdownSectionId and are skipped.
  for (const group of docsNavGroups) {
    lines.push(`## ${group.label}`)
    if (group.subtitle) {
      lines.push('', group.subtitle)
    }
    lines.push('')
    for (const item of group.items) {
      if (item.depth) {
        continue
      }
      lines.push(link(`${SITE}/docs/${item.id}.md`, item.title, item.description))
    }
    lines.push('')
  }

  lines.push(
    '## Schema & wire types',
    '',
    link(`${SITE}/schema/lingo.schema.json`, 'JSON Schema', 'Draft 2020-12 of the v3 wire types.'),
    link(
      `${SITE}/schema/lingo.openapi.json`,
      'OpenAPI 3.1',
      'OpenAPI document for the wire shapes.',
    ),
    link(
      `${SITE}/schema/dictionary.md`,
      'Schema dictionary',
      'Human-readable field glossary for wire types.',
    ),
    '',
    '## Optional',
    '',
    link(
      `${SITE}/schema/adapters/zod.ts`,
      'Zod adapter',
      'Generated Zod schema from the wire types.',
    ),
    link(`${SITE}/schema/adapters/valibot.ts`, 'Valibot adapter', 'Generated Valibot schema.'),
    link(`${SITE}/schema/adapters/typebox.ts`, 'TypeBox adapter', 'Generated TypeBox schema.'),
    link(`${SITE}/schema/adapters/arktype.ts`, 'ArkType adapter', 'Generated ArkType schema.'),
    link(`${SITE}/schema/adapters/effect.ts`, 'Effect adapter', 'Generated Effect Schema.'),
    link(
      'https://github.com/pascalorg/lingo/tree/main/packages/lingo#readme',
      'README',
      'Package overview and recipes on GitHub.',
    ),
    '',
  )

  return `${lines.join('\n').trimEnd()}\n`
}

export function assertLlmsIndexLinks() {
  const sectionIds = [
    ...buildLlmsIndex().matchAll(/\]\(https:\/\/lingo\.pascal\.app\/docs\/([^)]+)\.md\)/g),
  ].map((match) => match[1])
  const missing = sectionIds.filter((id) => !isMarkdownSectionId(id))
  if (missing.length > 0) {
    throw new Error(`llms.txt index links to unknown markdown sections: ${missing.join(', ')}`)
  }
}
