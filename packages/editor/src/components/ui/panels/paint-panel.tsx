'use client'

import useEditor from '../../../store/use-editor'
import { Input } from '../primitives/input'
import { PanelSection } from '../controls/panel-section'
import { PanelWrapper } from './panel-wrapper'

function buildDefaultCustomMaterial() {
  return {
    preset: 'custom' as const,
    properties: {
      color: '#ffffff',
      roughness: 0.5,
      metalness: 0,
      opacity: 1,
      transparent: false,
      side: 'front' as const,
    },
  }
}

export function PaintPanel() {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setPaintPanelOpen = useEditor((state) => state.setPaintPanelOpen)

  const customMaterial =
    activePaintMaterial?.material?.properties && !activePaintMaterial.materialPreset
      ? activePaintMaterial.material
      : null

  if (!customMaterial) return null

  const currentProps = customMaterial.properties ?? buildDefaultCustomMaterial().properties

  const updateCustomMaterial = (
    updates: Partial<typeof currentProps>,
    nextTransparent = currentProps.transparent,
  ) => {
    setActivePaintMaterial({
      material: {
        preset: 'custom',
        properties: {
          ...currentProps,
          ...updates,
          transparent: nextTransparent,
        },
      },
      category: 'other',
      sourceTarget: activePaintMaterial?.sourceTarget ?? activePaintTarget,
    })
  }

  return (
    <PanelWrapper
      onClose={() => setPaintPanelOpen(false)}
      title="Material"
      width={320}
    >
      <PanelSection title="Custom Material">
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
              Color
            </label>
            <div className="flex items-center gap-2">
              <input
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-transparent"
                onChange={(e) => updateCustomMaterial({ color: e.target.value })}
                type="color"
                value={currentProps.color}
              />
              <Input
                onChange={(e) => updateCustomMaterial({ color: e.target.value })}
                value={currentProps.color}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
                Roughness
              </label>
              <span className="font-mono text-muted-foreground text-xs">
                {currentProps.roughness.toFixed(2)}
              </span>
            </div>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
              max={1}
              min={0}
              onChange={(e) => updateCustomMaterial({ roughness: Number.parseFloat(e.target.value) })}
              step={0.01}
              type="range"
              value={currentProps.roughness}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
                Metalness
              </label>
              <span className="font-mono text-muted-foreground text-xs">
                {currentProps.metalness.toFixed(2)}
              </span>
            </div>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
              max={1}
              min={0}
              onChange={(e) => updateCustomMaterial({ metalness: Number.parseFloat(e.target.value) })}
              step={0.01}
              type="range"
              value={currentProps.metalness}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
                Opacity
              </label>
              <span className="font-mono text-muted-foreground text-xs">
                {currentProps.opacity.toFixed(2)}
              </span>
            </div>
            <input
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
              max={1}
              min={0}
              onChange={(e) => {
                const opacity = Number.parseFloat(e.target.value)
                updateCustomMaterial({ opacity }, opacity < 1 || currentProps.transparent)
              }}
              step={0.01}
              type="range"
              value={currentProps.opacity}
            />
          </div>

          <div className="space-y-2">
            <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
              Side
            </label>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              onChange={(e) =>
                updateCustomMaterial({ side: e.target.value as 'front' | 'back' | 'double' })
              }
              value={currentProps.side}
            >
              <option value="front">Front</option>
              <option value="back">Back</option>
              <option value="double">Double</option>
            </select>
          </div>
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}
