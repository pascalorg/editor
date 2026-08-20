import type * as React from 'react'

import { cn } from '@/lib/utils'

const splitPaneClassName =
  'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)] lg:items-start'
const paneClassName =
  'corner-smooth flex min-w-0 flex-col gap-4 rounded-[8px] bg-card p-4 shadow-[var(--surface-ring)]'

export function DocsSplitPane({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(splitPaneClassName, className)}
      data-docs-split-pane=""
      data-slot="docs-split-pane"
      {...props}
    />
  )
}

export function DocsSplitPaneSection({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn(splitPaneClassName, className)}
      data-docs-split-pane=""
      data-slot="docs-split-pane"
      {...props}
    />
  )
}

export function DocsPane({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(paneClassName, className)}
      data-docs-pane=""
      data-slot="docs-split-pane-panel"
      {...props}
    />
  )
}

export function DocsPaneSection({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn(paneClassName, className)}
      data-docs-pane=""
      data-slot="docs-split-pane-panel"
      {...props}
    />
  )
}
