'use client'

import { m, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { DocsNavGroup } from '@/lib/docs-catalog'
import { cn } from '@/lib/utils'

export interface TocItem {
  depth?: 2 | 3
  href?: string
  id: string
  title: string
}

export function DocsNav({
  groups,
  items,
  label,
  className,
}: {
  groups?: DocsNavGroup[]
  items?: TocItem[]
  label: string
  className?: string
}) {
  const navGroups = useMemo(
    () => groups ?? [{ label, subtitle: undefined, items: items ?? [] }],
    [groups, items, label],
  )
  const ids = useMemo(
    () => navGroups.flatMap((group) => group.items.map((item) => item.id)),
    [navGroups],
  )
  const [activeId, setActiveId] = useState(ids[0] ?? '')
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null)
  const reduceMotion = useReducedMotion()
  const activeGroupLabel = useMemo(
    () =>
      navGroups.find((group) => group.items.some((item) => item.id === activeId))?.label ??
      navGroups[0]?.label ??
      '',
    [activeId, navGroups],
  )

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element))
    if (elements.length === 0) {
      return
    }

    const markerOffset = 112
    let frame: number | null = null
    const updateActive = () => {
      if (frame !== null) {
        return
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        const positions = elements
          .map((element) => ({
            id: element.id,
            top: element.getBoundingClientRect().top,
          }))
          .sort((a, b) => a.top - b.top)
        const hashId = decodeURIComponent(window.location.hash.slice(1))
        const hashTarget = positions.find(
          (position) =>
            position.id === hashId && position.top >= 0 && position.top <= markerOffset * 2,
        )
        const passed = positions.filter((position) => position.top <= markerOffset)
        const next =
          hashTarget ?? passed.at(-1) ?? positions.find((position) => position.top > markerOffset)
        if (next?.id) {
          setActiveId((current) => (current === next.id ? current : next.id))
        }
      })
    }

    const observer = new IntersectionObserver(updateActive, {
      rootMargin: '-112px 0px -70% 0px',
      threshold: [0, 0.5, 1],
    })

    elements.forEach((element) => {
      observer.observe(element)
    })
    updateActive()
    window.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive)
    window.addEventListener('hashchange', updateActive)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
      window.removeEventListener('hashchange', updateActive)
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [ids])

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeId])

  return (
    <nav aria-label={label} className={cn('w-60 text-sm', className)}>
      <ul className="flex flex-col pb-4" role="list">
        {navGroups.map((group, index) => {
          const groupHasActive = activeGroupLabel === group.label
          const subtitle = 'subtitle' in group ? group.subtitle : undefined

          return (
            <li className={cn(index > 0 && 'pt-6')} key={group.label}>
              <div
                className={cn(
                  'relative z-10 w-[calc(100%-1rem)] bg-background pl-0.5 leading-5',
                  subtitle ? 'pb-2' : 'pb-3',
                )}
              >
                <span
                  className={cn(
                    'block truncate font-semibold text-[11px] text-muted-foreground uppercase',
                    groupHasActive && 'text-foreground',
                  )}
                >
                  {group.label}
                </span>
                {subtitle ? (
                  <span className="mt-0.5 block truncate font-normal text-[11px] text-muted-foreground normal-case tracking-normal">
                    {subtitle}
                  </span>
                ) : null}
              </div>
              <ul className="space-y-1 border-border/80 border-l" role="list">
                {group.items.map((item) => {
                  const active = activeId === item.id
                  return (
                    <li className="relative" key={item.id}>
                      <a
                        aria-current={active ? 'location' : undefined}
                        className={cn(
                          'relative flex min-h-7 items-center py-1 pr-2 pl-4 text-[13px] text-muted-foreground leading-5 outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                          item.depth === 3 && 'pl-7 text-xs',
                          active && 'font-medium text-foreground',
                        )}
                        href={item.href ?? `#${item.id}`}
                        ref={active ? activeLinkRef : undefined}
                      >
                        {active ? (
                          <m.span
                            aria-hidden="true"
                            className="absolute top-1 bottom-1 -left-px w-0.5 rounded-full bg-foreground"
                            layoutId="docs-nav-active-rail"
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : { type: 'spring', stiffness: 420, damping: 34, mass: 0.35 }
                            }
                          />
                        ) : null}
                        <span className="truncate">{item.title}</span>
                      </a>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
