'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  parseDimensionInput,
  planDimensionDrive,
  resolveDimensionDrive,
} from '../../../lib/floorplan/dimension-drive'

/**
 * Click-to-type dimensions — WS3.
 *
 * Single-clicking a dimension label opens an inline input over the label
 * plate, pre-filled with the current text. Enter commits, Esc cancels.
 * Committing DRIVES geometry: the anchor the dimension runs toward moves
 * along the dimension direction by the delta, and connected wall junctions
 * follow (`planDimensionDrive`). When nothing bindable is under the far
 * anchor the value is written as `textOverride` on a construction-dimension
 * node instead, and the label renders an "override" badge.
 *
 * The label is found by DOM delegation on the attributes
 * `floorplan-dimension-renderer.tsx` emits, so this works identically for
 * `dimension` and `dimension-string` geometry, for automatic wall dimensions,
 * contextual dimensions and manual construction-dimension nodes — and on
 * sheets, which mount the same renderer.
 */

type EditTarget = {
  ownerNodeId: AnyNodeId
  text: string
  value: number
  witnessStart: [number, number]
  witnessEnd: [number, number]
  rect: { left: number; top: number; width: number; height: number }
}

const MIN_INPUT_WIDTH_PX = 76

export function FloorplanDimensionEditOverlay(): React.ReactElement | null {
  const [target, setTarget] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const unit = useViewer((state) => state.unit)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const origin = event.target as Element | null
      const hit = origin?.closest?.('[data-floorplan-dimension-hit]')
      if (!hit) return
      const label = hit.closest('[data-floorplan-annotation-label]')
      const owner = hit.closest('[data-node-id]')
      const ownerNodeId = owner?.getAttribute('data-node-id')
      if (!label || !ownerNodeId) return

      const value = number(label.getAttribute('data-floorplan-dimension-value'))
      const witnessStart = point(
        label.getAttribute('data-floorplan-dimension-witness-start-x'),
        label.getAttribute('data-floorplan-dimension-witness-start-y'),
      )
      const witnessEnd = point(
        label.getAttribute('data-floorplan-dimension-witness-end-x'),
        label.getAttribute('data-floorplan-dimension-witness-end-y'),
      )
      if (value === null || !witnessStart || !witnessEnd) return

      event.preventDefault()
      event.stopPropagation()
      const box = label.getBoundingClientRect()
      const text = label.getAttribute('data-floorplan-dimension-text') ?? ''
      setTarget({
        ownerNodeId: ownerNodeId as AnyNodeId,
        text,
        value,
        witnessStart,
        witnessEnd,
        rect: {
          left: box.left + box.width / 2,
          top: box.top + box.height / 2,
          width: Math.max(MIN_INPUT_WIDTH_PX, box.width + 24),
          height: Math.max(22, box.height + 6),
        },
      })
      setDraft(text)
      setError(null)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    if (!target) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [target])

  const commit = useCallback(() => {
    if (!target) return
    const nextLength = parseDimensionInput(draft, unit)
    if (nextLength === null) {
      setError(`Cannot read "${draft.trim()}"`)
      return
    }
    const outcome = commitDimensionValue({ target, nextLength })
    if (!outcome.ok) {
      setError(outcome.reason)
      return
    }
    setTarget(null)
    setError(null)
  }, [draft, target, unit])

  if (!target) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[70]"
      data-floorplan-dimension-edit-overlay=""
    >
      <div
        className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: target.rect.left, top: target.rect.top, width: target.rect.width }}
      >
        <input
          className="w-full rounded-sm border border-primary bg-card px-1 py-0.5 text-center font-mono text-foreground text-xs shadow-sm outline-none"
          onBlur={() => setTarget(null)}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setTarget(null)
              setError(null)
            }
            event.stopPropagation()
          }}
          ref={inputRef}
          spellCheck={false}
          value={draft}
        />
        {error ? (
          <div className="mt-0.5 whitespace-nowrap rounded-sm bg-card px-1 text-[10px] text-destructive shadow-sm">
            {error}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

type CommitOutcome = { ok: true } | { ok: false; reason: string }

/**
 * Apply a typed dimension value. Exported for tests — it is the seam between
 * the pure drive math and the scene store.
 */
export function commitDimensionValue(args: {
  target: Pick<EditTarget, 'ownerNodeId' | 'witnessStart' | 'witnessEnd' | 'value'>
  nextLength: number
}): CommitOutcome {
  const store = useScene.getState()
  const nodes = store.nodes as Readonly<Record<string, AnyNode>>
  const resolution = resolveDimensionDrive({
    nodes,
    ownerNodeId: args.target.ownerNodeId,
    start: args.target.witnessStart,
    end: args.target.witnessEnd,
  })

  if (!resolution.drivable) {
    // Fallback: annotate rather than move. Only a construction-dimension
    // node can carry an override — anything else has nowhere to put it.
    const owner = nodes[args.target.ownerNodeId]
    if (owner?.type !== 'construction-dimension') {
      return { ok: false, reason: `Not drivable — ${resolution.reason}` }
    }
    store.updateNode(args.target.ownerNodeId, {
      textOverride: formatOverride(args.nextLength),
    } as Partial<AnyNode>)
    return { ok: true }
  }

  const plan = planDimensionDrive({
    nodes,
    target: resolution.target,
    currentLength: args.target.value,
    nextLength: args.nextLength,
  })
  if (!plan) return { ok: false, reason: 'Value would collapse the geometry' }
  if (plan.updates.length === 0) return { ok: true }

  const changes = plan.updates.map((update) => ({
    id: update.id,
    data: update.data as Partial<AnyNode>,
  }))
  if (store.applyNodeChanges) store.applyNodeChanges({ update: changes })
  else for (const change of changes) store.updateNode(change.id, change.data)
  for (const change of changes) store.markDirty(change.id)
  return { ok: true }
}

function formatOverride(metres: number): string {
  return `${Number.parseFloat(metres.toFixed(4))}`
}

function number(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function point(x: string | null, y: string | null): [number, number] | null {
  const parsedX = number(x)
  const parsedY = number(y)
  return parsedX === null || parsedY === null ? null : [parsedX, parsedY]
}
