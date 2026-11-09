'use client'

import {
  type AnyNode,
  type DeleteZonePayload,
  type StructureNodes,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '../../lib/utils'
import useDeleteConfirmation, {
  type DeleteConfirmationRequest,
  type RoomConstructionChange,
} from '../../store/use-delete-confirmation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/primitives/dialog'

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function sentenceList(parts: string[]) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * A mezzanine takes its own plate (with its railing) and the ceiling core
 * derived over it; kept items come down to the floor below.
 */
function mezzanineDeletionDescription(room: DeleteZonePayload, nodes: StructureNodes) {
  const hasCeiling = Object.values(nodes).some(
    (node) => node.type === 'ceiling' && node.zoneId === room.zoneId,
  )
  const sentences = [
    hasCeiling
      ? 'Removes the mezzanine floor, its railing and the ceiling over it.'
      : 'Removes the mezzanine floor and its railing.',
  ]
  const items = room.itemIds.length
  if (items)
    sentences.push(
      `${count(items, 'item')} ${items === 1 ? 'is' : 'are'} on it. Keep ${items === 1 ? 'it' : 'them'} on the floor below, or delete ${items === 1 ? 'it' : 'them'} too.`,
    )
  return sentences.join(' ')
}

/**
 * An area Divide made goes back into the room across its dividing line: the
 * line and the area's own finish go, the walls and anything standing in it stay.
 */
function mergeDescription(room: DeleteZonePayload, nodes: StructureNodes) {
  const into = nodes[room.mergedIntoZoneId ?? '']?.name?.trim()
  const lines = room.separatorIds.length === 1 ? 'dividing line' : 'dividing lines'
  const sentences = [
    `Merges it back into ${into || 'the room next to it'}: removes the ${lines} and its floor finish. The walls stay.`,
  ]
  const items = room.itemIds.length
  if (items)
    sentences.push(
      `${count(items, 'item')} inside ${items === 1 ? 'stays where it is' : 'stay where they are'}.`,
    )
  return sentences.join(' ')
}

function roomDeletionDescription(room: DeleteZonePayload, nodes: StructureNodes) {
  if (isMezzanine(room, nodes)) return mezzanineDeletionDescription(room, nodes)
  if (room.mode === 'merge') return mergeDescription(room, nodes)
  const sentences: string[] = []
  const typeCount = (type: string) =>
    room.openingIds.filter((id) => nodes[id]?.type === type).length
  const removed = [
    room.wallIds.length ? count(room.wallIds.length, 'wall') : '',
    room.separatorIds.length ? count(room.separatorIds.length, 'separator') : '',
    typeCount('door') ? count(typeCount('door'), 'door') : '',
    typeCount('window') ? count(typeCount('window'), 'window') : '',
  ].filter(Boolean)
  sentences.push(
    removed.length
      ? `Removes ${sentenceList(removed)}, with the floor finish and ceiling.`
      : 'Removes the floor finish and ceiling.',
  )
  if (room.keptSharedWallIds.length + room.keptSharedSeparatorIds.length > 0)
    sentences.push('Walls shared with other rooms stay.')
  if (room.opensZoneIds.length) {
    const names = room.opensZoneIds.map((id) => nodes[id]?.name?.trim() || 'the next room')
    sentences.push(`Opens into ${sentenceList(names)}.`)
  }
  const items = room.itemIds.length
  if (items)
    sentences.push(
      `${count(items, 'item')} ${items === 1 ? 'is' : 'are'} inside. Keep ${items === 1 ? 'it' : 'them'} where ${items === 1 ? 'it is' : 'they are'}, or delete ${items === 1 ? 'it' : 'them'} too.`,
    )
  return sentences.join(' ')
}

/** A hosted node's kind from its type and structure — never from its name. */
function hostedKind(node: AnyNode | undefined) {
  if (node?.type === 'door' || node?.type === 'window') return node.type
  if (node?.type === 'item' && node.asset.interactive?.effects.some((e) => e.kind === 'light'))
    return 'light'
  return 'item'
}

function hostedName(node: AnyNode | undefined) {
  return (node?.name || (node?.type === 'item' ? node.asset.name : '') || '').trim()
}

function shownNames(names: string[]) {
  const named = [...new Set(names.filter(Boolean))]
  return named.slice(0, 3).join(', ') + (named.length > 3 ? ', …' : '')
}

/** "1 door (Front door), 2 windows and 1 light": counts per kind, a few names, no ids. */
export function hostedSummary(ids: readonly string[], nodes: StructureNodes) {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const kind = hostedKind(nodes[id])
    groups.set(kind, [...(groups.get(kind) ?? []), hostedName(nodes[id])])
  }
  return sentenceList(
    [...groups].map(([kind, names]) => {
      const shown = shownNames(names)
      return `${count(names.length, kind)}${shown ? ` (${shown})` : ''}`
    }),
  )
}

const pronouns = (one: boolean) =>
  one
    ? { it: 'it', is: 'is', its: 'its', verb: (v: string) => `${v}s` }
    : { it: 'them', is: 'are', its: 'their', verb: (v: string) => v }

function ceilingContent(
  change: RoomConstructionChange,
  nodes: StructureNodes,
  room: string,
  canKeep: boolean,
): DeleteConfirmationContent {
  const ids = change.hostedIds
  const p = pronouns(ids.length === 1)
  const manual = change.manualCeilings ?? []
  const sentences: string[] = []
  if (manual.length) {
    const names = shownNames(manual)
    sentences.push(
      manual.length === 1
        ? `Removes the hand-drawn ceiling${names ? ` (${names})` : ''}.`
        : `Removes ${manual.length} hand-drawn ceilings${names ? ` (${names})` : ''}.`,
    )
    if (change.alsoCovers?.length)
      sentences.push(
        `${manual.length === 1 ? 'It also covers' : 'They also cover'} ${sentenceList(change.alsoCovers)}.`,
      )
  }
  // Lights are known from their light effect; anything else reads as an item.
  const lights = ids.length > 0 && ids.every((id) => hostedKind(nodes[id]) === 'light')
  if (ids.length) {
    const names = shownNames(ids.map((id) => hostedName(nodes[id])))
    sentences.push(
      lights
        ? `${hostedSummary(ids, nodes)} ${p.verb('hang')} from it.`
        : `${count(ids.length, 'item')} ${p.is} on the ceiling${names ? ` (${names})` : ''}.`,
      `Keep ${p.it} in place, or delete ${p.it} too.`,
    )
  }
  return {
    title: `Remove the ceiling from ${room}?`,
    description: sentences.length ? sentences.join(' ') : 'Removes the ceiling.',
    keepLabel: ids.length && canKeep ? (lights ? 'Keep lights' : 'Keep items') : null,
    confirmLabel: ids.length ? 'Remove all' : 'Remove',
    destructive: true,
  }
}

function constructionContent(
  change: RoomConstructionChange,
  nodes: StructureNodes,
  canKeep: boolean,
): DeleteConfirmationContent {
  const room = change.roomName.trim() || 'this room'
  const hosted = hostedSummary(change.hostedIds, nodes)
  const p = pronouns(change.hostedIds.length === 1)
  if (change.part === 'walls' && change.action === 'add') {
    return {
      title: `Add walls to ${room}?`,
      description: `Adds ${count(change.wallCount ?? 0, 'wall')} · the room loses ${(change.areaLoss ?? 0).toFixed(2)} m² of floor.`,
      keepLabel: null,
      confirmLabel: 'Add walls',
      destructive: false,
    }
  }
  if (change.part === 'walls') {
    const walls = count(change.wallCount ?? 0, 'wall')
    return {
      title: `Remove walls from ${room}?`,
      description: [
        hosted
          ? `Turns ${walls} into separators and removes ${hosted}.`
          : `Turns ${walls} into separators.`,
        change.sharedWalls ? 'Shared walls remain.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      keepLabel: null,
      confirmLabel: 'Remove walls',
      destructive: true,
    }
  }
  if (change.part === 'floor') {
    return {
      title: `Remove the floor from ${room}?`,
      description: hosted
        ? `${hosted} ${p.verb('stand')} on it. Keep ${p.it} at ${p.its} height, or delete ${p.it} too.`
        : 'Removes the floor.',
      keepLabel: hosted && canKeep ? 'Keep items' : null,
      confirmLabel: hosted ? 'Delete items' : 'Remove',
      destructive: true,
    }
  }
  return ceilingContent(change, nodes, room, canKeep)
}

export type DeleteConfirmationContent = {
  title: string
  description: string
  /** Delete the room but leave its items in place — offered only when it has items. */
  keepLabel: string | null
  confirmLabel: string
  /** Red confirm for removals; adding walls confirms in the neutral style. */
  destructive: boolean
}

/** The words and choices the confirmation offers, from the request alone. */
function isMezzanine(room: DeleteZonePayload, nodes: StructureNodes) {
  const zone = nodes[room.zoneId]
  return zone?.type === 'zone' && zone.floor?.support === 'open'
}

export function deleteConfirmationContent(
  request: DeleteConfirmationRequest,
  nodes: StructureNodes,
): DeleteConfirmationContent {
  if (request.construction)
    return constructionContent(request.construction, nodes, !!request.onKeepContents)
  const room = request.room
  if (!room)
    return {
      title: `Delete ${count(request.count, 'element')}?`,
      description:
        'This removes every selected element. You can undo the deletion while it remains in the editor history.',
      keepLabel: null,
      confirmLabel: 'Delete',
      destructive: true,
    }
  const merge = room.mode === 'merge'
  // A merged area's items always stay, so there is nothing to choose.
  const hasItems = room.itemIds.length > 0 && !merge
  return {
    title: `Delete ${room.name.trim() || (isMezzanine(room, nodes) ? 'this mezzanine' : merge ? 'this area' : 'this room')}?`,
    description: roomDeletionDescription(room, nodes),
    keepLabel: hasItems && request.onKeepContents ? 'Keep items' : null,
    confirmLabel: hasItems ? 'Delete all' : 'Delete',
    destructive: true,
  }
}

export function DeleteConfirmationDialog() {
  const request = useDeleteConfirmation((state) => state.request)
  const cancel = useDeleteConfirmation((state) => state.cancel)
  const confirm = useDeleteConfirmation((state) => state.confirm)
  const nodes = useScene((state) => (request ? state.nodes : null))
  const live = useMemo(
    () => (request && nodes ? deleteConfirmationContent(request, nodes) : null),
    [request, nodes],
  )
  // Hold the last words through the close animation so the dialog never empties.
  const shown = useRef(live)
  if (live) shown.current = live
  const content = shown.current
  const blocked = !!request?.conflict

  useEffect(() => cancel, [cancel])

  return (
    <Dialog onOpenChange={(open) => !open && cancel()} open={request !== null}>
      <DialogContent
        className="border-border/70 bg-background/95 shadow-2xl backdrop-blur-xl sm:max-w-md"
        data-delete-confirmation-dialog
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{content?.title}</DialogTitle>
          <DialogDescription>
            {content?.description}
            {request?.conflict && (
              <span className="mt-2 block text-destructive">{request.conflict}</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
          {content?.keepLabel && (
            <button
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              disabled={blocked}
              onClick={() => {
                const keep = request?.onKeepContents
                cancel()
                keep?.()
              }}
              type="button"
            >
              {content.keepLabel}
            </button>
          )}
          <button
            className={cn(
              'rounded-full px-4 py-2 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50',
              content?.destructive === false
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-red-600 text-white hover:bg-red-700',
            )}
            disabled={blocked}
            onClick={confirm}
            type="button"
          >
            {content?.confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
