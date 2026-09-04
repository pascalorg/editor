'use client'

import { ChevronDownIcon, FileTextIcon, LinkIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CopyIconMorph } from '@/components/site/copy-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const actionSegmentClassName =
  'rounded-none! bg-transparent shadow-none hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)] hover:shadow-none focus-visible:z-10 focus-visible:ring-offset-0 aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_4%)]'

export function DocsPageActions({
  markdown,
  markdownHref,
  copyLabel = 'Copy Page',
  copiedLabel = 'Copied',
  compact = false,
  className,
}: {
  markdown: string
  markdownHref: string
  copyLabel?: string
  copiedLabel?: string
  compact?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const linkTimeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
      if (linkTimeoutRef.current !== null) {
        window.clearTimeout(linkTimeoutRef.current)
      }
    },
    [],
  )

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => setCopied(false), 2000)
  }

  async function copyMarkdownUrl() {
    const url = new URL(markdownHref, window.location.origin).toString()
    await navigator.clipboard.writeText(url)
    setLinkCopied(true)
    if (linkTimeoutRef.current !== null) {
      window.clearTimeout(linkTimeoutRef.current)
    }
    linkTimeoutRef.current = window.setTimeout(() => setLinkCopied(false), 2000)
  }

  return (
    <DropdownMenu>
      <div
        className={cn(
          'isolate inline-flex items-center overflow-hidden rounded-lg bg-secondary text-secondary-foreground shadow-[var(--surface-ring)] transition-[background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)]',
          className,
        )}
        data-slot="button-group"
      >
        <Button
          aria-label={copied ? copiedLabel : copyLabel}
          className={cn(actionSegmentClassName, compact && 'size-7')}
          onClick={copyMarkdown}
          size={compact ? 'icon-sm' : 'default'}
          title={copied ? copiedLabel : copyLabel}
          type="button"
          variant="ghost"
        >
          <CopyIconMorph copied={copied} dataIcon={compact ? undefined : 'inline-start'} />
          {compact ? null : <span>{copied ? copiedLabel : copyLabel}</span>}
        </Button>
        <Separator
          aria-hidden="true"
          className={cn(compact ? 'my-1.5' : 'my-2', 'bg-border/80')}
          orientation="vertical"
        />
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Markdown actions"
              className={cn(actionSegmentClassName, compact ? 'size-7' : 'size-8')}
              size={compact ? 'icon-sm' : 'icon'}
              type="button"
              variant="ghost"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" className="w-52" sideOffset={6}>
        <DropdownMenuGroup>
          <DropdownMenuLinkItem closeOnClick href={markdownHref}>
            <FileTextIcon aria-hidden="true" />
            View as Markdown
          </DropdownMenuLinkItem>
          <DropdownMenuItem onClick={copyMarkdownUrl}>
            <LinkIcon aria-hidden="true" />
            {linkCopied ? 'Copied Markdown URL' : 'Copy Markdown URL'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
