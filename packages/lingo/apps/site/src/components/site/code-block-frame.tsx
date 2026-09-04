'use client'

import { ChevronDownIcon, ChevronUpIcon, FileCodeIcon, TerminalIcon } from 'lucide-react'
import { useState } from 'react'

import { CopyButton } from '@/components/site/copy-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function splitFilename(filename: string | undefined, lang: string) {
  const value = filename ?? lang
  const slash = value.lastIndexOf('/')
  if (slash === -1) {
    return { dir: '', file: value }
  }
  return { dir: value.slice(0, slash + 1), file: value.slice(slash + 1) }
}

export function CodeBlockFrame({
  code,
  html,
  lang,
  filename,
  className,
  forcePreview = false,
  clampLongCode = true,
  previewHeightClass = 'max-h-64',
  expandLabel = 'Expand',
}: {
  code: string
  html: string
  lang: string
  filename?: string
  className?: string
  forcePreview?: boolean
  clampLongCode?: boolean
  previewHeightClass?: string
  expandLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  // Collapse only blocks with 15+ lines; anything shorter always stays expanded.
  const expandable = clampLongCode && code.split('\n').length > 14
  // A block that can toggle between clamped and full, in either direction.
  const toggleable = forcePreview || expandable
  const clamped = !expanded && toggleable
  const name = splitFilename(filename, lang)
  const CodeIcon =
    lang === 'bash' || lang === 'shell' || lang === 'sh' ? TerminalIcon : FileCodeIcon

  return (
    <figure
      className={cn(
        'code-surface relative min-w-0 max-w-full overflow-hidden rounded-[8px] font-mono text-foreground text-sm',
        className,
      )}
      data-slot="code-block-surface"
    >
      <figcaption className="flex min-h-9 items-center gap-2 border-border/50 border-b px-3 py-1.5 text-muted-foreground text-xs">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-foreground/80 text-background">
          <CodeIcon aria-hidden="true" className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-[10px] text-muted-foreground/70 uppercase">
            {lang}
          </span>
          {filename ? (
            <>
              <span className="px-1.5 text-muted-foreground/40">/</span>
              {name.dir ? <span className="text-muted-foreground/60">{name.dir}</span> : null}
              <span className="text-foreground">{name.file}</span>
            </>
          ) : null}
        </span>
        <CopyButton
          className="size-7 shrink-0 opacity-70 hover:opacity-100 focus-visible:opacity-100"
          text={code}
        />
      </figcaption>
      <div className="relative">
        <div
          className={cn(
            'code-scroll min-w-0 max-w-full overflow-y-hidden transition-[max-height] duration-[var(--motion-moderate)] ease-[cubic-bezier(0.23,1,0.32,1)]',
            // While clamped the preview is a static teaser: `code-clamped` locks
            // the inner Shiki `<pre>` (overflow-x: auto) so it can't scroll sideways.
            clamped ? `${previewHeightClass} code-clamped` : 'max-h-none',
          )}
          // Trust boundary: only repo-authored Shiki HTML or escaped plain-code HTML reaches this sink.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {clamped ? (
          <div className="code-surface-fade pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center pb-2">
            <Button
              className="pointer-events-auto bg-background/80 shadow-[var(--surface-ring)]"
              onClick={() => setExpanded(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ChevronDownIcon
                aria-hidden="true"
                className="transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]"
                data-icon="inline-start"
              />
              {expandLabel}
            </Button>
          </div>
        ) : null}
      </div>
      {toggleable && expanded ? (
        <div className="flex justify-center border-border/50 border-t py-2">
          <Button
            className="bg-background/80"
            onClick={() => setExpanded(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronUpIcon aria-hidden="true" data-icon="inline-start" />
            Collapse
          </Button>
        </div>
      ) : null}
    </figure>
  )
}

function escapeHtml(input: string) {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const CODE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'return',
  'satisfies',
  'switch',
  'throw',
  'try',
  'type',
  'typeof',
  'var',
  'while',
])

const CODE_CONSTANTS = new Set(['false', 'null', 'true', 'undefined'])

function tokenHtml(kind: string, value: string) {
  return `<span data-code-token="${kind}">${escapeHtml(value)}</span>`
}

function readQuoted(input: string, start: number) {
  const quote = input[start]
  let index = start + 1
  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2
      continue
    }
    if (input[index] === quote) {
      return index + 1
    }
    index += 1
  }
  return input.length
}

function readIdentifier(input: string, start: number) {
  let index = start
  while (index < input.length && /[\w$:-]/.test(input[index] ?? '')) {
    index += 1
  }
  return index
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_$]/.test(char)
}

function isNumberStart(char: string, next: string | undefined) {
  return /[0-9]/.test(char) || (char === '-' && Boolean(next && /[0-9]/.test(next)))
}

function highlightPlainLine(line: string, lang: string) {
  const jsxLike = lang === 'tsx' || lang === 'jsx'
  let html = ''
  let index = 0
  let inJsxTag = false

  while (index < line.length) {
    const char = line[index] ?? ''
    const next = line[index + 1]

    if (char === '/' && next === '/') {
      html += tokenHtml('comment', line.slice(index))
      break
    }

    if (char === '"' || char === "'" || char === '`') {
      const end = readQuoted(line, index)
      html += tokenHtml('string', line.slice(index, end))
      index = end
      continue
    }

    if (jsxLike && char === '<' && next !== ' ' && next !== '=') {
      const closing = next === '/'
      html += tokenHtml('punctuation', closing ? '</' : '<')
      index += closing ? 2 : 1
      const end = readIdentifier(line, index)
      if (end > index) {
        html += tokenHtml('tag', line.slice(index, end))
        index = end
        inJsxTag = true
      }
      continue
    }

    if (inJsxTag && (char === '>' || (char === '/' && next === '>'))) {
      html += tokenHtml('punctuation', char === '/' ? '/>' : '>')
      index += char === '/' ? 2 : 1
      inJsxTag = false
      continue
    }

    if (isNumberStart(char, next)) {
      const match = line.slice(index).match(/^-?\d+(?:\.\d+)?/)
      if (match?.[0]) {
        html += tokenHtml('number', match[0])
        index += match[0].length
        continue
      }
    }

    if (isIdentifierStart(char)) {
      const end = readIdentifier(line, index)
      const word = line.slice(index, end)
      const nextNonSpace = line.slice(end).trimStart()[0]
      if (CODE_KEYWORDS.has(word)) {
        html += tokenHtml('keyword', word)
      } else if (CODE_CONSTANTS.has(word)) {
        html += tokenHtml('constant', word)
      } else if (inJsxTag || nextNonSpace === ':') {
        html += tokenHtml('property', word)
      } else if (nextNonSpace === '(') {
        html += tokenHtml('function', word)
      } else {
        html += escapeHtml(word)
      }
      index = end
      continue
    }

    if ('{}[]().,;:=+-*/|&!?<>'.includes(char)) {
      html += tokenHtml('punctuation', char)
      index += 1
      continue
    }

    html += escapeHtml(char)
    index += 1
  }

  return html
}

function plainHtml(code: string, lang: string) {
  const lines = code.split('\n')
  return `<pre class="shiki code-scroll"><code data-line-numbers="">${lines
    .map((line) => `<span data-line="">${highlightPlainLine(line, lang) || ' '}</span>`)
    .join('')}</code></pre>`
}

export function PlainCodeBlock({
  code,
  lang = 'text',
  filename,
  className,
  forcePreview,
  clampLongCode,
  previewHeightClass,
  expandLabel,
}: {
  code: string
  lang?: string
  filename?: string
  className?: string
  forcePreview?: boolean
  clampLongCode?: boolean
  previewHeightClass?: string
  expandLabel?: string
}) {
  const html = plainHtml(code, lang)
  return (
    <CodeBlockFrame
      clampLongCode={clampLongCode}
      className={className}
      code={code}
      expandLabel={expandLabel}
      filename={filename}
      forcePreview={forcePreview}
      html={html}
      lang={lang}
      previewHeightClass={previewHeightClass}
    />
  )
}
