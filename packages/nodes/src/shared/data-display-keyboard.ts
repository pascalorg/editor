import {
  type AnyNodeId,
  type DataChartNode,
  type DataTableNode,
  type DataWidgetNode,
  useScene,
} from '@pascal-app/core'
import type { KeyboardEvent } from 'react'

type DataDisplayNode = DataWidgetNode | DataChartNode | DataTableNode

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
const NUDGE_STEP = 0.02
const NUDGE_STEP_FINE = 0.005
const NUDGE_STEP_COARSE = 0.1

function getStep(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey) return NUDGE_STEP_FINE
  if (event.shiftKey) return NUDGE_STEP_COARSE
  return NUDGE_STEP
}

function getNudgedPosition(node: DataDisplayNode, event: KeyboardEvent<HTMLElement>): [number, number, number] | null {
  if (!ARROW_KEYS.has(event.key)) return null

  const step = getStep(event)
  const [x, y, z] = node.position

  if (event.metaKey || event.ctrlKey) {
    if (event.key === 'ArrowUp') return [x, y + step, z]
    if (event.key === 'ArrowDown') return [x, y - step, z]
    return null
  }

  if (event.key === 'ArrowLeft') return [x - step, y, z]
  if (event.key === 'ArrowRight') return [x + step, y, z]
  if (event.key === 'ArrowUp') return [x, y, z - step]
  if (event.key === 'ArrowDown') return [x, y, z + step]
  return null
}

export function handleDataDisplayKeyboardNudge(event: KeyboardEvent<HTMLElement>, node: DataDisplayNode): boolean {
  const position = getNudgedPosition(node, event)
  if (!position) return false

  event.preventDefault()
  event.stopPropagation()
  useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: { position } }])
  return true
}
