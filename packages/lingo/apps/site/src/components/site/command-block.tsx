'use client'

import { TerminalIcon } from 'lucide-react'
import { useMemo } from 'react'

import { CopyButton } from '@/components/site/copy-button'
import {
  allPackageManagers,
  commandVariants,
  setPackageManager,
  usePackageManager,
} from '@/components/site/package-manager'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export function CommandBlock({ command, className }: { command: string; className?: string }) {
  const active = usePackageManager()
  const tabs = useMemo(() => commandVariants(command), [command])
  const activeCommand = tabs[active]

  return (
    <figure
      className={cn(
        'code-surface command-surface relative min-w-0 max-w-full overflow-hidden rounded-[8px] font-mono text-foreground text-sm',
        className,
      )}
      data-slot="command-block-surface"
    >
      <Tabs
        className="gap-0"
        onValueChange={(value) => setPackageManager(value as typeof active)}
        value={active}
      >
        <div className="flex min-h-9 min-w-0 items-center gap-2 border-border/50 border-b px-3 py-1 pr-11">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-foreground/80">
            <TerminalIcon aria-hidden="true" className="size-3 text-background" />
          </span>
          <TabsList
            aria-label="Package manager"
            className="min-w-0 rounded-none bg-transparent p-0 shadow-none"
          >
            {allPackageManagers().map((pm) => (
              <TabsTrigger className="h-7 rounded-[6px] px-2 font-mono text-xs" key={pm} value={pm}>
                {pm}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {allPackageManagers().map((pm) => (
          <TabsContent
            className="code-scroll overflow-x-hidden px-4 py-3.5 pr-12 focus-visible:ring-0 focus-visible:ring-offset-0"
            key={pm}
            value={pm}
          >
            <pre className="m-0 whitespace-pre-wrap break-words">
              <code className="font-mono text-sm leading-none">{tabs[pm]}</code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>
      <CopyButton
        className="absolute top-2 right-2 z-10 size-7 opacity-70 hover:opacity-100 focus-visible:opacity-100"
        copiedLabel="Copied command"
        label="Copy command"
        text={activeCommand}
      />
    </figure>
  )
}
