'use client'

import { useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { TREE_PRESET_LIST } from './presets'
import type { TreePreset } from './schema'
import { useTreesStore } from './store'

/**
 * The plugin's own left-rail panel. Clicking a preset card writes the choice
 * into the plugin store and arms placement (`setTool('trees:tree')` +
 * `setMode('build')`) — mirroring how the community catalog activates the item
 * tool. The "N planted" counter reads the scene reactively, closing the
 * communication triangle: panel → store → tool → scene → panel.
 *
 * Styling is scoped + uses the host's sidebar CSS variables so it looks native
 * without leaking globals.
 */
export default function TreesPanel() {
  const selected = useTreesStore((s) => s.preset)
  const setPreset = useTreesStore((s) => s.setPreset)
  const activeTool = useEditor((s) => s.tool)
  const treeCount = useScene(
    (s) => Object.values(s.nodes).filter((n) => (n.type as string) === 'trees:tree').length,
  )

  const activate = (preset: TreePreset) => {
    setPreset(preset)
    useEditor.getState().setTool('trees:tree')
    useEditor.getState().setMode('build')
  }

  const arming = activeTool === 'trees:tree'

  return (
    <div className="flex flex-col gap-3 p-3 text-sidebar-foreground">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-sm">Trees</h2>
        <span className="text-sidebar-foreground/50 text-xs">{treeCount} planted</span>
      </div>
      <p className="text-sidebar-foreground/50 text-xs">
        {arming ? 'Click the ground to plant. Esc to stop.' : 'Pick a tree, then click the ground.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TREE_PRESET_LIST.map((spec) => {
          const isSelected = selected === spec.id && arming
          return (
            <button
              key={spec.id}
              type="button"
              onClick={() => activate(spec.id)}
              className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors ${
                isSelected
                  ? 'border-sidebar-ring bg-sidebar-accent'
                  : 'border-sidebar-border hover:bg-sidebar-accent/50'
              }`}
            >
              <span
                aria-hidden
                className="h-8 w-8 rounded-full"
                style={{ backgroundColor: spec.foliageColor }}
              />
              <span className="text-xs">{spec.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
