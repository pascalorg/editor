'use client'

import { MaterialPaintPanel, TerrainSculptPanel, triggerSFX, useEditor } from '@pascal-app/editor'
import type { XRWandBuildItem } from '@webxr/plugin'
import type { PascalXRWandBindings } from '@webxr/plugin/pascal-editor'
import Image from 'next/image'
import { useEffect, useRef } from 'react'
import {
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofFootprintSource,
  activateRoofType,
  activateSelectMode,
  activateTerrainSculptMode,
  collectBuildTypes,
  collectRoofFeatures,
  MEP_ITEMS,
} from '@/lib/build-palette'
import { useBuildPanelModel, useBuildToolOptions } from '@/lib/build-panel-model'
import { getRoofFootprintSources, ROOF_TYPE_OPTIONS } from '@/lib/build-tab-state'
import { cn } from '@/lib/utils'

export const webXRWandBindings: PascalXRWandBindings = {
  useBuildPalette: useBuildPanelModel,
  useToolOptions: useBuildToolOptions,
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofType,
  activateTerrainSculptMode,
  activateRoofFootprintSource,
  activateSelectMode: () => {
    activateSelectMode()
    useEditor.getState().setTool(null)
  },
  collectBuildTypes,
  collectRoofFeatures,
  getRoofFootprintSources,
  roofTypeOptions: ROOF_TYPE_OPTIONS,
  xrMepItems: MEP_ITEMS,
}

function PaletteItem({ item, compact = false }: { item: XRWandBuildItem; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-pressed={item.active}
      title={item.label}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl p-2 text-xs',
        compact && 'aspect-square p-1',
        item.active
          ? 'bg-primary/10 ring-1 ring-primary/50'
          : 'bg-muted/40 opacity-70 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
      )}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        item.onSelect()
      }}
      onMouseEnter={() => triggerSFX('sfx:menu-hover')}
    >
      {item.icon?.src && (
        <Image
          alt=""
          src={item.icon.src}
          width={48}
          height={48}
          className="aspect-square w-full object-contain"
        />
      )}
      {!compact && item.label}
    </button>
  )
}

export function BuildTab() {
  const model = useBuildPanelModel()
  const options = useBuildToolOptions()
  const mode = useEditor((state) => state.mode)
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const editor = useEditor.getState()
    if (editor.mode === 'build' && editor.tool) return
    model.items[0]?.onSelect()
  }, [model.items])
  const sections = new Map<string, XRWandBuildItem[]>()
  for (const item of model.secondaryItems ?? []) {
    const name = item.section ?? model.secondaryTitle ?? 'Options'
    sections.set(name, [...(sections.get(name) ?? []), item])
  }
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div
        className="grid shrink-0 gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
      >
        {model.items.map((item) => (
          <PaletteItem key={item.id} item={item} compact />
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {model.detailMode === 'paint' ? (
          <MaterialPaintPanel />
        ) : mode === 'terrain-sculpt' ? (
          <TerrainSculptPanel />
        ) : (
          <>
            {[...sections].map(([label, items]) => (
              <section key={label} className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((item) => (
                    <PaletteItem key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
            {options.map((option) => (
              <section key={option.id} className="space-y-2 border-t border-border/50 pt-3">
                <div className="text-xs font-medium text-muted-foreground">{option.label}</div>
                <div className="flex gap-1.5">
                  {option.choices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={option.value === choice.value}
                      className={cn(
                        'flex-1 rounded-lg px-2 py-2 text-xs',
                        option.value === choice.value
                          ? 'bg-primary/10 ring-1 ring-primary/50'
                          : 'bg-muted/40',
                      )}
                      onClick={() => {
                        triggerSFX('sfx:menu-click')
                        option.set(choice.value)
                      }}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {option.choices.find((choice) => choice.value === option.value)?.description}
                </p>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
