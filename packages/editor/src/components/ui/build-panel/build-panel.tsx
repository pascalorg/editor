'use client'

import {
  type MessageDescriptor,
  type PascalI18n,
  usePascalI18n,
  WALL_FINISH_LIBRARY_REF,
  wallAssemblyCladding,
  wallCladdingProducts,
  wallPaintProducts,
} from '@pascal-app/core'
import { ChevronRight } from 'lucide-react'
import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from 'react'
import { messageWithSlot } from '../../../i18n/message-slot'
import { armWallLineTool, armWallTypeTool, withToolShortcut } from '../../../lib/tool-shortcuts'
import { cn } from '../../../lib/utils'
import {
  setWallTypeOverride,
  useWallLineKind,
  useWallTypeOverridePlacement,
  WALL_DRAW_VARIANTS,
  type WallDrawVariant,
  type WallLineKind,
} from '../../../lib/wall-draw-variant'
import {
  availableWallType,
  deleteProjectWallType,
  resolveWallType,
  useProjectWallTypes,
  WALL_LINE_TOOLS,
  WALL_TYPE_TOOLS,
  type WallTypePlacement,
  wallTypeOptions,
  wallTypePlacementOf,
} from '../../../lib/wall-type'
import useEditor from '../../../store/use-editor'
import { WallFinishPicker, WallTypeActions, WallTypeSelect } from './wall-type-controls'
import { type WallTypeEditorRequest, WallTypeEditorDialog } from './wall-type-editor-dialog'

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
  const i18n = usePascalI18n()
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
        <h3 className="font-medium text-foreground text-xs">
          {i18n._({ id: 'editor.buildPanel.advanced', message: 'Advanced' })}
        </h3>
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
  tone?: 'primary' | 'neutral'
}

/**
 * One tool tile: the isometric icon over its name. Inactive icons stay grey and
 * take their colour on hover. Neutral tiles keep that behavior when armed.
 */
export function BuildToolTile({
  active,
  badge,
  className,
  iconSrc,
  label,
  size = 'sm',
  tone = 'primary',
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
        active
          ? tone === 'neutral'
            ? 'bg-black/8 ring-1 ring-foreground/30 dark:bg-muted'
            : 'bg-primary/10 ring-1 ring-primary/50'
          : 'bg-black/4 hover:bg-black/8 dark:bg-muted/40 dark:hover:bg-muted',
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
          (!active || tone === 'neutral') &&
            'opacity-70 grayscale group-hover:opacity-100 group-hover:grayscale-0',
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

const CAPTION_LEAD_MARKER = '__PASCAL_CAPTION_LEAD__'

/** The line under the Rooms tiles: what the armed shape does, lead in bold. */
export function BuildPanelCaption({ caption, lead }: { caption: string; lead?: string }) {
  const markerIndex = caption.indexOf(CAPTION_LEAD_MARKER)
  const hasMarkedLead = lead && markerIndex >= 0
  return (
    <p className="mt-2 min-h-[2lh] px-0.5 text-[11px] text-muted-foreground leading-relaxed">
      {hasMarkedLead ? (
        <>
          {caption.slice(0, markerIndex)}
          <span className="font-medium text-foreground">{lead}</span>
          {caption.slice(markerIndex + CAPTION_LEAD_MARKER.length)}
        </>
      ) : (
        caption
      )}
    </p>
  )
}

/**
 * The Rooms group: one large tile per wall drawing variant, then the Exterior
 * wall and Interior wall tiles (single walls of one type, `WALL_TYPE_TOOLS`), the
 * Invisible wall tile (`WALL_LINE_TOOLS`), and the armed tile's caption.
 * `activeVariant` is null while the wall tool is not armed.
 */
export function BuildPanelRoomsSection({
  activeVariant,
  onHover,
  onSelect,
  onSelectWallTool,
  onSelectWallLineTool,
  tileProps,
}: {
  activeVariant: WallDrawVariant | null
  onHover?: (variant: WallDrawVariant) => void
  onSelect: (variant: WallDrawVariant) => void
  /**
   * Arms the Exterior or Interior wall tool the way the host arms its tiles;
   * absent = as its shortcut does (`armWallTypeTool`).
   */
  onSelectWallTool?: (placement: WallTypePlacement) => void
  /** Arms the Invisible wall (or Railing) tool the way the host arms its tiles; absent = `armWallLineTool`. */
  onSelectWallLineTool?: (kind: WallLineKind) => void
  /** Extra attributes per tile (e.g. a host's guide-target hook). */
  tileProps?: (variant: WallDrawVariant) => Record<string, string | undefined>
}) {
  const i18n = usePascalI18n()
  // Exterior and Interior wall draw the Walls shape with one type: their tile is lit, not Walls.
  const forced = useWallTypeOverridePlacement()
  const lineKind = useWallLineKind()
  const wallTool = activeVariant
    ? WALL_TYPE_TOOLS.find((tool) => tool.placement === forced)
    : undefined
  const lineTool = activeVariant ? WALL_LINE_TOOLS.find((tool) => tool.kind === lineKind) : undefined
  const litVariant = wallTool || lineTool ? null : activeVariant
  const active = WALL_DRAW_VARIANTS.find((variant) => variant.id === litVariant)
  const activeMessages = active ? roomVariantMessages(active.id, i18n) : null
  // The Exterior / Interior wall and line tools draw like Walls: their caption opens with its lead.
  const toolCaption = wallTool
    ? wallTypeToolMessages(wallTool.placement, i18n).caption
    : lineTool
      ? wallLineToolMessages(lineTool.kind, i18n).caption
      : null
  return (
    <BuildPanelSection
      hint={i18n._({
        id: 'editor.buildPanel.rooms.hint',
        message: 'walls · floor · ceiling',
      })}
      id="rooms"
      title={i18n._({ id: 'editor.buildPanel.rooms.title', message: 'Rooms' })}
    >
      <BuildToolGrid columns={3}>
        {WALL_DRAW_VARIANTS.map((variant) => {
          const messages = roomVariantMessages(variant.id, i18n)
          return (
            <BuildToolTile
              active={variant.id === litVariant}
              data-build-tool={`room-${variant.id}`}
              iconSrc={variant.iconSrc}
              key={variant.id}
              label={messages.label}
              onClick={() => {
                setWallTypeOverride(null)
                onSelect(variant.id)
              }}
              onMouseEnter={() => onHover?.(variant.id)}
              size="lg"
              title={messages.title}
              {...tileProps?.(variant.id)}
            />
          )
        })}
        {WALL_TYPE_TOOLS.map((tool) => {
          const messages = wallTypeToolMessages(tool.placement, i18n)
          return (
            <BuildToolTile
              active={wallTool?.placement === tool.placement}
              data-build-tool={`wall-${tool.placement}`}
              iconSrc={tool.iconSrc}
              key={tool.placement}
              label={messages.label}
              onClick={() => {
                if (onSelectWallTool) onSelectWallTool(tool.placement)
                else armWallTypeTool(tool.placement)
              }}
              onMouseEnter={() => onHover?.('walls')}
              size="lg"
              title={withToolShortcut(messages.title, tool.shortcut)}
            />
          )
        })}
        {WALL_LINE_TOOLS.map((tool) => {
          const messages = wallLineToolMessages(tool.kind, i18n)
          return (
            <BuildToolTile
              active={lineTool?.kind === tool.kind}
              data-build-tool={`wall-${tool.kind}`}
              iconSrc={tool.iconSrc}
              key={tool.kind}
              label={messages.label}
              onClick={() => {
                if (onSelectWallLineTool) onSelectWallLineTool(tool.kind)
                else armWallLineTool(tool.kind)
              }}
              onMouseEnter={() => onHover?.('walls')}
              size="lg"
              title={messages.title}
            />
          )
        })}
      </BuildToolGrid>
      <BuildPanelCaption
        caption={
          toolCaption ??
          activeMessages?.caption ??
          i18n._({
            id: 'editor.buildPanel.rooms.idle',
            message:
              'Pick a shape to start. Every room brings its own walls, floor and ceiling.',
          })
        }
        lead={toolCaption ? roomVariantMessages('walls', i18n).lead : activeMessages?.lead}
      />
      <BuildPanelWallTypes />
    </BuildPanelSection>
  )
}

function roomVariantMessages(variant: WallDrawVariant, i18n: PascalI18n) {
  if (variant === 'rectangle') {
    return {
      label: i18n._({
        id: 'editor.buildPanel.rooms.rectangle.label',
        message: 'Rectangle',
      }),
      title: i18n._({
        id: 'editor.buildPanel.rooms.rectangle.title',
        message: 'Rectangle room',
      }),
      lead: i18n._({
        id: 'editor.buildPanel.rooms.rectangle.lead',
        message: 'Click two corners',
      }),
      caption: i18n._({
        id: 'editor.buildPanel.rooms.rectangle.caption',
        message: '{lead} on the grid. Walls, floor and ceiling are created together.',
        values: { lead: CAPTION_LEAD_MARKER },
      }),
    }
  }
  if (variant === 'walls') {
    return {
      label: i18n._({ id: 'editor.buildPanel.rooms.walls.label', message: 'Walls' }),
      title: i18n._({ id: 'editor.buildPanel.rooms.walls.title', message: 'Walls' }),
      lead: i18n._({
        id: 'editor.buildPanel.rooms.walls.lead',
        message: 'Click each corner;',
      }),
      caption: i18n._({
        id: 'editor.buildPanel.rooms.walls.caption',
        message:
          '{lead} every wall starts where the last ended. Esc or double-click ends the run; close a loop and it becomes a room.',
        values: { lead: CAPTION_LEAD_MARKER },
      }),
    }
  }
  return {
    label: i18n._({ id: 'editor.buildPanel.rooms.polygon.label', message: 'Polygon' }),
    title: i18n._({
      id: 'editor.buildPanel.rooms.polygon.title',
      message: 'Polygon room',
    }),
    lead: i18n._({
      id: 'editor.buildPanel.rooms.polygon.lead',
      message: 'Click each corner,',
    }),
    caption: i18n._({
      id: 'editor.buildPanel.rooms.polygon.caption',
      message: '{lead} then the first one again to close. For L-shapes and angled rooms.',
      values: { lead: CAPTION_LEAD_MARKER },
    }),
  }
}

/**
 * The Exterior and Interior wall tiles (`WALL_TYPE_TOOLS`): their name, tooltip, and the caption
 * while one is armed, after the Walls lead.
 */
function wallTypeToolMessages(placement: WallTypePlacement, i18n: PascalI18n) {
  if (placement === 'interior') {
    return {
      label: i18n._({ id: 'editor.buildPanel.rooms.interiorWall.label', message: 'Interior wall' }),
      title: i18n._({
        id: 'editor.buildPanel.rooms.interiorWall.title',
        message: 'Interior walls: every wall drawn takes the interior type and paint',
      }),
      caption: i18n._({
        id: 'editor.buildPanel.rooms.interiorWall.caption',
        message:
          '{lead} every wall takes the interior type, wherever it lands. Esc or double-click ends the run.',
        values: { lead: CAPTION_LEAD_MARKER },
      }),
    }
  }
  return {
    label: i18n._({ id: 'editor.buildPanel.rooms.exteriorWall.label', message: 'Exterior wall' }),
    title: i18n._({
      id: 'editor.buildPanel.rooms.exteriorWall.title',
      message: 'Exterior walls: every wall drawn takes the exterior type and cladding',
    }),
    caption: i18n._({
      id: 'editor.buildPanel.rooms.exteriorWall.caption',
      message:
        '{lead} every wall takes the exterior type, wherever it lands. Esc or double-click ends the run.',
      values: { lead: CAPTION_LEAD_MARKER },
    }),
  }
}

/**
 * The Invisible wall and Railing tiles (`WALL_LINE_TOOLS`): their name, tooltip, and the caption
 * while one is armed, after the Walls lead.
 */
function wallLineToolMessages(kind: WallLineKind, i18n: PascalI18n) {
  if (kind === 'railing') {
    return {
      label: i18n._({ id: 'editor.buildPanel.rooms.railing.label', message: 'Railing' }),
      title: i18n._({
        id: 'editor.buildPanel.rooms.railing.title',
        message:
          'Railings: a 36 in guard drawn like walls, posts at most 6 ft apart. Rooms close on it and it takes openings; style and height in the wall panel.',
      }),
      caption: i18n._({
        id: 'editor.buildPanel.rooms.railing.caption',
        message:
          '{lead} every line is a railing: a guard rooms close on, with no studs, siding or footing. Place a door on it for an opening. Esc or double-click ends the run.',
        values: { lead: CAPTION_LEAD_MARKER },
      }),
    }
  }
  return {
    label: i18n._({
      id: 'editor.buildPanel.rooms.invisibleWall.label',
      message: 'Invisible wall',
    }),
    title: i18n._({
      id: 'editor.buildPanel.rooms.invisibleWall.title',
      message:
        'Invisible walls: divide a room or close off a porch without building a wall. Rooms close on them; they never cut a wall.',
    }),
    caption: i18n._({
      id: 'editor.buildPanel.rooms.invisibleWall.caption',
      message:
        '{lead} every line is an invisible wall: rooms close on it, nothing is built. Closed off outside the house, a room becomes a porch. Esc or double-click ends the run.',
      values: { lead: CAPTION_LEAD_MARKER },
    }),
  }
}

const WALL_TYPE_ROWS: ReadonlyArray<{ placement: WallTypePlacement; label: MessageDescriptor }> = [
  {
    placement: 'exterior',
    label: /* i18n */ { id: 'editor.buildPanel.wallTypes.exterior', message: 'Exterior' },
  },
  {
    placement: 'interior',
    label: /* i18n */ { id: 'editor.buildPanel.wallTypes.interior', message: 'Interior' },
  },
]

/** The cladding picker's name for each kind: what a builder calls the stuff on the wall. */
const CLADDING_LABEL: Record<string, MessageDescriptor> = {
  siding: /* i18n */ { id: 'editor.buildPanel.wallTypes.siding', message: 'Siding' },
  'fiber-cement': /* i18n */ {
    id: 'editor.buildPanel.wallTypes.fiberCement',
    message: 'Fiber cement',
  },
  stucco: /* i18n */ { id: 'editor.buildPanel.wallTypes.stucco', message: 'Stucco' },
  brick: /* i18n */ { id: 'editor.buildPanel.wallTypes.brick', message: 'Brick' },
  stone: /* i18n */ { id: 'editor.buildPanel.wallTypes.stone', message: 'Stone' },
}

/** A cladding kind the picker has no name for. */
const CLADDING_FALLBACK_LABEL = /* i18n */ {
  id: 'editor.buildPanel.wallTypes.cladding',
  message: 'Cladding',
}

/**
 * The wall types Rectangle, Polygon and Walls draw with, picked before drawing
 * and kept with the editor preferences: the exterior type for the outline and
 * open runs, the interior type for walls drawn inside a room. Each list holds
 * the types that build its kind of wall, the project's own among them, and
 * "New wall type…"; the pencil edits a project type or duplicates any. Beside
 * them, the finishes new walls get: the exterior type's cladding product and
 * the paint on every drywall face. While the Exterior or Interior wall tool is
 * armed only its row shows, as that tool's settings.
 */
export function BuildPanelWallTypes() {
  const i18n = usePascalI18n()
  const wallTypes = useEditor((state) => state.wallTypes)
  const wallFinishes = useEditor((state) => state.wallFinishes)
  const setWallType = useEditor((state) => state.setWallType)
  const setWallCladding = useEditor((state) => state.setWallCladding)
  const setWallPaint = useEditor((state) => state.setWallPaint)
  const projectTypes = useProjectWallTypes()
  const [editing, setEditing] = useState<WallTypeEditorRequest | null>(null)
  // Set by the Exterior / Interior wall tools: every wall takes that type.
  const forced = useWallTypeOverridePlacement()
  const rows = forced ? WALL_TYPE_ROWS.filter((row) => row.placement === forced) : WALL_TYPE_ROWS
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-build-group="wall-types">
      {rows.map(({ placement, label }) => {
        const id = availableWallType(wallTypes[placement], placement, projectTypes)
        const type = resolveWallType(id, projectTypes)
        const cladding = type ? wallAssemblyCladding(type.assembly) : undefined
        const claddingProducts = wallCladdingProducts(cladding)
        return (
          <div
            className={cn(
              'flex flex-col gap-1.5',
              forced === placement && '-m-1 rounded-xl p-1 ring-1 ring-primary/50',
            )}
            data-wall-type-row={placement}
            key={placement}
          >
            <div className="flex gap-1.5">
              <WallTypeSelect
                className="flex-1"
                label={i18n._(label)}
                onChange={(next) => setWallType(placement, next)}
                onNew={() => setEditing({ mode: 'new', placement })}
                options={wallTypeOptions(placement, projectTypes, id)}
                value={id}
              />
              <WallTypeActions
                label={
                  type?.label ??
                  i18n._({ id: 'editor.buildPanel.wallTypes.plainWall', message: 'Plain wall' })
                }
                onDelete={type?.project ? () => deleteProjectWallType(id) : undefined}
                onDuplicate={
                  type
                    ? () =>
                        setEditing({
                          mode: 'duplicate',
                          placement,
                          label: type.label,
                          assembly: type.assembly,
                        })
                    : undefined
                }
                onEdit={
                  type?.project
                    ? () =>
                        setEditing({
                          mode: 'edit',
                          placement,
                          id,
                          label: type.label,
                          assembly: type.assembly,
                        })
                    : undefined
                }
              />
            </div>
            {placement === 'exterior' && cladding && claddingProducts.length > 0 ? (
              <WallFinishPicker
                finish={cladding}
                label={i18n._(CLADDING_LABEL[cladding] ?? CLADDING_FALLBACK_LABEL)}
                onChange={(ref) => setWallCladding(cladding, ref)}
                products={claddingProducts}
                value={wallFinishes.cladding[cladding] ?? WALL_FINISH_LIBRARY_REF[cladding] ?? ''}
              />
            ) : null}
            {placement === 'interior' ? (
              <WallFinishPicker
                finish="paint"
                label={i18n._({
                  id: 'editor.buildPanel.wallTypes.drywallPaint',
                  message: 'Drywall paint',
                })}
                onChange={setWallPaint}
                products={wallPaintProducts()}
                value={wallFinishes.paint}
              />
            ) : null}
          </div>
        )
      })}
      <p className="px-0.5 text-[11px] text-muted-foreground leading-relaxed">
        {forced
          ? messageWithSlot(
              i18n,
              forced === 'interior'
                ? /* i18n */ {
                    id: 'editor.buildPanel.wallTypes.forcedInterior',
                    message:
                      '{drawing} Every wall takes the interior type until you pick a shape or leave the tool.',
                  }
                : /* i18n */ {
                    id: 'editor.buildPanel.wallTypes.forcedExterior',
                    message:
                      '{drawing} Every wall takes the exterior type until you pick a shape or leave the tool.',
                  },
              'drawing',
              <span className="font-medium text-foreground">
                {forced === 'interior'
                  ? i18n._({
                      id: 'editor.buildPanel.wallTypes.drawingInterior',
                      message: 'Drawing: Interior walls.',
                    })
                  : i18n._({
                      id: 'editor.buildPanel.wallTypes.drawingExterior',
                      message: 'Drawing: Exterior walls.',
                    })}
              </span>,
            )
          : i18n._({
              id: 'editor.buildPanel.wallTypes.hint',
              message:
                'New walls use the exterior type and cladding; walls drawn inside a room use the interior type. Every drywall face gets the paint.',
            })}
      </p>
      <WallTypeEditorDialog
        onClose={() => setEditing(null)}
        onSaved={(type) => setWallType(wallTypePlacementOf(type.assembly), type.id)}
        request={editing}
      />
    </div>
  )
}
