'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialSwatch,
  type MaterialCatalogItem,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { materialSwatchStyle } from '../../../lib/material-swatch-style'
import { cn } from '../../../lib/utils'
import {
  newWallTypeBlockedReason,
  useProjectWallTypes,
  type WallTypeId,
  type WallTypeOption,
} from '../../../lib/wall-type'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'

const TRIGGER_CLASS =
  'group flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border/50 bg-black/4 px-3 text-xs transition-colors hover:bg-black/8 data-[state=open]:bg-black/8 dark:bg-[#2C2C2E] dark:data-[state=open]:bg-[#3e3e3e] dark:hover:bg-[#3e3e3e]'

/**
 * One placement's wall type list, grouped (Presets, This project, Other), with
 * "New wall type…" at the bottom: the Build panel's Exterior or Interior pick.
 * "New wall type…" is off, and says why, once the project keeps as many types as
 * it can (`newWallTypeBlockedReason`).
 */
export function WallTypeSelect({
  className,
  label,
  onChange,
  onNew,
  options,
  value,
}: {
  className?: string
  label: string
  onChange: (id: WallTypeId) => void
  onNew: () => void
  options: readonly WallTypeOption[]
  value: WallTypeId
}) {
  const current = options.find((option) => option.id === value)?.label
  const blocked = newWallTypeBlockedReason(useProjectWallTypes())
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={label} className={cn(TRIGGER_CLASS, className)} type="button">
          <span className="select-none text-muted-foreground transition-colors group-hover:text-foreground">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <span className="truncate">{current}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuRadioGroup onValueChange={(next) => onChange(next)} value={value}>
          {options.map((option, index) => (
            <Fragment key={option.id}>
              {option.group !== options[index - 1]?.group ? (
                <>
                  {index > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    {option.group}
                  </DropdownMenuLabel>
                </>
              ) : null}
              <DropdownMenuRadioItem value={option.id}>{option.label}</DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!!blocked} onSelect={onNew}>
          <Plus />
          New wall type…
        </DropdownMenuItem>
        {blocked ? (
          <p className="max-w-64 px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground leading-snug">
            {blocked}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * What can be done with the picked type: a project type is edited or deleted in
 * place; any type, a preset too, can be duplicated into a new project type while
 * the project has room for one (`newWallTypeBlockedReason`).
 */
export function WallTypeActions({
  label,
  onDelete,
  onDuplicate,
  onEdit,
}: {
  label: string
  /** Absent for a preset or the plain wall, which belong to no project. */
  onDelete?: () => void
  /** Absent for the plain wall, which has no layers to start from. */
  onDuplicate?: () => void
  onEdit?: () => void
}) {
  const projectTypes = useProjectWallTypes()
  const blocked = onDuplicate ? newWallTypeBlockedReason(projectTypes) : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Edit or duplicate ${label}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-black/4 text-muted-foreground transition-colors hover:bg-black/8 hover:text-foreground data-[state=open]:bg-black/8 dark:bg-[#2C2C2E] dark:hover:bg-[#3e3e3e]"
          title="Edit or duplicate this wall type"
          type="button"
        >
          <Pencil className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-muted-foreground text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuItem disabled={!onEdit} onSelect={onEdit}>
          <Pencil />
          Edit layers…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onDuplicate || !!blocked} onSelect={onDuplicate}>
          <Copy />
          Duplicate as a new type…
        </DropdownMenuItem>
        {onDelete ? (
          <DropdownMenuItem onSelect={onDelete} variant="destructive">
            <Trash2 />
            Delete from this project
          </DropdownMenuItem>
        ) : null}
        {blocked ? (
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground leading-snug">
            {blocked}
          </p>
        ) : onEdit ? null : (
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground leading-snug">
            Presets stay as cited. Duplicate one to change its layers.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function swatchOf(ref: string): { label: string; style: ReturnType<typeof materialSwatchStyle> } {
  const item = getCatalogMaterialById(getLibraryMaterialIdFromRef(ref) ?? undefined)
  if (!item) return { label: ref.startsWith('#') ? ref.toUpperCase() : 'Default', style: {} }
  return { label: item.label, style: materialSwatchStyle(getMaterialSwatch(item)) }
}

/**
 * A finish new walls are drawn with: the swatch and name of the pick, and a grid of
 * the products it can be (a cladding kind's, or the flat paint colours).
 */
export function WallFinishPicker({
  label,
  onChange,
  products,
  value,
}: {
  label: string
  onChange: (ref: string) => void
  products: readonly MaterialCatalogItem[]
  value: string
}) {
  const [open, setOpen] = useState(false)
  const swatch = swatchOf(value)
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}: ${swatch.label}`}
          className={TRIGGER_CLASS}
          data-wall-finish={label}
          type="button"
        >
          <span className="select-none text-muted-foreground transition-colors group-hover:text-foreground">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <span
              aria-hidden
              className="size-4 shrink-0 overflow-hidden rounded-full border border-border/50"
              style={swatch.style}
            />
            <span className="truncate">{swatch.label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2" side="left">
        <div className="mb-1.5 px-0.5 font-medium text-xs">{label}</div>
        <div className="subtle-scrollbar grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto">
          {products.map((item) => {
            const ref = toLibraryMaterialRef(item.id)
            return (
              <button
                aria-pressed={ref === value}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg p-1 text-center transition-colors hover:bg-accent',
                  ref === value && 'bg-accent ring-1 ring-primary ring-inset',
                )}
                key={item.id}
                onClick={() => {
                  onChange(ref)
                  setOpen(false)
                }}
                title={item.label}
                type="button"
              >
                <span
                  aria-hidden
                  className="aspect-square w-full rounded-md border border-border/50"
                  style={materialSwatchStyle(getMaterialSwatch(item))}
                />
                <span className="line-clamp-2 text-[10px] text-muted-foreground leading-tight">
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
