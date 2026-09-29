'use client'

import {
  type AnyNode,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { MaterialPicker } from './material-picker'

type Swatch = { label: string; color: string | null; image: string | null }

/** How a finish reference reads in a panel: its catalog tile, its colour, or its scene material. */
function useFinishSwatch(ref: string | undefined, fallback: string): Swatch {
  const materials = useScene((state) => state.materials)
  if (!ref) return { ...describe(fallback, materials), label: 'Default' }
  return describe(ref, materials)
}

function describe(ref: string, materials: ReturnType<typeof useScene.getState>['materials']) {
  const library = getCatalogMaterialById(getLibraryMaterialIdFromRef(ref) ?? undefined)
  if (library)
    return {
      label: library.label,
      color: library.previewColor ?? null,
      image: library.previewThumbnailUrl ?? null,
    }
  const sceneId = getSceneMaterialIdFromRef(ref)
  const scene = sceneId ? materials[sceneId as keyof typeof materials] : undefined
  if (scene) return { label: scene.name, color: scene.material.properties?.color ?? null, image: null }
  if (ref.startsWith('#')) return { label: ref.toUpperCase(), color: ref, image: null }
  return { label: 'Default', color: null, image: null }
}

/**
 * Paints one surface of a node from its panel, exactly as the paint tool does:
 * the kind's own paint commit for that role (same write, one undo step).
 */
export function paintSurface(node: AnyNode, role: string, materialPreset: string) {
  const paint = nodeRegistry.get(node.type)?.capabilities?.paint
  if (!paint) return
  const args = { node, role, material: undefined, materialPreset }
  if (paint.commit) paint.commit(args)
  else useScene.getState().updateNode(node.id, paint.buildPatch(args) as Partial<AnyNode>)
}

/**
 * A finish row: the swatch and its name. A click opens the paint tool's
 * material picker; a pick paints the surface through the paint tool's path.
 */
export function FinishSwatch({
  label,
  node,
  role,
  value,
  fallback,
  hint,
}: {
  label: string
  node: AnyNode
  /** The paint role of the surface (`edge`, `foundation`, …). */
  role: string
  /** The authored finish reference; absent shows `fallback` as "Default". */
  value: string | undefined
  fallback: string
  /** Tooltip on the row. */
  hint?: string
}) {
  const [open, setOpen] = useState(false)
  const swatch = useFinishSwatch(value, fallback)
  return (
    <div className="flex min-h-8 items-center justify-between gap-3" title={hint}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={`${label}: ${swatch.label}`}
            className="flex min-w-0 items-center gap-2 rounded-full border border-border/50 py-0.5 pr-2.5 pl-1 text-xs transition-colors hover:bg-accent"
            data-finish-swatch={label}
            type="button"
          >
            <span
              aria-hidden
              className="size-4 shrink-0 overflow-hidden rounded-full border border-border/50"
              style={{ backgroundColor: swatch.color ?? 'transparent' }}
            >
              {swatch.image && <img alt="" className="size-full object-cover" src={swatch.image} />}
            </span>
            <span className="truncate">{swatch.label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex h-96 w-80 flex-col p-2" side="left">
          <MaterialPicker
            onSelectMaterialPreset={(ref) => {
              const live = useScene.getState().nodes[node.id as keyof ReturnType<typeof useScene.getState>['nodes']]
              if (live) paintSurface(live, role, ref)
              setOpen(false)
            }}
            selectOnCategoryChange={false}
            selectedMaterialPreset={value}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
