import type * as React from 'react'

import { cn } from '@/lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div
      className="corner-smooth relative w-full min-w-0 overflow-x-auto rounded-xl bg-background shadow-raise-sm overscroll-x-contain [scrollbar-gutter:stable]"
      data-slot="table-container"
      data-surface="table-scroll"
    >
      <table
        className={cn(
          'w-full caption-bottom border-separate border-spacing-0 text-sm tabular-nums',
          className,
        )}
        data-slot="table"
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      className={cn(
        '[&_th]:border-border/60 [&_th]:bg-muted/30',
        '[&_th:first-child]:rounded-l-[6px] [&_th:last-child]:rounded-r-[6px]',
        '[&_tr]:border-0 [&_tr:hover]:bg-transparent',
        className,
      )}
      data-slot="table-header"
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      className={cn('[&_tr:last-child>*]:border-b-0', className)}
      data-slot="table-body"
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'bg-muted/20 font-medium [&>tr>*]:border-border/60',
        '[&>tr>*]:border-t [&>tr>*]:border-b-0 [&>tr]:last:border-b-0',
        className,
      )}
      data-slot="table-footer"
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-muted/20 data-[state=selected]:bg-muted/45',
        className,
      )}
      data-slot="table-row"
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-9 border-border/45 border-b px-3 py-2 text-left align-middle',
        'font-medium text-muted-foreground text-xs whitespace-nowrap',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      data-slot="table-head"
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn(
        'border-border/45 border-b px-3 py-2.5 align-middle whitespace-nowrap',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      data-slot="table-cell"
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      className={cn('mt-3 text-muted-foreground text-xs', className)}
      data-slot="table-caption"
      {...props}
    />
  )
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
}
