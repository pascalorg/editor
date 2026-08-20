'use client'

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'

import { useTheme } from '@/components/site/theme-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { mounted, resolvedTheme, setTheme } = useTheme()
  const dark = mounted && resolvedTheme === 'dark'
  const nextTheme = dark ? 'light' : 'dark'
  const title = mounted ? `Switch to ${nextTheme} theme` : 'Dark theme'

  return (
    <Button
      aria-label={title}
      aria-pressed={mounted ? dark : undefined}
      className={cn('size-9 rounded-full', className)}
      disabled={!mounted}
      onClick={() => setTheme(nextTheme)}
      size="icon-lg"
      title={title}
      type="button"
      variant="ghost"
    >
      {mounted ? (
        dark ? (
          <MoonIcon aria-hidden="true" />
        ) : (
          <SunIcon aria-hidden="true" />
        )
      ) : (
        <MonitorIcon aria-hidden="true" />
      )}
    </Button>
  )
}
