'use client'

import { emitter, sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import {
  CARD_AUTO_MS,
  CARD_CARRIED_MS,
  CARD_CLOSE_DELAY_MS,
  CARD_MS,
  CARD_W,
  CHECK_PULSE_MS,
  EASE_OUT,
  PIN_DROP_MS,
  PIN_DROP_PX,
  PIN_HOLD_MS,
  PIN_HOLD_SLOP_PX,
  PIN_RETIRE_FADE_MS,
  PIN_RETIRE_MS,
  PIN_RING_DELAY_MS,
  PIN_RING_MS,
} from '../../lib/point-ask/choreography'
import { edgeMarker } from '../../lib/point-ask/edge-marker'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { alsoChangedLine, cardCarriedFromPointer, cardTitle } from '../../lib/point-ask/pin-machine'
import { canvasRect, freeViewport, projectWorld } from '../../lib/point-ask/projector'
import {
  changeMore,
  endCompare,
  endCompareWhenPointerDrifts,
  handEditsSince,
  lookAtAsk,
  redoAsk,
  retryAsk,
  startCompare,
  undoAsk,
} from '../../lib/point-ask/session'
import { type PinRecord, usePointAsk } from '../../store/use-point-ask'
import { finishOptionalAnimations, pointMotionCalm, usePointMotionCalm } from './optional-motion'

const COMPARE_REFUSAL_WORDS = {
  'history-held': 'Another change is in progress. Try again in a moment.',
  'no-before': 'The scene has changed too much since to show how it was.',
  'turn-working': "Pascal is still working. Try again when it's done.",
} as const

const SETTLED = new Set(['done', 'answered', 'no-change', 'undone'])
const scratch = new Vector3()

/** The pin's spot now: in its first target's own frame while that exists, else where it was planted. */
function pinWorld(pin: PinRecord): [number, number, number] {
  if (pin.local) {
    const object = sceneRegistry.nodes.get(pin.local.nodeId)
    if (object) {
      object.updateWorldMatrix(true, false)
      scratch.set(...pin.local.offset)
      object.localToWorld(scratch)
      return [scratch.x, scratch.y, scratch.z]
    }
  }
  return pin.anchor
}

const PIN_SVG = (
  <>
    <span className="pa-ring" />
    <span className="pa-pdisc">
      <svg aria-hidden viewBox="0 0 24 24">
        <circle className="pa-pq" cx="12" cy="12" r="6.5" />
        <g className="pa-parcs">
          <circle
            className="pa-pa"
            cx="12"
            cy="12"
            pathLength="100"
            r="6.5"
            strokeDasharray="26 74"
          />
          <circle
            className="pa-pa"
            cx="12"
            cy="12"
            pathLength="100"
            r="6.5"
            strokeDasharray="12 88"
            strokeDashoffset="-50"
          />
        </g>
        <path className="pa-pk" d="M8 12.4l2.6 2.6 5.4-5.6" />
        <path className="pa-sg" d="M7.5 8.5h9v6h-5l-2.5 2.2v-2.2h-1.5z" />
      </svg>
    </span>
  </>
)

export function PointAskPins() {
  const order = usePointAsk((s) => s.pinOrder)
  return (
    <>
      {order.map((id) => (
        <PinView askId={id} key={id} />
      ))}
      <PinCard />
    </>
  )
}

function PinView({ askId }: { askId: string }) {
  const pin = usePointAsk((s) => s.pins[askId])
  // "Change more" in flight: this pin gives way to the ask that will stand where it stood.
  const gaveWay = usePointAsk(
    (s) => Boolean(s.pins[askId]?.supersededBy) || s.bubble?.changesAsk?.askId === askId,
  )
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const el = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLButtonElement>(null)
  const arcs = useRef<SVGGElement | null>(null)
  const state = useRef({ angle: 0, boost: 0, landed: 0, sentence: '' })
  const retire = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prev = useRef<string | null>(null)
  const model = pin?.model
  const optional = useRef<Animation[]>([])
  const calm = usePointMotionCalm()

  useEffect(() => {
    if (!calm) return
    finishOptionalAnimations(optional.current)
    state.current.boost = 0
    state.current.angle = 0
    arcs.current?.setAttribute('transform', 'rotate(0 12 12)')
  }, [calm])

  useEffect(() => {
    return () => {
      for (const animation of optional.current) animation.cancel()
    }
  }, [])

  // Follows its element every frame; the arcs speed up with the agent's real progress, not a timer.
  useEffect(() => {
    return subscribeFrame((dt) => {
      const record = usePointAsk.getState().pins[askId]
      const node = el.current
      if (!(record && node)) return
      const at = projectWorld(pinWorld(record))
      const levelHidden =
        record.levelId !== null && useViewer.getState().selection.levelId !== record.levelId
      // Out of the view: the pin gives way to an edge marker that points at it and offers to look.
      const frame = canvasRect()
      const away =
        frame && !levelHidden
          ? edgeMarker(at.ok ? { x: at.x, y: at.y } : null, {
              x0: frame.left,
              y0: frame.top,
              x1: frame.right,
              y1: frame.bottom,
            })
          : null
      const mark = marker.current
      if (mark) {
        const show = away !== null && !levelHidden && record.model.state !== 'queued'
        mark.style.display = show ? '' : 'none'
        if (show && away) {
          const width = mark.offsetWidth
          const half = width / 2
          const x = frame
            ? Math.min(Math.max(away.x, frame.left + 8 + half), frame.right - 8 - half)
            : away.x
          mark.style.transform = `translate3d(${x - half}px,${away.y - 14}px,0)`
          const arrow = mark.querySelector<SVGElement>('svg')
          if (arrow) arrow.style.transform = `rotate(${away.angle}deg)`
        }
      }
      node.style.visibility = levelHidden || away !== null ? 'hidden' : ''
      node.style.transform = `translate3d(${at.x}px,${at.y}px,0)`
      const s = state.current
      if (pointMotionCalm()) {
        s.boost = 0
        s.angle = 0
      } else {
        s.boost = Math.max(0, s.boost - 520 * dt)
        s.angle = (s.angle + (110 + s.boost) * dt) % 360
      }
      if (
        arcs.current &&
        (record.model.state === 'working' || record.model.state === 'needs-input')
      ) {
        arcs.current.setAttribute('transform', `rotate(${s.angle} 12 12)`)
      }
    })
  }, [askId])

  // A step landing, or a new sentence, bumps the arcs.
  useEffect(() => {
    if (!model) return
    const s = state.current
    if (model.landed !== s.landed || (model.sentence ?? '') !== s.sentence) {
      if (!pointMotionCalm()) s.boost = Math.min(420, s.boost + 260)
      s.landed = model.landed
      s.sentence = model.sentence ?? ''
    }
  }, [model])

  // The pin drops from 8 px with a small squash and one ring ripple (the send, planted).
  useEffect(() => {
    const disc = el.current?.querySelector<HTMLElement>('.pa-pdisc')
    const ring = el.current?.querySelector<HTMLElement>('.pa-ring')
    if (!disc) return
    if (pointMotionCalm()) {
      disc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 })
      return
    }
    optional.current.push(
      disc.animate(
        [
          { transform: `translateY(-${PIN_DROP_PX}px)`, opacity: 0 },
          { transform: 'translateY(0) scale(1.14, .82)', opacity: 1, offset: 0.55 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: PIN_DROP_MS, easing: EASE_OUT },
      ),
    )
    if (ring)
      optional.current.push(
        ring.animate(
          [
            { transform: 'scale(.6)', opacity: 0.7 },
            { transform: 'scale(2.4)', opacity: 0 },
          ],
          { duration: PIN_RING_MS, delay: PIN_RING_DELAY_MS, easing: EASE_OUT, fill: 'backwards' },
        ),
      )
  }, [])

  // The moments: done pulses once, an error shakes once (2 cycles, 6 px).
  useEffect(() => {
    const state2 = model?.state
    if (!state2 || prev.current === state2) {
      prev.current = state2 ?? null
      return
    }
    const before = prev.current
    prev.current = state2
    const disc = el.current?.querySelector<HTMLElement>('.pa-pdisc')
    if (!disc || before === null) return
    const quiet = pointMotionCalm()
    if (state2 === 'done' && !quiet) {
      optional.current.push(
        disc.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.18)', offset: 0.4 },
            { transform: 'scale(1)' },
          ],
          {
            duration: CHECK_PULSE_MS,
            delay: 100,
            easing: EASE_OUT,
          },
        ),
      )
      // One outline flash on the element: 180 ms in, 220 ms out.
      const viewer = useViewer.getState()
      viewer.setPointedIds(model?.targetIds as never)
      setTimeout(() => useViewer.getState().setPointedIds(null), 400)
    }
    if (state2 === 'error' && !quiet && el.current) {
      optional.current.push(
        el.current.animate(
          [
            { translate: '0 0' },
            { translate: '-6px 0' },
            { translate: '6px 0' },
            { translate: '-6px 0' },
            { translate: '6px 0' },
            { translate: '0 0' },
          ],
          { duration: 360, easing: 'ease-in-out' },
        ),
      )
    }
    // The card opens by itself once, for 4 s, when a result lands and the person is idle.
    if (SETTLED.has(state2) || state2 === 'error' || state2 === 'needs-input') {
      setTimeout(() => {
        const s = usePointAsk.getState()
        if (s.cardFor === null && s.bubble === null && s.pins[askId]) {
          s.openCard(askId)
          setTimeout(() => {
            if (usePointAsk.getState().cardFor === askId && !cardHeld(askId))
              usePointAsk.getState().openCard(null)
          }, CARD_AUTO_MS)
        }
      }, 900)
    }
  }, [model?.state, askId, model?.targetIds])

  const hovering = useRef(false)

  // A settled pin retires 8 s after it was last in the person's way, with a short fade.
  useEffect(() => {
    if (retire.current) clearTimeout(retire.current)
    retire.current = null
    if (!model || !SETTLED.has(model.state)) return
    const arm = () => {
      retire.current = setTimeout(() => {
        const s = usePointAsk.getState()
        if (s.cardFor === askId || hovering.current) return arm()
        el.current
          ?.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: PIN_RETIRE_FADE_MS,
            fill: 'forwards',
          })
          .finished.then(
            () => usePointAsk.getState().removePin(askId),
            () => undefined,
          )
      }, PIN_RETIRE_MS)
    }
    arm()
    return () => {
      if (retire.current) clearTimeout(retire.current)
    }
  }, [model?.state, askId, model])

  if (!(pin && model) || gaveWay) return null
  const changes = model.changedTargetIds.length
  const overHere =
    model.state === 'needs-input'
      ? 'Pascal needs you over here'
      : model.state === 'error'
        ? 'Something failed over here'
        : changes > 0
          ? `${changes} change${changes === 1 ? '' : 's'} over here`
          : model.state === 'working'
            ? 'Pascal is working over here'
            : 'Over here'
  return (
    <>
      <button
        className="pa-edgemark"
        onClick={() => lookAtAsk(askId)}
        ref={marker}
        style={{ display: 'none' }}
        type="button"
      >
        <svg
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 16 16"
        >
          <path d="M3 8h9M8.5 4l4 4-4 4" />
        </svg>
        {overHere}
      </button>
      <div
        className={`pa-pin ${model.state === 'sent' ? 'queued' : model.state}`}
        onClick={() => {
          // The click that ends a hold is not a click on the pin.
          if (held.current) {
            held.current = false
            return
          }
          emitter.emit('point-ask:pin', { askId, action: 'open' })
          usePointAsk.getState().openCard(askId)
        }}
        onLostPointerCapture={() => endCompare()}
        onPointerCancel={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current)
          holdTimer.current = null
          endCompare()
        }}
        onPointerDown={(event) => {
          held.current = false
          if (event.button !== 0 || model.state !== 'done') return
          const target = event.currentTarget
          const pointerId = event.pointerId
          const origin = { x: event.clientX, y: event.clientY }
          // A press that stays down shows the scene as it was before the turn; a click opens the card.
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null
            if (!startCompare(askId)) return
            held.current = true
            target.setPointerCapture?.(pointerId)
            // Capture keeps the release, so leaving the pin is a drift away from where it was pressed.
            endCompareWhenPointerDrifts(origin, PIN_HOLD_SLOP_PX)
          }, PIN_HOLD_MS)
        }}
        onPointerUp={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current)
          holdTimer.current = null
          endCompare()
        }}
        onPointerEnter={() => {
          hovering.current = true
          pinHover.askId = askId
          emitter.emit('point-ask:pin', { askId, action: 'hover' })
          usePointAsk.getState().openCard(askId)
        }}
        onPointerLeave={() => {
          hovering.current = false
          if (pinHover.askId === askId) pinHover.askId = null
          if (holdTimer.current) clearTimeout(holdTimer.current)
          holdTimer.current = null
          emitter.emit('point-ask:pin', { askId, action: 'leave' })
          window.setTimeout(() => {
            const s = usePointAsk.getState()
            if (s.cardFor === askId && !cardHeld(askId)) s.openCard(null)
          }, CARD_CLOSE_DELAY_MS)
        }}
        ref={(node) => {
          el.current = node
          arcs.current = node?.querySelector<SVGGElement>('.pa-parcs') ?? null
        }}
        title={model.state === 'working' && model.sentence ? model.sentence : 'Sent to Pascal'}
      >
        {PIN_SVG}
      </div>
    </>
  )
}

const cardHover = { current: false }

/**
 * Whether the pointer is on the card. The flag follows the card's enter and leave events, but a card
 * that closes under the pointer (a click on Redo, Keep) never gets its leave, and one that opens
 * under a still pointer never gets its enter, so the browser's own :hover is asked as well.
 */
const cardHeld = (askId: string) =>
  cardHover.current ||
  pinHover.askId === askId ||
  document.querySelector('.pa-card:hover, .pa-pin:hover') !== null

/** The pin the pointer is on, so a card's close timer does not shut what the pin just opened. */
const pinHover: { askId: string | null } = { askId: null }

/** The pin's card: what Pascal did, and Keep or Undo; it rises from the pin. */
function PinCard() {
  const askId = usePointAsk((s) => s.cardFor)
  const pin = usePointAsk((s) => (askId ? s.pins[askId] : undefined))
  const wrap = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [warn, setWarn] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const comparing = usePointAsk((s) => s.comparing === askId)
  const refusal = usePointAsk((s) =>
    s.compareRefusal?.askId === askId ? s.compareRefusal.reason : null,
  )
  const lastMove = useRef<{ x: number; y: number } | null>(null)
  const carriedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const optional = useRef<Animation[]>([])
  const calm = usePointMotionCalm()
  useEffect(() => {
    if (calm) finishOptionalAnimations(optional.current)
  }, [calm])
  useEffect(() => {
    const note = (event: globalThis.PointerEvent) => {
      lastMove.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', note, { passive: true, capture: true })
    return () => window.removeEventListener('pointermove', note, { capture: true })
  }, [])
  // A card that goes under the pointer never hears its leave: the next one starts unheld.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tied to which card is open
  useEffect(() => {
    cardHover.current = false
    if (carriedTimer.current) clearTimeout(carriedTimer.current)
    carriedTimer.current = null
  }, [askId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new card starts without the warning
  useEffect(() => {
    setWarn(false)
    setNote(null)
  }, [askId])

  useEffect(() => {
    if (!askId) return
    return subscribeFrame(() => {
      const record = usePointAsk.getState().pins[askId]
      const node = wrap.current
      const cardEl = card.current
      if (!(record && node && cardEl)) return
      const at = projectWorld(pinWorld(record))
      node.style.visibility = at.ok ? '' : 'hidden'
      // Above the pin; below it when there is no room above (clear of the top bar and camera hints).
      const view = freeViewport()
      const height = cardEl.offsetHeight
      const above = at.y - 46 - height
      const y = view && above < view.y0 ? at.y + 14 : above
      const x = view
        ? Math.min(Math.max(at.x - CARD_W / 2, view.x0), Math.max(view.x0, view.x1 - CARD_W))
        : at.x - CARD_W / 2
      node.style.transform = `translate3d(${x}px,${y}px,0)`
    })
  }, [askId])

  useEffect(() => {
    const el = card.current
    if (!(askId && el)) return
    const quiet = pointMotionCalm()
    const animation = el.animate(
      quiet
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(6px) scale(.96)' },
            { opacity: 1, transform: 'none' },
          ],
      { duration: CARD_MS, easing: EASE_OUT },
    )
    if (!quiet) optional.current.push(animation)
    return () => {
      animation.cancel()
      optional.current = []
    }
  }, [askId])

  if (!(askId && pin)) return null
  const { model } = pin
  const title =
    model.state === 'done'
      ? cardTitle(model)
      : model.state === 'answered'
        ? (model.answer ?? '').split('\n').slice(0, 2).join(' ')
        : model.state === 'no-change'
          ? `Pascal didn't change ${pin.label}.`
          : model.state === 'error'
            ? (model.error ?? 'Pascal could not do this.')
            : model.state === 'needs-input'
              ? (model.question ?? 'Pascal needs a word from you.')
              : model.state === 'undone'
                ? 'Undone'
                : model.sentence || 'Pascal is on it'
  const also = alsoChangedLine(model)
  const edits = handEditsSince(askId)
  const keepOpen = () => {
    cardHover.current = true
    if (carriedTimer.current) clearTimeout(carriedTimer.current)
    carriedTimer.current = null
  }
  const leave = (event: PointerEvent<HTMLDivElement>) => {
    cardHover.current = false
    if (
      cardCarriedFromPointer({
        pointerType: event.pointerType,
        at: { x: event.clientX, y: event.clientY },
        last: lastMove.current,
      })
    ) {
      // The pointer did not leave, the card was taken from it: it waits a while for the pointer.
      if (carriedTimer.current) clearTimeout(carriedTimer.current)
      carriedTimer.current = setTimeout(() => {
        carriedTimer.current = null
        const s = usePointAsk.getState()
        if (s.cardFor === askId && !cardHeld(askId)) s.openCard(null)
      }, CARD_CARRIED_MS)
      return
    }
    window.setTimeout(() => {
      const s = usePointAsk.getState()
      if (s.cardFor === askId && !cardHeld(askId)) s.openCard(null)
    }, CARD_CLOSE_DELAY_MS)
  }
  return (
    <div className="pa-cardwrap" ref={wrap}>
      <div className="pa-card" onPointerEnter={keepOpen} onPointerLeave={leave} ref={card}>
        {model.state === 'done' ? (
          <div className="pa-card-head">
            <div className="pa-card-t">{title}</div>
            {pin.after?.dataUrl || pin.before?.dataUrl ? (
              <div className="pa-card-thumb" title="After">
                {/* biome-ignore lint/performance/noImgElement: data URLs the capture just made */}
                <img alt="After" src={pin.after?.dataUrl ?? pin.before?.dataUrl} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="pa-card-t">{title}</div>
        )}
        {model.state === 'working' || model.state === 'queued' || model.state === 'sent' ? (
          <div className="pa-card-s">“{model.text}”</div>
        ) : null}
        {also ? (
          <div
            className="pa-card-a"
            onPointerEnter={() => useViewer.getState().setPointedIds(model.alsoChangedIds as never)}
            onPointerLeave={() => useViewer.getState().setPointedIds(null)}
          >
            {also}
          </div>
        ) : null}
        {note ? <div className="pa-card-s">{note}</div> : null}
        {model.state === 'done' && edits > 0 && warn ? (
          <div className="pa-card-s">
            You've changed the scene since. Undoing also removes those changes.
          </div>
        ) : null}
        {refusal ? <div className="pa-card-s">{COMPARE_REFUSAL_WORDS[refusal]}</div> : null}
        {model.state === 'done' ? (
          <button
            aria-pressed={comparing}
            className={`pa-hold${comparing ? ' on' : ''}`}
            onKeyDown={(event) => {
              if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return
              event.preventDefault()
              startCompare(askId)
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') endCompare()
            }}
            onPointerCancel={() => endCompare()}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              startCompare(askId)
            }}
            onPointerLeave={() => endCompare()}
            onPointerUp={() => endCompare()}
            type="button"
          >
            {comparing ? 'Showing before' : 'Hold to see before'}
          </button>
        ) : null}
        <div className="pa-card-row">
          {model.state === 'done' ? (
            <>
              <button
                className="pa-btn primary"
                onClick={() => {
                  usePointAsk.getState().dispatchPin(askId, { type: 'keep' })
                  usePointAsk.getState().openCard(null)
                }}
                type="button"
              >
                Keep
              </button>
              <button
                className="pa-btn"
                onClick={() => {
                  changeMore(askId)
                }}
                type="button"
              >
                Change more
              </button>
              <button
                className="pa-btn"
                onClick={async () => {
                  const result = await undoAsk(askId, { force: edits > 0 && warn })
                  if (result === 'needs-confirm') setWarn(true)
                  else if (result === 'unavailable')
                    setNote("This can't be undone from here: the scene's history has moved on.")
                }}
                type="button"
              >
                {edits > 0 && warn ? 'Undo anyway' : 'Undo'}
              </button>
            </>
          ) : null}
          {model.state === 'undone' ? (
            <button
              className="pa-btn primary"
              onClick={() => {
                redoAsk(askId)
                usePointAsk.getState().openCard(null)
              }}
              type="button"
            >
              Redo
            </button>
          ) : null}
          {model.state === 'error' ? (
            <>
              <button
                className="pa-btn primary"
                onClick={() => {
                  void retryAsk(askId)
                }}
                type="button"
              >
                Try again
              </button>
              <button
                className="pa-btn"
                onClick={() => emitter.emit('point-ask:pin', { askId, action: 'open' })}
                type="button"
              >
                Open in chat
              </button>
            </>
          ) : null}
          {model.state === 'answered' ||
          model.state === 'no-change' ||
          model.state === 'needs-input' ? (
            <button
              className="pa-btn"
              onClick={() => emitter.emit('point-ask:pin', { askId, action: 'open' })}
              type="button"
            >
              {model.state === 'no-change' ? 'See why' : 'Open in chat'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
