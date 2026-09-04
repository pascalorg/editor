'use client'

import { useMemo } from 'react'

import { CopyButton } from '@/components/site/copy-button'
import { EdgeFadeScroll } from '@/components/site/edge-fade-scroll'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'plain'

interface JsonToken {
  kind: JsonTokenKind
  value: string
}

const TOKEN_CLASS_NAMES: Record<JsonTokenKind, string> = {
  key: 'font-medium',
  string: '',
  number: '',
  boolean: 'font-medium',
  null: '',
  punctuation: '',
  plain: '',
}

const TOKEN_DATA_KIND: Record<JsonTokenKind, string> = {
  key: 'property',
  string: 'string',
  number: 'number',
  boolean: 'constant',
  null: 'constant',
  punctuation: 'punctuation',
  plain: 'plain',
}

export interface JsonViewProps {
  ariaLive?: 'off' | 'polite'
  className?: string
  copyText?: string
  heightClassName?: string
  label?: string
  value: string
}

function isWhitespace(char: string) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function isNumberStart(char: string) {
  return char === '-' || (char >= '0' && char <= '9')
}

function nextNonWhitespace(input: string, start: number) {
  let index = start
  while (index < input.length && isWhitespace(input[index] ?? '')) {
    index += 1
  }
  return input[index]
}

function readString(input: string, start: number) {
  let index = start + 1
  while (index < input.length) {
    const char = input[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') {
      return index + 1
    }
    index += 1
  }
  return input.length
}

function readNumber(input: string, start: number) {
  let index = start
  while (index < input.length && /[-+0-9.eE]/.test(input[index] ?? '')) {
    index += 1
  }
  return index
}

function tokenizeJson(input: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index] ?? ''

    if (isWhitespace(char)) {
      const start = index
      while (index < input.length && isWhitespace(input[index] ?? '')) {
        index += 1
      }
      tokens.push({ kind: 'plain', value: input.slice(start, index) })
      continue
    }

    if (char === '"') {
      const end = readString(input, index)
      tokens.push({
        kind: nextNonWhitespace(input, end) === ':' ? 'key' : 'string',
        value: input.slice(index, end),
      })
      index = end
      continue
    }

    if (isNumberStart(char)) {
      const end = readNumber(input, index)
      tokens.push({ kind: 'number', value: input.slice(index, end) })
      index = end
      continue
    }

    if (input.startsWith('true', index) || input.startsWith('false', index)) {
      const value = input.startsWith('true', index) ? 'true' : 'false'
      tokens.push({ kind: 'boolean', value })
      index += value.length
      continue
    }

    if (input.startsWith('null', index)) {
      tokens.push({ kind: 'null', value: 'null' })
      index += 4
      continue
    }

    if ('{}[]:,'.includes(char)) {
      tokens.push({ kind: 'punctuation', value: char })
      index += 1
      continue
    }

    tokens.push({ kind: 'plain', value: char })
    index += 1
  }

  return tokens
}

export function JsonView({
  value,
  label = 'Raw JSON',
  className,
  heightClassName = 'h-64',
  copyText,
  ariaLive = 'off',
}: JsonViewProps) {
  const tokens = useMemo(() => tokenizeJson(value), [value])
  const text = copyText ?? value

  return (
    <figure
      className={cn(
        'code-surface relative flex min-w-0 max-w-full flex-col overflow-hidden rounded-[8px] font-mono text-foreground text-sm',
        className,
      )}
      data-slot="json-view-surface"
    >
      <figcaption className="flex min-h-10 items-start justify-between gap-3 border-border/50 border-b px-4 py-2.5 text-muted-foreground text-xs">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Badge
            className="h-5 rounded-[4px] px-1.5 font-semibold text-[10px] uppercase"
            variant="secondary"
          >
            json
          </Badge>
          <span className="min-w-0 break-words text-foreground">{label}</span>
        </div>
        <CopyButton className="size-8 shrink-0" text={text} />
      </figcaption>
      <EdgeFadeScroll axis="y" className={cn('min-h-0 overflow-x-hidden', heightClassName)}>
        <pre
          aria-live={ariaLive}
          className="code-scroll m-0 w-full min-w-0 max-w-full overflow-hidden bg-transparent px-4 py-3.5 font-mono text-sm leading-[1.625]"
        >
          <code className="whitespace-pre-wrap break-words">
            {tokens.map((token, index) => (
              <span
                className={TOKEN_CLASS_NAMES[token.kind]}
                data-code-token={TOKEN_DATA_KIND[token.kind]}
                key={`${index}:${token.kind}:${token.value}`}
              >
                {token.value}
              </span>
            ))}
          </code>
        </pre>
      </EdgeFadeScroll>
    </figure>
  )
}
