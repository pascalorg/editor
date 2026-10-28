'use client'

import {
  type Assembly,
  type AssemblyLayer,
  BRICK_AIR_SPACE,
  BRICK_VENEER,
  FIBER_CEMENT,
  GYPSUM_HALF,
  GYPSUM_SHEATHING,
  newWallTypeId,
  SIDING_LAP,
  STONE_VENEER_UNVERIFIED,
  STUCCO_3_COAT,
  WALL_TYPE_CORES,
  type WallTypeCore,
  type WallTypeDefinition,
  WSP_SHEATHING,
  wallTypeAssembly,
  wallTypeCoreOf,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatLayerThickness, parseLayerThickness } from '../../../lib/layer-thickness'
import type { LinearUnit } from '../../../lib/measurements'
import { cn } from '../../../lib/utils'
import {
  saveProjectWallType,
  WALL_TYPE_LAYER_LIMIT,
  WALL_TYPE_SAVE_FAILURE,
  type WallTypePlacement,
  type WallTypeSaveResult,
  wallTypePlacementOf,
} from '../../../lib/wall-type'
import { Button } from '../primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog'

/** What the editor opens on: a blank type for a placement, a project type to edit, or a type to copy. */
export type WallTypeEditorRequest =
  | { mode: 'new'; placement: WallTypePlacement }
  | { mode: 'edit'; placement: WallTypePlacement; id: string; label: string; assembly: Assembly }
  | { mode: 'duplicate'; placement: WallTypePlacement; label: string; assembly: Assembly }

/** The roles a layer takes in the editor; `core` is the one framing layer. */
type DraftRole = 'finish' | 'air' | 'sheathing' | 'insulation' | 'core' | 'lining'

type DraftLayer = {
  key: number
  role: DraftRole
  material: string
  thickness: number
}

const IN = 0.0254

const ROLE_LABEL: Record<DraftRole, string> = {
  finish: 'Finish',
  air: 'Air space',
  sheathing: 'Sheathing',
  insulation: 'Insulation',
  core: 'Framing core',
  lining: 'Lining',
}

/**
 * Each role's materials, as the construction kinds the inspector and the framers
 * read, and the cited thickness one starts at (the `wall-assembly.ts` constants;
 * insulation is the product's own, typed in).
 */
const LAYER_MATERIALS: Record<
  Exclude<DraftRole, 'core'>,
  ReadonlyArray<{ value: string; label: string; thickness: number }>
> = {
  finish: [
    { value: 'siding', label: 'Lap siding', thickness: SIDING_LAP },
    { value: 'fiber-cement', label: 'Fiber cement', thickness: FIBER_CEMENT },
    { value: 'stucco', label: 'Stucco', thickness: STUCCO_3_COAT },
    { value: 'brick', label: 'Brick veneer', thickness: BRICK_VENEER },
    { value: 'stone', label: 'Stone veneer', thickness: STONE_VENEER_UNVERIFIED },
  ],
  air: [{ value: 'air', label: 'Air space', thickness: BRICK_AIR_SPACE }],
  sheathing: [
    { value: 'osb', label: 'OSB', thickness: WSP_SHEATHING },
    { value: 'plywood', label: 'Plywood', thickness: WSP_SHEATHING },
    { value: 'gypsum', label: 'Gypsum sheathing', thickness: GYPSUM_SHEATHING },
  ],
  insulation: [
    { value: 'rigid-foam', label: 'Rigid foam', thickness: 1 * IN },
    { value: 'mineral-wool', label: 'Mineral wool board', thickness: 1.5 * IN },
  ],
  lining: [
    { value: 'drywall', label: 'Drywall', thickness: GYPSUM_HALF },
    { value: 'plaster', label: 'Plaster', thickness: STUCCO_3_COAT },
  ],
}

const ADDABLE_ROLES: ReadonlyArray<Exclude<DraftRole, 'core'>> = [
  'finish',
  'air',
  'sheathing',
  'insulation',
  'lining',
]

const DEFAULT_CORE: Record<WallTypePlacement, WallTypeCore> = {
  exterior: WALL_TYPE_CORES.find((core) => core.id === 'wood-2x6-16')!,
  interior: WALL_TYPE_CORES.find((core) => core.id === 'wood-2x4-16')!,
}

let nextKey = 1

function layerOf(role: Exclude<DraftRole, 'core'>, material?: string): DraftLayer {
  const options = LAYER_MATERIALS[role]
  const option = options.find((entry) => entry.value === material) ?? options[0]!
  return { key: nextKey++, role, material: option.value, thickness: option.thickness }
}

function coreLayer(core: WallTypeCore): DraftLayer {
  return { key: nextKey++, role: 'core', material: core.id, thickness: core.thickness }
}

function draftRoleOf(layer: AssemblyLayer): DraftRole {
  if (layer.core) return 'core'
  switch (layer.role) {
    case 'finish':
    case 'air':
    case 'sheathing':
    case 'insulation':
    case 'lining':
      return layer.role
    default:
      return 'sheathing'
  }
}

/** The editor's layers for a request: a stack to start from, or a typical one for the placement. */
function initialLayers(request: WallTypeEditorRequest): DraftLayer[] {
  if (request.mode === 'new') {
    return request.placement === 'exterior'
      ? [
          layerOf('finish', 'siding'),
          layerOf('sheathing', 'osb'),
          coreLayer(DEFAULT_CORE.exterior),
          layerOf('lining', 'drywall'),
        ]
      : [layerOf('lining', 'drywall'), coreLayer(DEFAULT_CORE.interior), layerOf('lining', 'drywall')]
  }
  const core = wallTypeCoreOf(request.assembly) ?? DEFAULT_CORE[request.placement]
  const layers = request.assembly.layers.map((layer): DraftLayer => {
    const role = draftRoleOf(layer)
    if (role === 'core') return coreLayer(core)
    return {
      key: nextKey++,
      role,
      material: layer.material ?? LAYER_MATERIALS[role][0]!.value,
      thickness: layer.thickness,
    }
  })
  return layers.some((layer) => layer.role === 'core') ? layers : [...layers, coreLayer(core)]
}

/** Where a new layer of `role` goes: a finish outermost, sheathing and insulation just outside the core, a lining innermost. */
function insertIndex(layers: readonly DraftLayer[], role: DraftRole): number {
  const coreIndex = layers.findIndex((layer) => layer.role === 'core')
  if (role === 'finish') return 0
  if (role === 'air') {
    const finish = layers.findIndex((layer) => layer.role === 'finish')
    return finish < 0 ? 0 : finish + 1
  }
  if (role === 'lining') return layers.length
  if (role === 'insulation') {
    const sheathing = layers.findIndex((layer) => layer.role === 'sheathing')
    return sheathing >= 0 && sheathing < coreIndex ? sheathing : coreIndex
  }
  return coreIndex
}

/** The saved stack: each layer as an assembly layer, the core with its framing size and spacing. */
function draftAssembly(id: string, layers: readonly DraftLayer[]): Assembly {
  return wallTypeAssembly(
    id,
    layers.map((layer): Omit<AssemblyLayer, 'id'> => {
      if (layer.role === 'core') {
        const core = WALL_TYPE_CORES.find((entry) => entry.id === layer.material)!
        return {
          role: 'structure',
          core: true,
          material: core.material,
          thickness: core.thickness,
          ...(core.spacing !== undefined ? { spacing: core.spacing } : {}),
        }
      }
      return {
        role: layer.role,
        thickness: layer.thickness,
        ...(layer.role === 'air' ? {} : { material: layer.material }),
      }
    }),
  )
}

const FIELD_CLASS =
  'h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary'

function ThicknessField({
  metres,
  onCommit,
  unit,
}: {
  metres: number
  onCommit: (metres: number) => void
  unit: LinearUnit
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      aria-label="Thickness"
      className={cn(FIELD_CLASS, 'text-right tabular-nums')}
      onBlur={() => {
        if (draft != null) {
          const parsed = parseLayerThickness(draft, unit)
          if (parsed != null && parsed > 0) onCommit(parsed)
        }
        setDraft(null)
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      spellCheck={false}
      value={draft ?? formatLayerThickness(metres, unit)}
    />
  )
}

const TITLE: Record<WallTypeEditorRequest['mode'], string> = {
  new: 'New wall type',
  edit: 'Edit wall type',
  duplicate: 'Duplicate wall type',
}

/**
 * The wall type editor: a name and the
 * layers from the outside in — finish, air space, sheathing, insulation, lining —
 * around exactly one framing core, whose size and spacing are what the framers stud
 * the wall at. The total updates as layers change; saving keeps the type with the
 * project (`saveProjectWallType`) and lists it under Exterior when it has a cladding
 * side, Interior otherwise.
 */
export function WallTypeEditorDialog({
  onClose,
  onSaved,
  request,
}: {
  onClose: () => void
  onSaved: (type: WallTypeDefinition) => void
  request: WallTypeEditorRequest | null
}) {
  const unit = useViewer((state) => state.unit)
  const [name, setName] = useState('')
  const [layers, setLayers] = useState<DraftLayer[]>([])
  const [failure, setFailure] = useState<Exclude<WallTypeSaveResult, 'saved'> | null>(null)

  useEffect(() => {
    if (!request) return
    setLayers(initialLayers(request))
    setName(
      request.mode === 'new'
        ? request.placement === 'exterior'
          ? 'My exterior wall'
          : 'My interior wall'
        : request.mode === 'duplicate'
          ? `${request.label} (copy)`
          : request.label,
    )
    setFailure(null)
  }, [request])

  const total = layers.reduce((sum, layer) => sum + layer.thickness, 0)
  const placement = useMemo(
    () => (layers.length > 0 ? wallTypePlacementOf(draftAssembly('custom-draft', layers)) : null),
    [layers],
  )
  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && layers.every((layer) => layer.thickness > 0)
  // A wall type's stack holds `WALL_TYPE_LAYER_LIMIT` layers at most; past it the type would not save.
  const full = layers.length >= WALL_TYPE_LAYER_LIMIT
  const fullReason = `A wall type holds at most ${WALL_TYPE_LAYER_LIMIT} layers.`

  const update = (key: number, patch: Partial<DraftLayer>) =>
    setLayers((current) => current.map((layer) => (layer.key === key ? { ...layer, ...patch } : layer)))
  const move = (index: number, by: -1 | 1) =>
    setLayers((current) => {
      const target = index + by
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })

  const save = () => {
    if (!(request && canSave)) return
    const id = request.mode === 'edit' ? request.id : newWallTypeId()
    const type: WallTypeDefinition = {
      id,
      label: trimmed.slice(0, 60),
      assembly: draftAssembly(id, layers),
    }
    const result = saveProjectWallType(type)
    if (result !== 'saved') {
      setFailure(result)
      return
    }
    onSaved(type)
    onClose()
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={request !== null}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request ? TITLE[request.mode] : 'Wall type'}</DialogTitle>
          <DialogDescription>
            List the layers from the outside in, around one framing core. Walls already drawn
            keep their layers; walls drawn from now on use the saved type.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <input
            className={FIELD_CLASS}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[7.5rem_1fr_5.5rem_4.75rem] gap-1.5 px-0.5 text-[11px] text-muted-foreground">
            <span>Layer</span>
            <span>Material</span>
            <span className="text-right">Thickness</span>
            <span />
          </div>
          <div className="px-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
            Outside
          </div>
          {layers.map((layer, index) => (
            <div
              className="grid grid-cols-[7.5rem_1fr_5.5rem_4.75rem] items-center gap-1.5"
              data-wall-type-layer={layer.role}
              key={layer.key}
            >
              {layer.role === 'core' ? (
                <span className="px-0.5 font-medium text-xs">{ROLE_LABEL.core}</span>
              ) : (
                <select
                  aria-label="Layer role"
                  className={FIELD_CLASS}
                  onChange={(event) => {
                    const role = event.target.value as Exclude<DraftRole, 'core'>
                    const fresh = layerOf(role)
                    update(layer.key, {
                      role,
                      material: fresh.material,
                      thickness: fresh.thickness,
                    })
                  }}
                  value={layer.role}
                >
                  {ADDABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
              )}
              {layer.role === 'core' ? (
                <select
                  aria-label="Framing core"
                  className={FIELD_CLASS}
                  onChange={(event) => {
                    const core = WALL_TYPE_CORES.find((entry) => entry.id === event.target.value)
                    if (core)
                      update(layer.key, { material: core.id, thickness: core.thickness })
                  }}
                  value={layer.material}
                >
                  {WALL_TYPE_CORES.map((core) => (
                    <option key={core.id} value={core.id}>
                      {core.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label="Material"
                  className={FIELD_CLASS}
                  disabled={layer.role === 'air'}
                  onChange={(event) => {
                    const option = LAYER_MATERIALS[layer.role as Exclude<DraftRole, 'core'>].find(
                      (entry) => entry.value === event.target.value,
                    )
                    if (option)
                      update(layer.key, { material: option.value, thickness: option.thickness })
                  }}
                  value={layer.material}
                >
                  {LAYER_MATERIALS[layer.role as Exclude<DraftRole, 'core'>].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {LAYER_MATERIALS[layer.role as Exclude<DraftRole, 'core'>].some(
                    (option) => option.value === layer.material,
                  ) ? null : (
                    <option value={layer.material}>{layer.material}</option>
                  )}
                </select>
              )}
              {layer.role === 'core' ? (
                <span className="px-2 text-right text-xs tabular-nums">
                  {formatLayerThickness(layer.thickness, unit)}
                </span>
              ) : (
                <ThicknessField
                  metres={layer.thickness}
                  onCommit={(thickness) => update(layer.key, { thickness })}
                  unit={unit}
                />
              )}
              <div className="flex items-center justify-end gap-0.5">
                <button
                  aria-label="Move out"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  aria-label="Move in"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={index === layers.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  aria-label="Remove layer"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  // The core stays: a wall type frames around exactly one.
                  disabled={layer.role === 'core'}
                  onClick={() =>
                    setLayers((current) => current.filter((entry) => entry.key !== layer.key))
                  }
                  title={layer.role === 'core' ? 'Every wall type has one framing core' : undefined}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="px-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
            Inside
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground">Add</span>
            {ADDABLE_ROLES.map((role) => (
              <button
                className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                disabled={full}
                key={role}
                onClick={() =>
                  setLayers((current) => {
                    if (current.length >= WALL_TYPE_LAYER_LIMIT) return current
                    const next = [...current]
                    next.splice(insertIndex(current, role), 0, layerOf(role))
                    return next
                  })
                }
                title={full ? fullReason : undefined}
                type="button"
              >
                <Plus className="size-3" />
                {ROLE_LABEL[role]}
              </button>
            ))}
            {full ? (
              <span className="text-[11px] text-muted-foreground" data-wall-type-layers-full>
                {fullReason} Remove one to add another.
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-black/4 px-3 py-2 dark:bg-muted/40">
          <span className="text-muted-foreground text-xs">
            {placement === 'exterior'
              ? 'Lists under Exterior: it has a cladding side.'
              : 'Lists under Interior: both faces match.'}
          </span>
          <span className="font-medium text-sm tabular-nums">
            Total {formatLayerThickness(total, unit)}
          </span>
        </div>
        {failure ? (
          <p className="text-destructive text-xs">{WALL_TYPE_SAVE_FAILURE[failure]}</p>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            Save wall type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
