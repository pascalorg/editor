'use client'
import { type AnyNodeId, useInteractive, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Lightbulb, LightbulbOff } from 'lucide-react'
import { itemHasLights, itemLightsOn, toggleItemLights } from './item-interactions'

const BUTTON =
  'tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
const ACTIVE = 'bg-accent text-foreground'

/**
 * The light switch for a single selected item or procedural item. Play/Stop
 * comes from the action menu's `capabilities.mechanism` button.
 */
export default function ItemInteractionActions() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const node = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const hasLights = itemHasLights(node)
  const lit = useInteractive((s) => (node && hasLights ? itemLightsOn(node, s) : false))
  if (!(node && hasLights)) return null
  return (
    <button
      type="button"
      aria-label={lit ? 'Turn light off' : 'Turn light on'}
      title={lit ? 'Turn light off' : 'Turn light on'}
      aria-pressed={lit}
      className={`${BUTTON} ${lit ? ACTIVE : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        toggleItemLights(node)
      }}
    >
      {lit ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
    </button>
  )
}
