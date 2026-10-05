'use client'

import { ChevronRight } from 'lucide-react'
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from 'react'
import { cn } from '../../../lib/utils'
import {
  WALL_DRAW_IDLE_CAPTION,
  WALL_DRAW_VARIANTS,
  type WallDrawVariant,
} from '../../../lib/wall-draw-variant'

/**
 * The Build panel's grouped layout (Rooms / Add to rooms / Outdoor / Advanced),
 * shared by the community and standalone editor Build tabs so both read the
 * same. Hosts own what each tile arms; these only lay the groups out.
 */
export function BuildPanelSection({
  children,
  hint,
  id,
  title,
}: {
  children: ReactNode
  hint?: string
  id: string
  title: string
}) {
  return (
    <section className="flex flex-col" data-build-group={id}>
      <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="font-medium text-foreground text-xs">{title}</h3>
        {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

const ADVANCED_OPEN_KEY = 'pascal-build-advanced-open'

function readAdvancedOpen(): boolean {
  try {
    return window.localStorage.getItem(ADVANCED_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeAdvancedOpen(open: boolean) {
  try {
    window.localStorage.setItem(ADVANCED_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked (private window, preview): the section just starts closed.
  }
}

/**
 * The collapsible Advanced group. Remembers its open state per viewer, and
 * opens itself when one of its tools becomes the armed one (e.g. by shortcut)
 * so the lit tile is never hidden.
 */
export function BuildPanelAdvancedSection({
  children,
  containsActiveTool,
  description,
  hint,
}: {
  children: ReactNode
  containsActiveTool: boolean
  description?: string
  hint?: string
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(readAdvancedOpen()), [])
  useEffect(() => {
    if (containsActiveTool) setOpen(true)
  }, [containsActiveTool])

  return (
    <section className="flex flex-col" data-build-group="advanced">
      <button
        aria-expanded={open}
        className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60"
        onClick={() => {
          const next = !open
          setOpen(next)
          writeAdvancedOpen(next)
        }}
        type="button"
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <h3 className="font-medium text-foreground text-xs">Advanced</h3>
        {hint ? (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 pt-1.5">
          {description ? (
            <p className="px-0.5 text-[11px] text-muted-foreground leading-relaxed">
              {description}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
    </section>
  )
}

export function BuildToolGrid({ children, columns }: { children: ReactNode; columns: 3 | 4 }) {
  return (
    <div className={cn('grid gap-1.5', columns === 3 ? 'grid-cols-3' : 'grid-cols-4')}>
      {children}
    </div>
  )
}

type BuildToolTileProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'type'> & {
  active: boolean
  /** Corner mark, e.g. the snap-target badge of wall-hosted tools. */
  badge?: ReactNode
  iconSrc: string
  label: string
  size?: 'lg' | 'sm'
}

/**
 * One tool tile: the isometric icon over its name. Inactive icons stay grey and
 * take their colour on hover; the armed tool keeps it, on the primary tint.
 */
export function BuildToolTile({
  active,
  badge,
  className,
  iconSrc,
  label,
  size = 'sm',
  ...buttonProps
}: BuildToolTileProps) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'group relative flex min-w-0 flex-col items-center justify-end rounded-xl transition-all duration-200',
        // Small tiles grow to two label lines ("Spawn point"); a grid row's
        // tiles stretch together, so a row keeps one height.
        size === 'lg' ? 'h-[104px] gap-1.5 px-1.5 pt-2 pb-2.5' : 'min-h-[74px] gap-1 px-1 pt-1.5 pb-2',
        active ? 'bg-primary/10 ring-1 ring-primary/50' : 'bg-muted/40 hover:bg-muted',
        className,
      )}
      type="button"
      {...buttonProps}
    >
      <img
        alt=""
        className={cn(
          'min-h-0 object-contain transition duration-200 group-hover:scale-110',
          size === 'lg' ? 'size-14' : 'size-9',
          !active && 'opacity-70 grayscale group-hover:opacity-100 group-hover:grayscale-0',
        )}
        draggable={false}
        src={iconSrc}
      />
      <span
        className={cn(
          'line-clamp-2 max-w-full text-center font-medium leading-tight',
          size === 'lg' ? 'text-xs' : 'text-[11px]',
          active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
        )}
      >
        {label}
      </span>
      {badge ? <span className="absolute top-1 right-1">{badge}</span> : null}
    </button>
  )
}

/** The line under the Rooms tiles: what the armed shape does, lead in bold. */
export function BuildPanelCaption({ lead, rest }: { lead?: string; rest: string }) {
  return (
    <p className="mt-2 min-h-[2lh] px-0.5 text-[11px] text-muted-foreground leading-relaxed">
      {lead ? <span className="font-medium text-foreground">{lead} </span> : null}
      {rest}
    </p>
  )
}

/**
 * The Rooms group: one large tile per wall drawing variant, and the armed
 * variant's caption. `activeVariant` is null while the wall tool is not armed.
 */
export function BuildPanelRoomsSection({
  activeVariant,
  onHover,
  onSelect,
  tileProps,
}: {
  activeVariant: WallDrawVariant | null
  onHover?: (variant: WallDrawVariant) => void
  onSelect: (variant: WallDrawVariant) => void
  /** Extra attributes per tile (e.g. a host's guide-target hook). */
  tileProps?: (variant: WallDrawVariant) => Record<string, string | undefined>
}) {
  const active = WALL_DRAW_VARIANTS.find((variant) => variant.id === activeVariant)
  return (
    <BuildPanelSection hint="walls · floor · ceiling" id="rooms" title="Rooms">
      <BuildToolGrid columns={3}>
        {WALL_DRAW_VARIANTS.map((variant) => (
          <BuildToolTile
            active={variant.id === activeVariant}
            data-build-tool={`room-${variant.id}`}
            iconSrc={variant.iconSrc}
            key={variant.id}
            label={variant.label}
            onClick={() => onSelect(variant.id)}
            onMouseEnter={() => onHover?.(variant.id)}
            size="lg"
            title={variant.title}
            {...tileProps?.(variant.id)}
          />
        ))}
      </BuildToolGrid>
      <BuildPanelCaption
        lead={active?.caption.lead}
        rest={active ? active.caption.rest : WALL_DRAW_IDLE_CAPTION}
      />
    </BuildPanelSection>
  )
}
