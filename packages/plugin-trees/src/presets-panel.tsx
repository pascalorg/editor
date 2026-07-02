'use client'

import { useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, ToggleControl, useEditor } from '@pascal-app/editor'
import { FLOWER_PRESET_LIST } from './flower-presets'
import type { FlowerPreset } from './flower-schema'
import { GRASS_PRESET_LIST } from './grass-presets'
import type { GrassPreset } from './grass-schema'
import { TREE_PRESET_LIST } from './presets'
import type { TreePreset } from './schema'
import { type TreesPanelMode as Mode, useTreesStore } from './store'

const KIND: Record<Mode, string> = {
  trees: 'trees:tree',
  flowers: 'trees:flower',
  grass: 'trees:grass',
}
const NOUN: Record<Mode, string> = { trees: 'tree', flowers: 'flower', grass: 'grass' }

/**
 * The plugin's left-rail panel. A Trees / Flowers / Grass segmented control
 * switches the brush; picking a preset arms placement for that kind
 * (`setTool('trees:*')` + build mode). The count chip reads the scene reactively,
 * closing the triangle: panel → store → tool → scene → panel. It composes the
 * host's exported controls (`SegmentedControl`/`SliderControl`/`ToggleControl`)
 * so the brush matches the right-hand inspector pixel-for-pixel.
 */
export default function TreesPanel() {
  // Section lives in the plugin store (not local state) so "find in catalog"
  // can point the panel at the found node's section — see find-sync.ts.
  const mode = useTreesStore((s) => s.mode)
  const setMode = useTreesStore((s) => s.setMode)
  const activeTool = useEditor((s) => s.tool)
  const count = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === KIND[mode]).length,
  )

  const arming = activeTool === KIND[mode]

  return (
    <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Nature</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {count} planted
          </span>
        </div>
        <SegmentedControl
          onChange={setMode}
          options={[
            { label: 'Trees', value: 'trees' },
            { label: 'Flowers', value: 'flowers' },
            { label: 'Grass', value: 'grass' },
          ]}
          value={mode}
        />
        <p className="text-sidebar-foreground/50 text-xs">
          {arming
            ? 'Click the ground to plant. Press Esc to stop.'
            : `Pick ${mode === 'grass' ? 'a grass' : `a ${NOUN[mode]}`}, then click the ground.`}
        </p>
      </header>

      {mode === 'trees' && <TreesSection arming={arming} />}
      {mode === 'flowers' && <FlowersSection arming={arming} />}
      {mode === 'grass' && <GrassSection arming={arming} />}

      <footer className="-mx-4 -mb-4 sticky bottom-0 mt-1 border-sidebar-border/50 border-t bg-sidebar px-4 py-3 text-[11px] text-sidebar-foreground/50 leading-relaxed">
        Trees generated with{' '}
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-sidebar-foreground/70"
          href="https://github.com/dgreenheck/ez-tree"
          rel="noreferrer"
          target="_blank"
        >
          ez-tree
        </a>{' '}
        by{' '}
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-sidebar-foreground/70"
          href="https://x.com/dangreenheck"
          rel="noreferrer"
          target="_blank"
        >
          Daniel Greenheck
        </a>{' '}
        (MIT).
      </footer>
    </div>
  )
}

function TreesSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.preset)
  const size = useTreesStore((s) => s.size)
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
      {selected !== 'trellis' && (
        <div className="flex flex-col gap-2">
          <SegmentedControl
            onChange={useTreesStore.getState().setSize}
            options={[
              { label: 'S', value: 'small' },
              { label: 'M', value: 'medium' },
              { label: 'L', value: 'large' },
            ]}
            value={size}
          />
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <SliderControl
          label="Height"
          max={15}
          min={1}
          onChange={useTreesStore.getState().setHeight}
          precision={1}
          restoreOnCommit={false}
          step={0.5}
          unit="m"
          value={height}
        />
        {!leafless && (
          <SliderControl
            label="Foliage"
            max={1.5}
            min={0}
            onChange={useTreesStore.getState().setFoliageDensity}
            precision={1}
            restoreOnCommit={false}
            step={0.1}
            value={foliageDensity}
          />
        )}
        <SliderControl
          label="Trunk"
          max={2.5}
          min={0.3}
          onChange={useTreesStore.getState().setTrunkThickness}
          precision={1}
          restoreOnCommit={false}
          step={0.1}
          value={trunkThickness}
        />
        <ToggleControl
          checked={leafless}
          label="Bare (leafless)"
          onChange={useTreesStore.getState().setLeafless}
        />
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
      <SliderControl
        label="Height"
        max={2}
        min={0.2}
        onChange={useTreesStore.getState().setFlowerHeight}
        precision={2}
        restoreOnCommit={false}
        step={0.05}
        unit="m"
        value={height}
      />
    </>
  )
}

function GrassSection({ arming }: { arming: boolean }) {
  const selected = useTreesStore((s) => s.grassPreset)
  const height = useTreesStore((s) => s.grassHeight)

  const activate = (preset: GrassPreset) => {
    useTreesStore.getState().setGrassPreset(preset)
    useEditor.getState().setTool('trees:grass')
    useEditor.getState().setMode('build')
  }

  return (
    <>
      <PresetGrid items={GRASS_PRESET_LIST} onPick={activate} selected={arming ? selected : null} />
      <SliderControl
        label="Height"
        max={2}
        min={0.1}
        onChange={useTreesStore.getState().setGrassHeight}
        precision={2}
        restoreOnCommit={false}
        step={0.05}
        unit="m"
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
  items: ReadonlyArray<{ id: T; label: string; thumbnail: string }>
  selected: T | null
  onPick: (id: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => {
        const isSelected = selected === item.id
        return (
          <button
            className={`group relative flex flex-col gap-2 rounded-xl border p-2 transition-all ${
              isSelected
                ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
            }`}
            key={item.id}
            onClick={() => onPick(item.id)}
            type="button"
          >
            <img
              alt=""
              aria-hidden
              className="aspect-square w-full rounded-lg bg-[#f3f4f6] object-cover ring-1 ring-black/10 transition-transform group-hover:scale-[1.02]"
              src={item.thumbnail}
            />
            <span className="pl-0.5 font-medium text-xs">{item.label}</span>
            {isSelected && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar-accent" />
            )}
          </button>
        )
      })}
    </div>
  )
}
