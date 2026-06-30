'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { TREE_PRESET_LIST } from './presets'
import type { TreePreset } from './schema'
import { useTreesStore } from './store'

/**
 * The plugin's own left-rail panel. Picking a preset arms placement
 * (`setTool('trees:tree')` + `setMode('build')`); the height slider seeds the
 * next tree's height. The "N planted" counter reads the scene reactively,
 * closing the triangle: panel → store → tool → scene → panel.
 *
 * Styling is scoped and uses the host sidebar CSS variables so it reads native
 * without leaking globals.
 */
export default function TreesPanel() {
  const selected = useTreesStore((s) => s.preset)
  const height = useTreesStore((s) => s.height)
  const setHeight = useTreesStore((s) => s.setHeight)
  const activeTool = useEditor((s) => s.tool)
  const treeCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === 'trees:tree').length,
  )

  const arming = activeTool === 'trees:tree'

  const activate = (preset: TreePreset) => {
    useTreesStore.getState().setPreset(preset)
    useEditor.getState().setTool('trees:tree')
    useEditor.getState().setMode('build')
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-sidebar-foreground">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Trees</h2>
          <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-sidebar-foreground/70 text-xs">
            {treeCount} planted
          </span>
        </div>
        <p className="text-sidebar-foreground/50 text-xs">
          {arming
            ? 'Click the ground to plant. Press Esc to stop.'
            : 'Pick a tree, then click the ground to plant.'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {TREE_PRESET_LIST.map((spec) => {
          const isSelected = selected === spec.id && arming
          return (
            <button
              className={`group relative flex flex-col items-center gap-2 overflow-hidden rounded-xl border p-3 transition-all ${
                isSelected
                  ? 'border-sidebar-ring bg-sidebar-accent shadow-sm'
                  : 'border-sidebar-border hover:border-sidebar-ring/50 hover:bg-sidebar-accent/40'
              }`}
              key={spec.id}
              onClick={() => activate(spec.id)}
              type="button"
            >
              <span
                aria-hidden
                className="h-12 w-12 rounded-full ring-1 ring-black/10 transition-transform group-hover:scale-105"
                style={{
                  background: `radial-gradient(circle at 35% 30%, ${spec.swatch}, ${spec.swatch}cc 60%, ${spec.swatch}88)`,
                }}
              />
              <span className="font-medium text-xs">{spec.label}</span>
              {isSelected && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-sidebar-ring" />
              )}
            </button>
          )
        })}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs">
          <span className="text-sidebar-foreground/70">Height</span>
          <span className="tabular-nums text-sidebar-foreground/50">{height.toFixed(1)} m</span>
        </span>
        <input
          className="accent-sidebar-ring"
          max={15}
          min={1}
          onChange={(e) => setHeight(Number(e.target.value))}
          step={0.5}
          type="range"
          value={height}
        />
      </label>
    </div>
  )
}
