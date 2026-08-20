'use client'

import { ArrowRightIcon, CornerDownLeftIcon, SearchIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { docsSearchIndex, docsTopLevelPages } from '@/lib/docs-catalog'
import { cn } from '@/lib/utils'

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

interface SearchableItem {
  searchableKeywords: string[]
  searchableText: string
  searchableTitle: string
}

function scoreWord(item: SearchableItem, word: string) {
  if (item.searchableTitle.startsWith(word)) {
    return 6
  }
  if (item.searchableTitle.includes(word)) {
    return 4
  }
  if (item.searchableKeywords.some((keyword) => keyword.startsWith(word))) {
    return 3
  }
  if (item.searchableText.includes(word)) {
    return 1
  }
  return 0
}

// Every query word must match somewhere; title > keyword > body.
function scoreResult(item: SearchableItem, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return 0
  }

  let total = 0
  for (const word of words) {
    const score = scoreWord(item, word)
    if (score === 0) {
      return 0
    }
    total += score
  }
  return total
}

export function DocsSearch({ className }: { className?: string }) {
  const router = useRouter()
  const searchId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const trimmed = query.trim()

    if (!trimmed) {
      return docsTopLevelPages.slice(0, 8).map((item) => ({
        ...item,
        score: 0,
      }))
    }

    return docsSearchIndex
      .map((item) => ({ ...item, score: scoreResult(item, trimmed) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 10)
  }, [query])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || event.key === '/') {
        if (isTypingTarget(event.target)) {
          return
        }
        event.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function goTo(index: number) {
    const item = results[index]
    if (!item) {
      return
    }

    setOpen(false)
    setQuery('')
    router.push(item.href)
  }

  const activeResultId =
    results.length > 0 ? `${searchId}-result-${Math.max(0, activeIndex)}` : undefined
  const resultsLabel = query.trim() ? 'Search results' : 'Pages'

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            className={cn(
              'h-8 justify-start border-transparent bg-muted/70 px-3 font-medium text-[14px] text-foreground leading-none shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
              className,
            )}
            type="button"
            variant="outline"
          />
        }
      >
        <SearchIcon aria-hidden="true" className="text-muted-foreground" data-icon="inline-start" />
        <span className="hidden truncate font-medium text-[14px] leading-none xl:inline">
          Search documentation...
        </span>
        <span className="hidden truncate font-medium text-[14px] leading-none md:inline xl:hidden">
          Search...
        </span>
        <span className="sr-only md:hidden">Search documentation</span>
      </DialogTrigger>
      <DialogContent
        className="top-[15dvh] flex max-w-2xl translate-y-0 flex-col gap-0 overflow-hidden p-2 pb-11 ring-1 ring-border/60 sm:max-w-2xl"
        data-surface="docs-search-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
          if (event.target !== inputRef.current) {
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (results.length === 0) {
              return
            }
            setActiveIndex((index) => Math.min(index + 1, results.length - 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (results.length === 0) {
              return
            }
            setActiveIndex((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            goTo(activeIndex)
          }
        }}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search documentation</DialogTitle>
          <DialogDescription>Search sections, demos, and API references.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-activedescendant={activeResultId}
            aria-autocomplete="list"
            aria-controls={`${searchId}-results`}
            aria-expanded={open}
            aria-label="Search documentation"
            className="!font-[500] !text-base md:!text-[14px] h-10 rounded-[8px] bg-muted/55 pr-10 pl-9 hover:bg-muted/70 focus-visible:bg-muted/55 focus-visible:ring-2"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation..."
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <Button
            aria-label="Close search"
            className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2"
            onClick={() => setOpen(false)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-2 max-h-[min(26rem,55dvh)] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 font-medium text-muted-foreground text-xs">
            {resultsLabel}
          </div>
          {results.length ? (
            <div
              aria-label={resultsLabel}
              className="flex flex-col gap-1"
              id={`${searchId}-results`}
              role="listbox"
            >
              {results.map((item, index) => (
                <Button
                  aria-selected={activeIndex === index}
                  className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-[8px] px-3 py-2 text-left font-normal text-muted-foreground shadow-none hover:bg-muted/45 hover:text-foreground focus-visible:bg-muted/45 data-[active=true]:bg-muted/45 data-[active=true]:text-foreground"
                  data-active={activeIndex === index}
                  id={`${searchId}-result-${index}`}
                  key={item.id}
                  onClick={() => goTo(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  variant="ghost"
                >
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="text-muted-foreground"
                    data-icon="inline-start"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{item.title}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {item.description}
                    </span>
                  </span>
                  <span className="hidden font-mono text-[10px] text-muted-foreground uppercase sm:inline">
                    {item.group}
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">No results found.</div>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2 border-border/60 border-t bg-background/70 px-4 font-medium text-muted-foreground text-xs">
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-muted px-1 font-sans text-[0.7rem] shadow-[var(--surface-ring)]">
            <CornerDownLeftIcon aria-hidden="true" className="size-3" />
          </kbd>
          Go to page
          <span className="ml-auto hidden sm:inline">Press / or ⌘K to search</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
