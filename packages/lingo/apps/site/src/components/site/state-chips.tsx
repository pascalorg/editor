'use client'

import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const LINGO_ATTRS = [
  'data-lingo',
  'data-state',
  'data-touched',
  'data-dirty',
  'data-invalid',
  'data-valid',
  'data-approx',
  'data-canonical',
  'data-unit',
] as const

interface StateChipsProps {
  className?: string
  el?: Element | null
}

function chipVariant(name: string, value: string) {
  if (name === 'state' && value === 'invalid') {
    return 'destructive'
  }
  if (name === 'state' && value === 'valid') {
    return 'secondary'
  }
  return 'outline'
}

export function StateChips({ el, className }: StateChipsProps) {
  // Attributes are read during render, versioned by the observer below. No
  // sync setState seed needed; the first render already sees the live DOM.
  const [version, setVersion] = useState(0)

  const snapshot = useMemo<Array<[string, string]>>(() => {
    void version
    if (!el) {
      return []
    }
    return LINGO_ATTRS.flatMap((attr) => {
      if (!el.hasAttribute(attr)) {
        return []
      }
      const value = el.getAttribute(attr)
      return [[attr.replace('data-', ''), value === '' ? 'true' : (value ?? '')]]
    })
  }, [el, version])

  useEffect(() => {
    if (!el) {
      return
    }

    const bump = () => setVersion((current) => current + 1)
    const observer = new MutationObserver(bump)
    observer.observe(el, { attributes: true, attributeFilter: [...LINGO_ATTRS] })
    el.addEventListener('input', bump)
    el.addEventListener('blur', bump)
    el.addEventListener('lingo:change', bump)

    return () => {
      observer.disconnect()
      el.removeEventListener('input', bump)
      el.removeEventListener('blur', bump)
      el.removeEventListener('lingo:change', bump)
    }
  }, [el])

  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      {snapshot.length === 0 ? (
        <Badge className="numeric-mono" variant="secondary">
          unbound
        </Badge>
      ) : (
        snapshot.map(([name, value]) => (
          <Badge
            className={cn(
              'numeric-mono h-auto min-h-6 min-w-0 max-w-full justify-start whitespace-normal break-all px-2 py-1 text-[0.68rem]',
            )}
            key={name}
            render={<code />}
            variant={chipVariant(name, value)}
          >
            {name}={value}
          </Badge>
        ))
      )}
    </div>
  )
}
