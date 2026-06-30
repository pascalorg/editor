'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useState } from 'react'
import { FLOWER_PRESET_LIST } from './flower-presets'
import type { FlowerPreset } from './flower-schema'
import { TREE_PRESET_LIST } from './presets'
import type { TreePreset } from './schema'
import { useTreesStore } from './store'

type Mode = 'trees' | 'flowers'

/**
 * The plugin's left-rail panel. A Trees / Flowers toggle switches the brush;
 * picking a preset arms placement for that kind (`setTool('trees:tree' |
 * 'trees:flower')` + build mode). The count chip reads the scene reactively,
 * closing the triangle: panel → store → tool → scene → panel. Scoped styling +
 * host sidebar CSS variables keep it native.
 */
export default function TreesPanel() {
  const [mode, setMode] = useState<Mode>('trees')
  const activeTool = useEditor((s) => s.tool)
  const treeCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === 'trees:tree').length,
  )
  const flowerCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === 'trees:flower').length,
  )

  const arming = mode === 'trees' ? activeTool === 'trees:tree' : activeTool === 'trees:flower'
  const count = mode === 'trees' ? treeCount : flowerCount

  return (
    <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Plant</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {count} planted
          </span>
        </div>
        <div className="flex gap-1 rounded-full bg-sidebar-accent/40 p-0.5">
          {(['trees', 'flowers'] as const).map((m) => (
            <button
              className={`flex-1 rounded-full px-3 py-1 text-xs capitalize transition-colors ${
                mode === m ? 'bg-sidebar-accent font-medium' : 'text-sidebar-foreground/60'
              }`}
              key={m}
              onClick={() => setMode(m)}
              type="button"
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-sidebar-foreground/50 text-xs">
          {arming
            ? 'Click the ground to plant. Press Esc to stop.'
            : `Pick a ${mode === 'trees' ? 'tree' : 'flower'}, then click the ground.`}
        </p>
      </header>

      {mode === 'trees' ? <TreesSection arming={arming} /> : <FlowersSection arming={arming} />}
    </div>
  )
}

function TreesSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.preset)
  const height = useTreesStore((s) => s.height)
  const foliageDensity = useTreesStore((s) => s.foliageDensity)
  const trunkThickness = useTreesStore((s) => s.trunkThickness)
  const leafless = useTreesStore((s) => s.leafless)

  const activate = (preset: TreePreset) => {
    useTreesStore.getState().setPreset(preset)
    useEditor.getState().setTool('trees:tree')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid items={TREE_PRESET_LIST} onPick={activate} selected={arming ? selected : null} />
      <div className="flex flex-col gap-3">
        <Slider
          label="Height"
          max={15}
          min={1}
          onChange={useTreesStore.getState().setHeight}
          step={0.5}
          suffix=" m"
          value={height}
        />
        <Slider
          disabled={leafless}
          label="Foliage"
          max={1.5}
          min={0}
          onChange={useTreesStore.getState().setFoliageDensity}
          step={0.1}
          value={foliageDensity}
        />
        <Slider
          label="Trunk"
          max={2.5}
          min={0.3}
          onChange={useTreesStore.getState().setTrunkThickness}
          step={0.1}
          value={trunkThickness}
        />
        <label className="flex cursor-pointer items-center justify-between text-xs">
          <span className="text-sidebar-foreground/70">Bare (leafless)</span>
          <input
            checked={leafless}
            className="accent-sidebar-ring"
            onChange={(e) => useTreesStore.getState().setLeafless(e.target.checked)}
            type="checkbox"
          />
        </label>
      </div>
    </>
  )
}

function FlowersSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.flowerPreset)
  const height = useTreesStore((s) => s.flowerHeight)

  const activate = (preset: FlowerPreset) => {
    useTreesStore.getState().setFlowerPreset(preset)
    useEditor.getState().setTool('trees:flower')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid
        items={FLOWER_PRESET_LIST}
        onPick={activate}
        selected={arming ? selected : null}
      />
      <Slider
        label="Height"
        max={2}
        min={0.2}
        onChange={useTreesStore.getState().setFlowerHeight}
        step={0.05}
        suffix=" m"
        value={height}
      />
    </>
  )
}

function PresetGrid<T extends string>({
  items,
  selected,
  onPick,
}: {
  items: ReadonlyArray<{ id: T; label: string; swatch: string }>
  selected: T | null
  onPick: (id: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const isSelected = selected === item.id
        return (
          <button
            className={`group relative flex flex-col items-center gap-2 rounded-xl border p-3 transition-all ${
              isSelected
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            key={item.id}
            onClick={() => onPick(item.id)}
            type="button"
          >
            <span
              aria-hidden
              className="h-12 w-12 rounded-full ring-1 ring-black/10 transition-transform group-hover:scale-105"
              style={{
                background: `radial-gradient(circle at 35% 30%, ${item.swatch}, ${item.swatch}cc 60%, ${item.swatch}88)`,
              }}
            />
            <span className="font-medium text-xs">{item.label}</span>
            {isSelected && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-sidebar-ring" />
            )}
          </button>
        )
      })}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${disabled ? 'opacity-40' : ''}`}>
      <span className="flex items-center justify-between text-xs">
        <span className="text-sidebar-foreground/70">{label}</span>
        <span className="tabular-nums text-sidebar-foreground/50">
          {value.toFixed(1)}
          {suffix}
        </span>
      </span>
      <input
        className="accent-sidebar-ring"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}
