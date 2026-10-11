import type { PinState } from './types'

/**
 * What the chat tells the pin about its ask's turn (the scene/chat boundary agreed with the chat
 * side: queued, working with the live sentence, and one end with what happened).
 */
export type PinStatus =
  | { askId: string; turnId?: string; status: 'queued' }
  | { askId: string; turnId?: string; status: 'working'; sentence?: string }
  /** The turn waits on a question to the person; `working` follows once it is answered. */
  | { askId: string; turnId?: string; status: 'asking'; question: string }
  | {
      askId: string
      turnId?: string
      status: 'ended'
      outcome: 'completed' | 'cancelled' | 'errored'
      /** The turn ended on a question to the person. */
      asked: boolean
      /** The turn made at least one scene-writing tool call. */
      wroteScene: boolean
      answer?: string
      error?: string
    }

export type PinEvent =
  | { type: 'sent' }
  | { type: 'status'; status: PinStatus }
  /** A scene commit while the ask works; `isInTargets` says whether a node is a target or inside one. */
  | { type: 'commit'; changedNodeIds: readonly string[]; isInTargets?: (id: string) => boolean }
  | { type: 'undo' }
  | { type: 'undone'; ok: boolean }
  /** The person brought the undone ask back (Redo, while nothing else was done). */
  | { type: 'redo' }
  | { type: 'keep' }

export type PinModel = {
  askId: string
  /** The ask's words, for the pin's tooltip. */
  text: string
  targetIds: string[]
  state: PinState
  /** The live step words while it works. */
  sentence?: string
  /** What Pascal is waiting to be told, while the turn is paused on a question. */
  question?: string
  turnId?: string
  /** The card's title for a done pin, built by the caller from the step sentences. */
  title?: string
  answer?: string
  error?: string
  /** Steps whose commits touched a target: each is a small pop on the pin. */
  landed: number
  changedTargetIds: string[]
  alsoChangedIds: string[]
  ended: boolean
  undone: boolean
  kept: boolean
}

export function createPin(init: { askId: string; text: string; targetIds: string[] }): PinModel {
  return {
    askId: init.askId,
    text: init.text,
    targetIds: [...init.targetIds],
    state: 'sent',
    landed: 0,
    changedTargetIds: [],
    alsoChangedIds: [],
    ended: false,
    undone: false,
    kept: false,
  }
}

const union = (list: string[], more: readonly string[]) => {
  const next = [...list]
  for (const id of more) if (!next.includes(id)) next.push(id)
  return next.length === list.length ? list : next
}

const IN_FLIGHT: readonly PinState[] = ['sent', 'queued', 'working']
/** A turn that waits on a question is still open: it resumes, or ends still asking. */
const OPEN: readonly PinState[] = [...IN_FLIGHT, 'needs-input']

function reduceStatus(pin: PinModel, status: PinStatus): PinModel {
  if (status.askId !== pin.askId || pin.ended) return pin
  const turnId = status.turnId ?? pin.turnId
  if (status.status === 'queued') {
    if (pin.state !== 'sent' && pin.state !== 'queued') return pin
    return { ...pin, state: 'queued', turnId }
  }
  if (status.status === 'asking') {
    if (!OPEN.includes(pin.state)) return pin
    return { ...pin, state: 'needs-input', turnId, question: status.question }
  }
  if (status.status === 'working') {
    if (!OPEN.includes(pin.state)) return pin
    const { question: _answered, ...rest } = pin
    return { ...rest, state: 'working', turnId, sentence: status.sentence ?? pin.sentence }
  }
  if (!OPEN.includes(pin.state)) return pin
  const changed = pin.changedTargetIds.length > 0
  let state: PinState
  if (status.outcome === 'errored') state = 'error'
  else if (changed) state = 'done'
  else if (status.asked) state = 'needs-input'
  else if (status.outcome === 'cancelled') state = 'no-change'
  else if (!status.wroteScene && status.answer) state = 'answered'
  else state = 'no-change'
  return {
    ...pin,
    state,
    turnId,
    ended: true,
    sentence: undefined,
    ...(pin.sentence ? { title: pin.sentence } : {}),
    ...(status.answer === undefined ? {} : { answer: status.answer }),
    ...(status.error === undefined ? {} : { error: status.error }),
  }
}

/** The pin's state machine (spec 2.6-2.8): pure, so every transition is a test. */
export function reducePin(pin: PinModel, event: PinEvent): PinModel {
  switch (event.type) {
    case 'sent':
      return pin
    case 'status':
      return reduceStatus(pin, event.status)
    case 'commit': {
      if (pin.state !== 'working' || event.changedNodeIds.length === 0) return pin
      const isTarget = (id: string) =>
        pin.targetIds.includes(id) || event.isInTargets?.(id) === true
      const hits = event.changedNodeIds.filter(isTarget)
      const others = event.changedNodeIds.filter((id) => !isTarget(id))
      const changedTargetIds = union(pin.changedTargetIds, hits)
      const alsoChangedIds = union(pin.alsoChangedIds, others)
      if (hits.length === 0 && alsoChangedIds === pin.alsoChangedIds) return pin
      return {
        ...pin,
        landed: hits.length > 0 ? pin.landed + 1 : pin.landed,
        changedTargetIds,
        alsoChangedIds,
      }
    }
    case 'undo':
      return pin.state === 'done' ? { ...pin, state: 'undone', undone: true } : pin
    case 'undone':
      // A failed undo hands the pin back; a good one is already shown.
      return !event.ok && pin.state === 'undone' && pin.undone
        ? { ...pin, state: 'done', undone: false }
        : pin
    case 'redo':
      return pin.state === 'undone' && pin.undone ? { ...pin, state: 'done', undone: false } : pin
    case 'keep':
      return pin.kept ? pin : { ...pin, kept: true }
  }
}

const firstLines = (text: string, count: number) => text.split('\n').slice(0, count).join('\n')

/** The card's headline: the error's words, an answer's first two lines, "Undone", or the title. */
export function cardTitle(pin: PinModel, fallback = 'Done'): string {
  if (pin.state === 'error' && pin.error) return pin.error
  if (pin.state === 'answered' && pin.answer) return firstLines(pin.answer, 2)
  if (pin.state === 'undone') return 'Undone'
  return pin.title || fallback
}

/** "Also changed 2 other elements": the objects a prompt names can differ from the ones it changes. */
export function alsoChangedLine(pin: PinModel): string | null {
  const count = pin.alsoChangedIds.length
  if (count === 0) return null
  return `Also changed ${count} other element${count === 1 ? '' : 's'}`
}

/** A pointer that left with no move just before it did not walk out. */
const POINTER_STILL_MS = 150

/**
 * The card rides its pin, so a camera flight (an Undo playing the build backwards, say) can carry it
 * out from under a pointer that has not moved. That is not the person leaving, and the card holds the
 * Redo, so it stays. A finger leaves without a move whenever it lifts, so only a mouse can be carried.
 */
export function cardCarriedFromPointer(leave: {
  pointerType: string
  leftAt: number
  lastMoveAt: number
}): boolean {
  return leave.pointerType === 'mouse' && leave.leftAt - leave.lastMoveAt > POINTER_STILL_MS
}
