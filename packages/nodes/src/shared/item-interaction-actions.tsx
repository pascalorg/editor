'use client'
import { type AnyNodeId, useInteractive, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Lightbulb, LightbulbOff, Play, Square } from 'lucide-react'
import {
  itemHasLights,
  itemHasMechanisms,
  itemLightsOn,
  itemMechanismsOn,
  toggleItemLights,
  toggleItemMechanisms,
} from './item-interactions'

const BUTTON =
  'tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
const ACTIVE = 'bg-accent text-foreground'

/** Play/stop and light switches for a single selected item or procedural item. */
export default function ItemInteractionActions() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const node = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const hasMechanisms = itemHasMechanisms(node)
  const hasLights = itemHasLights(node)
  const running = useInteractive((s) => (node && hasMechanisms ? itemMechanismsOn(node, s) : false))
  const lit = useInteractive((s) => (node && hasLights ? itemLightsOn(node, s) : false))
  if (!node) return null
  return (
    <>
      {hasMechanisms && (
        <button
          type="button"
          aria-label={running ? 'Stop' : 'Play'}
          title={running ? 'Stop' : 'Play'}
          aria-pressed={running}
          className={`${BUTTON} ${running ? ACTIVE : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            toggleItemMechanisms(node)
          }}
        >
          {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      )}
      {hasLights && (
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
      )}
    </>
  )
}
