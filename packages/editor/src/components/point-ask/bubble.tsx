'use client'

import { prefersReducedMotion } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BUBBLE_CLOSE_MS,
  BUBBLE_OPEN_BLUR_PX,
  BUBBLE_OPEN_SCALE,
  EASE_OUT,
  ENTER_MS,
  SPRING,
  SUGGESTION_DELAY_MS,
  SUGGESTION_STAGGER_MS,
} from '../../lib/point-ask/choreography'
import { type Dictation, isDictationSupported, startDictation } from '../../lib/point-ask/dictation'
import { subscribeFrame } from '../../lib/point-ask/frame-loop'
import { type PlacementState, placeBubble } from '../../lib/point-ask/placement'
import { freeViewport, projectBox, projectWorld, unionRect } from '../../lib/point-ask/projector'
import { regionLabel } from '../../lib/point-ask/region'
import { closeBubble, sendBubble } from '../../lib/point-ask/session'
import { SpringPair } from '../../lib/point-ask/spring'
import { springKeyframes } from '../../lib/point-ask/spring-keyframes'
import { kindForTargets, placeholderFor, suggestionsFor } from '../../lib/point-ask/suggestions'
import { type PointBubble, usePointAsk } from '../../store/use-point-ask'

const ARROW = (
  <svg
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 16 16"
  >
    <path d="M8 13V3.5M3.8 7.5L8 3.3l4.2 4.2" />
  </svg>
)
const CROSS = (
  <svg
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.8"
    viewBox="0 0 10 10"
  >
    <path d="M2 2l6 6M8 2L2 8" />
  </svg>
)
const MIC = (
  <svg
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 16 16"
  >
    <rect height="8" rx="2.5" width="5" x="5.5" y="1.5" />
    <path d="M3 7.5a5 5 0 0010 0M8 12.5V15" />
  </svg>
)

/** What the bubble's own outline covers: its targets, or the elements inside its region. */
const bubbleIds = (bubble: PointBubble) =>
  (bubble.area ? bubble.area.ids : bubble.targets.map((t) => t.id)) as never

/** The last words sent, for ↑ in an empty field. */
let lastAsk = ''

/** Keeps the last value mounted for `ms` after it goes, so an exit can play. */
function useExitPresence<T>(value: T | null, ms: number): { shown: T | null; exiting: boolean } {
  const [shown, setShown] = useState<T | null>(value)
  const [exiting, setExiting] = useState(false)
  useEffect(() => {
    if (value) {
      setShown(value)
      setExiting(false)
      return
    }
    if (!shown) return
    setExiting(true)
    const timer = setTimeout(() => {
      setShown(null)
      setExiting(false)
    }, ms)
    return () => clearTimeout(timer)
  }, [value, ms, shown])
  return { shown, exiting }
}

/**
 * The anchored bubble: it grows from the exact click point, sits beside the target (never over it)
 * and follows the camera 1:1; on send it folds into the pin at the same spot. See the spec's 2.4
 * and the motion choreography.
 */
export function PointAskBubble() {
  const bubble = usePointAsk((s) => s.bubble)
  const closeKind = usePointAsk((s) => s.closeKind)
  const { shown, exiting } = useExitPresence<PointBubble>(bubble, 190)
  if (!shown) return null
  return (
    <BubbleView
      bubble={shown}
      exiting={exiting}
      fold={closeKind === 'send'}
      key={shown.capturedAt}
    />
  )
}

function BubbleView({
  bubble,
  exiting,
  fold,
}: {
  bubble: PointBubble
  exiting: boolean
  fold: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const bub = useRef<HTMLDivElement>(null)
  const tail = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const place = useRef<{
    state: PlacementState
    pair: SpringPair
    glide: boolean
    first: boolean
    offset: { x: number; y: number }
  }>({
    state: { side: null, badMs: 0 },
    pair: new SpringPair(0, 0, SPRING),
    glide: false,
    first: true,
    offset: { x: 0, y: 0 },
  })
  const bubbleRef = useRef(bubble)
  bubbleRef.current = bubble
  const busy = usePointAsk((s) => s.busy)
  const [listening, setListening] = useState(false)
  const dictation = useRef<Dictation | null>(null)
  const dictationBase = useRef('')

  // Position: beside the target, tracked 1:1 each frame, a side switch gliding on the default spring.
  useEffect(() => {
    return subscribeFrame((dt) => {
      const current = bubbleRef.current
      const wrapEl = wrap.current
      const bubEl = bub.current
      const viewport = freeViewport()
      if (!(wrapEl && bubEl && viewport)) return
      const area = current.area
      const click = area
        ? { x: area.click.x, y: area.click.y, ok: true }
        : projectWorld(current.anchor)
      const boxes = current.targets
        .flatMap((t) => (t.box ? [projectBox(t.box)] : []))
        .flatMap((r) => (r ? [r] : []))
      const box = area?.rect ??
        unionRect(boxes) ?? { x0: click.x, y0: click.y, x1: click.x, y1: click.y }
      const p = place.current
      const result = placeBubble(
        {
          box,
          click: click.ok ? { x: click.x, y: click.y } : null,
          size: { w: bubEl.offsetWidth || 320, h: bubEl.offsetHeight || 150 },
          viewport,
          offset: p.offset,
          first: p.first,
        },
        p.state,
        dt * 1000,
      )
      p.state = result.state
      if (result.glide) p.glide = true
      if (p.first || !p.glide || prefersReducedMotion()) {
        p.pair.snap(result.pos.x, result.pos.y)
        p.glide = false
      } else {
        p.pair.to(result.pos.x, result.pos.y).step(dt)
        if (p.pair.rest) p.glide = false
      }
      const { x, y } = p.pair.value
      wrapEl.style.transform = `translate3d(${x}px,${y}px,0)`
      const tailEl = tail.current
      if (tailEl) {
        // The tail follows the glide: its anchor is the click, measured from the bubble as drawn.
        const lx = (click.ok ? click.x : result.pos.x) - x
        const ly = (click.ok ? click.y : result.pos.y) - y
        const w = bubEl.offsetWidth || 320
        const h = bubEl.offsetHeight || 150
        let tx: number | null = null
        let ty: number | null = null
        if (click.ok) {
          if (lx < 0) [tx, ty] = [0, Math.min(Math.max(ly, 16), h - 16)]
          else if (lx > w) [tx, ty] = [w, Math.min(Math.max(ly, 16), h - 16)]
          else if (ly < 0) [tx, ty] = [Math.min(Math.max(lx, 16), w - 16), 0]
          else if (ly > h) [tx, ty] = [Math.min(Math.max(lx, 16), w - 16), h]
        }
        tailEl.style.visibility = tx === null ? 'hidden' : ''
        if (tx !== null && ty !== null)
          tailEl.style.transform = `translate(${tx - 6}px,${ty - 6}px) rotate(45deg)`
      }
      if (p.first) {
        bubEl.style.transformOrigin = `${result.origin.x}px ${result.origin.y}px`
        p.first = false
      }
    })
  }, [])

  // Opens on pointer-up: grows from the click, the field focused on the same frame so a key typed
  // during the animation lands; the suggestions follow at a 30 ms stagger.
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const el = bub.current
    if (!el) return
    if (prefersReducedMotion()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE_OUT })
      return
    }
    el.animate(
      springKeyframes(
        { scale: BUBBLE_OPEN_SCALE, opacity: 0, blur: BUBBLE_OPEN_BLUR_PX },
        { scale: 1, opacity: 1, blur: 0 },
        420,
        {
          damping: SPRING.damping,
          response: SPRING.response,
        },
      ),
      { duration: 420, easing: 'linear', fill: 'backwards' },
    )
    el.querySelectorAll<HTMLElement>('.pa-sugs .pa-btn').forEach((chip, index) => {
      chip.animate(
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: ENTER_MS,
          delay: SUGGESTION_DELAY_MS + index * SUGGESTION_STAGGER_MS,
          easing: EASE_OUT,
          fill: 'backwards',
        },
      )
    })
  }, [])

  // Closes back into the tail, faster than it opened; sending folds it toward the pin.
  useEffect(() => {
    if (!exiting) return
    const el = bub.current
    if (!el) return
    // A bubble on its way out must not keep the keyboard: the next key belongs to the editor, not to its field.
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    for (const animation of el.getAnimations()) animation.cancel()
    const now = getComputedStyle(el)
    const from = {
      transform: now.transform === 'none' ? 'none' : now.transform,
      opacity: 1,
      filter: 'blur(0px)',
    }
    const keys: Keyframe[] = prefersReducedMotion()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          from,
          {
            transform: `scale(${fold ? 0.9 : BUBBLE_OPEN_SCALE})`,
            opacity: 0,
            filter: `blur(${BUBBLE_OPEN_BLUR_PX}px)`,
          },
        ]
    el.animate(keys, {
      duration: fold ? ENTER_MS : BUBBLE_CLOSE_MS,
      easing: EASE_OUT,
      fill: 'forwards',
    })
    if (wrap.current) wrap.current.style.pointerEvents = 'none'
  }, [exiting, fold])

  useEffect(() => {
    return () => dictation.current?.stop()
  }, [])

  const patch = usePointAsk((s) => s.patchBubble)
  const grow = useCallback(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20)}px`
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field grows whenever its text changes
  useLayoutEffect(grow, [bubble.draft, grow])

  const send = useCallback((words?: string) => {
    const text = (words ?? input.current?.value ?? '').trim()
    if (!text) return
    lastAsk = text
    dictation.current?.stop()
    const rect = input.current?.getBoundingClientRect()
    void sendBubble(text, {
      x: rect?.left ?? 0,
      y: rect?.top ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    })
  }, [])

  const toggleDictation = () => {
    if (dictation.current) {
      dictation.current.stop()
      return
    }
    dictationBase.current = input.current?.value ?? ''
    const base = dictationBase.current
    dictation.current = startDictation({
      onText: (heard) =>
        patch({ draft: `${base}${base && !base.endsWith(' ') ? ' ' : ''}${heard}` }),
      onEnd: () => {
        dictation.current = null
        setListening(false)
      },
    })
    setListening(dictation.current !== null)
  }

  const targets = bubble.targets
  const kind = kindForTargets(targets, bubble.gesture === 'region')
  const suggestions = suggestionsFor(kind, {})
  const empty = bubble.draft.trim() === ''

  return (
    <div className="pa-bwrap" ref={wrap}>
      <div aria-label="Ask Pascal" className="pa-bub" ref={bub} role="dialog">
        <span className="pa-tail" ref={tail} />
        <div
          className="pa-ctx"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button')) return
            event.preventDefault()
            const p = place.current
            const sx = event.clientX - p.offset.x
            const sy = event.clientY - p.offset.y
            const move = (m: PointerEvent) => {
              p.offset = { x: m.clientX - sx, y: m.clientY - sy }
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          title="Drag to move it aside"
        >
          {bubble.area ? (
            <span
              className="pa-tchip"
              onPointerEnter={() => useViewer.getState().setPointedIds(bubble.area?.ids as never)}
              onPointerLeave={() => useViewer.getState().setPointedIds(bubbleIds(bubble))}
            >
              <i />
              <span>{regionLabel(bubble.area.ids.length + bubble.area.more)}</span>
              <button
                aria-label="Remove the area"
                className="tx"
                onClick={() => {
                  useViewer.getState().setPointedIds(null)
                  closeBubble('dismiss')
                }}
                type="button"
              >
                {CROSS}
              </button>
            </span>
          ) : null}
          {targets.map((t) => (
            <span
              className="pa-tchip"
              key={t.id}
              onPointerEnter={() => useViewer.getState().setPointedIds([t.id as never])}
              onPointerLeave={() => useViewer.getState().setPointedIds(bubbleIds(bubble))}
            >
              <i />
              <span>
                {t.name}
                {t.size ? ` · ${t.size}` : ''}
              </span>
              <button
                aria-label={`Remove ${t.name}`}
                className="tx"
                onClick={() => {
                  const rest = targets.filter((x) => x.id !== t.id)
                  useViewer
                    .getState()
                    .setPointedIds(rest.length ? (rest.map((x) => x.id) as never) : null)
                  if (rest.length === 0) closeBubble('dismiss')
                  else patch({ targets: rest, gesture: rest.length > 1 ? 'multi' : 'click' })
                }}
                type="button"
              >
                {CROSS}
              </button>
            </span>
          ))}
          {bubble.crop.state === 'ready' && bubble.crop.dataUrl ? (
            // biome-ignore lint/performance/noImgElement: a data URL the capture just made
            <img alt="What Pascal will see" className="pa-thumb" src={bubble.crop.dataUrl} />
          ) : bubble.crop.state === 'failed' ? (
            <span className="pa-nopic">No picture</span>
          ) : null}
        </div>
        <form
          className="pa-field"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <textarea
            aria-label="Ask Pascal"
            onChange={(event) => patch({ draft: event.target.value, error: null })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              } else if (
                event.key === 'ArrowUp' &&
                (input.current?.value ?? '') === '' &&
                lastAsk
              ) {
                event.preventDefault()
                patch({ draft: lastAsk })
              }
            }}
            placeholder={placeholderFor(targets)}
            ref={input}
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 30,
              maxHeight: 120,
              resize: 'none',
              padding: '5px 0',
              font: 'inherit',
              fontSize: 14,
              lineHeight: '20px',
              color: 'inherit',
              background: 'none',
              border: 0,
              outline: 0,
            }}
            value={bubble.draft}
          />
          {isDictationSupported() ? (
            <button
              aria-label={listening ? 'Stop dictating' : 'Dictate'}
              aria-pressed={listening}
              className={`pa-dict${listening ? ' on' : ''}`}
              onClick={toggleDictation}
              type="button"
            >
              {MIC}
            </button>
          ) : null}
          <button
            aria-label={busy ? 'Queue' : 'Send'}
            className={`pa-send${busy ? ' queue' : ''}`}
            disabled={empty}
            type="submit"
          >
            {busy ? 'Queue' : ARROW}
          </button>
        </form>
        {bubble.error ? <div className="pa-err">{bubble.error}</div> : null}
        <div className="pa-sugs">
          {suggestions.map((text) => (
            <button className="pa-btn" key={text} onClick={() => send(text)} type="button">
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
