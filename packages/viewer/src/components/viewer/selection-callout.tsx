'use client'

import {
  emitter,
  type InteractionSound,
  type MessageDescriptor,
  type PascalI18n,
  usePascalI18n,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box3, type Camera, type Object3D, Vector3 } from 'three'

export type CalloutIcon = 'door' | 'window' | 'shutters' | 'light' | 'fan' | 'power'

/** Scene data (a name, a part's label) as written, or UI copy to translate. */
export type CalloutText = string | MessageDescriptor

/** One control on the callout: a pill that flips something, or a pill holding a range. */
export type CalloutAction =
  | {
      kind: 'toggle'
      key: string
      icon: CalloutIcon
      on: boolean
      /** The element or part it acts on, for the spoken label. */
      name: string
      /** A part's own name on the pill; without it the pill shows its state word. */
      text?: CalloutText
      sound: { on: InteractionSound; off: InteractionSound }
      /** When closing returns a promise for the end of the run, the closing sound waits for it. */
      toggle: () => void | Promise<void>
    }
  | {
      kind: 'range'
      key: string
      label: string
      value: number
      min: number
      max: number
      step: number
      unit?: string
      onChange: (value: number) => void
    }

function resolve(i18n: PascalI18n, text: CalloutText): string {
  return typeof text === 'string' ? text : i18n._(text)
}

const opens = (icon: CalloutIcon) => icon === 'door' || icon === 'window' || icon === 'shutters'

const STEM_MIN = 64
const STEM_MAX = 104
const EDGE = 16

const _box = new Box3()
const _world = new Vector3()
const _ndc = new Vector3()

/**
 * The selected element's label: a dot on it, a hairline rising from the dot,
 * then its name, a detail line, its controls and a close button. It follows
 * the element's world point each frame rather than living inside its object:
 * kinds that rebuild their children (a window opening) would drop it.
 */
export function SelectionCallout({
  object,
  anchor: anchorProp,
  title,
  subtitle,
  actions,
  onDismiss,
}: {
  object: Object3D
  /** Where the dot sits, in the object's space; the centre of its bounds by default. */
  anchor?: Vector3
  title: string
  subtitle?: CalloutText | null
  actions: CalloutAction[]
  onDismiss: () => void
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const rootRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const i18n = usePascalI18n()
  const deselect = i18n._({ id: 'viewer.callout.deselect', message: 'Deselect' })

  // The dot sits at the centre of the element's bounds, in its own space.
  const anchor = useMemo(() => {
    if (anchorProp) return anchorProp
    object.updateWorldMatrix(true, true)
    _box.setFromObject(object)
    if (_box.isEmpty()) return new Vector3()
    return object.worldToLocal(_box.getCenter(new Vector3()))
  }, [object, anchorProp])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Escape deselects, as the close button does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const copyHeight = useRef(0)
  useLayoutEffect(() => {
    const copy = copyRef.current
    if (!copy) return
    const observer = new ResizeObserver(() => {
      copyHeight.current = copy.offsetHeight
    })
    observer.observe(copy)
    copyHeight.current = copy.offsetHeight
    return () => observer.disconnect()
  }, [])

  // Stem height and side follow the canvas: the copy flips left near the right
  // edge and hangs below the dot near the top.
  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    const stem = Math.max(
      copyHeight.current + 12,
      Math.min(STEM_MAX, Math.max(STEM_MIN, size.height * 0.12)),
    )
    _ndc.copy(object.localToWorld(_world.copy(anchor))).project(camera)
    const x = ((_ndc.x + 1) / 2) * size.width
    const y = ((1 - _ndc.y) / 2) * size.height
    const width = copyRef.current?.offsetWidth ?? 0
    root.style.setProperty('--callout-stem', `${stem}px`)
    root.dataset.left = String(x + 12 + width > size.width - EDGE)
    root.dataset.below = String(y - stem < EDGE)
  })

  // Drei places the label from its own group: move that group onto the
  // element's anchor first, so projection and the behind-camera test agree.
  const calculatePosition = useCallback(
    (el: Object3D, view: Camera, viewport: { width: number; height: number }) => {
      object.localToWorld(_world.copy(anchor))
      el.position.copy(el.parent ? el.parent.worldToLocal(_world) : _world)
      el.updateWorldMatrix(false, false)
      _ndc.setFromMatrixPosition(el.matrixWorld).project(view)
      return [((_ndc.x + 1) / 2) * viewport.width, ((1 - _ndc.y) / 2) * viewport.height]
    },
    [object, anchor],
  )

  return (
    <Html calculatePosition={calculatePosition} pointerEvents="none" zIndexRange={[20, 0]}>
      <style>{CALLOUT_CSS}</style>
      <div className="pascal-callout" data-visible={visible} ref={rootRef}>
        <span aria-hidden="true" className="pascal-callout-pin" />
        <span aria-hidden="true" className="pascal-callout-leader" />
        <div
          className="pascal-callout-copy"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          ref={copyRef}
        >
          <strong>{title}</strong>
          {subtitle ? (
            <span className="pascal-callout-detail">{resolve(i18n, subtitle)}</span>
          ) : null}
          <div className="pascal-callout-actions">
            {actions.map((action) =>
              action.kind === 'toggle' ? (
                <ToggleAction action={action} key={action.key} />
              ) : (
                <RangeAction action={action} key={action.key} />
              ),
            )}
            <button
              aria-label={deselect}
              className="pascal-callout-dismiss"
              onClick={onDismiss}
              title={deselect}
              type="button"
            >
              <CalloutGlyph icon="close" on={false} />
            </button>
          </div>
        </div>
      </div>
    </Html>
  )
}

function ToggleAction({ action }: { action: Extract<CalloutAction, { kind: 'toggle' }> }) {
  const i18n = usePascalI18n()
  const text = action.text
    ? resolve(i18n, action.text)
    : i18n._({
        id: 'viewer.callout.state',
        message: '{state, select, open {Open} closed {Closed} on {On} other {Off}}',
        values: {
          state: opens(action.icon) ? (action.on ? 'open' : 'closed') : action.on ? 'on' : 'off',
        },
      })
  const label =
    action.icon === 'shutters'
      ? i18n._({
          id: 'viewer.callout.shuttersAction',
          message:
            '{action, select, close {Close the shutters of {name}} other {Open the shutters of {name}}}',
          values: { action: action.on ? 'close' : 'open', name: action.name },
        })
      : i18n._({
          id: 'viewer.callout.action',
          message:
            '{action, select, open {Open {name}} close {Close {name}} on {Turn on {name}} other {Turn off {name}}}',
          values: {
            action: opens(action.icon) ? (action.on ? 'close' : 'open') : action.on ? 'off' : 'on',
            name: action.text ? resolve(i18n, action.text) : action.name,
          },
        })
  return (
    <button
      aria-label={label}
      aria-pressed={action.on}
      className="pascal-callout-action"
      data-control={action.text ? 'named' : opens(action.icon) ? 'opening' : 'toggle'}
      onClick={() => {
        if (!action.on) emitter.emit('interaction:sound', action.sound.on)
        const settled = action.toggle()
        if (action.on) playClosing(action, settled)
      }}
      title={label}
      type="button"
    >
      <CalloutGlyph icon={action.icon} on={action.on} />
      <span>{text}</span>
    </button>
  )
}

/**
 * A door or window swings shut, then latches as its leaf lands (shutters
 * clap shut as they land); anything without a known end sounds at once.
 */
function playClosing(
  action: Extract<CalloutAction, { kind: 'toggle' }>,
  settled: void | Promise<void>,
) {
  // A garage door's motor runs the whole way, so it starts with the press.
  if (!settled || action.sound.off === 'garage') {
    emitter.emit('interaction:sound', action.sound.off)
    return
  }
  if (action.icon === 'door' || action.icon === 'window')
    emitter.emit('interaction:sound', action.icon === 'door' ? 'door-swing' : 'window-swing')
  void settled.then(() => emitter.emit('interaction:sound', action.sound.off))
}

function RangeAction({ action }: { action: Extract<CalloutAction, { kind: 'range' }> }) {
  return (
    <label className="pascal-callout-action pascal-callout-range">
      <span>
        {action.label} {action.value}
        {action.unit ?? ''}
      </span>
      <input
        aria-label={action.label}
        max={action.max}
        min={action.min}
        onChange={(event) => action.onChange(Number(event.target.value))}
        step={action.step}
        type="range"
        value={action.value}
      />
    </label>
  )
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  )
}

function CalloutGlyph({ icon, on }: { icon: CalloutIcon | 'close'; on: boolean }) {
  switch (icon) {
    case 'light':
      return (
        <Svg>
          <path d="M9 18h6m-5 3h4M8 13a6 6 0 1 1 8 0c-1.2 1-1 2-1 2H9s.2-1-1-2Z" />
          {on ? (
            <path d="M12 1v1M3 4l1 1m16-1-1 1M1 10h1m20 0h-1" />
          ) : (
            <path d="m3 3 18 18" opacity=".6" />
          )}
        </Svg>
      )
    case 'fan':
      return (
        <Svg>
          <circle cx="12" cy="12" r="2" />
          <path d="M10.5 10.5C6 5 10 1 13 3c2 2 0 5-1 7M14 11c6-2 9 3 6 5-2 2-5-1-7-3M11.5 14c-1 6-7 6-8 3-1-3 4-4 7-4" />
          {on ? null : <path d="m3 3 18 18" opacity=".6" />}
        </Svg>
      )
    case 'window':
      return (
        <Svg>
          <path
            d={
              on
                ? 'M3 3h18v18H3ZM3 12h10M13 3v18m0-14 6-2v14l-6-2'
                : 'M3 3h18v18H3ZM12 3v18M3 12h18'
            }
          />
        </Svg>
      )
    case 'door':
      return (
        <Svg>
          <path
            d={on ? 'M3 21h18M5 21V3h14v18M5 3l9 3v15M11 12v2' : 'M3 21h18M5 21V3h14v18M15 12h1'}
          />
        </Svg>
      )
    case 'shutters':
      return (
        <Svg>
          {on ? (
            <>
              <rect height="16" rx="1" width="8" x="8" y="4" />
              <path d="M8 4 3 6v12l5 2M16 4l5 2v12l-5 2" />
            </>
          ) : (
            <>
              <rect height="18" rx="1" width="16" x="4" y="3" />
              <path d="M12 3v18M7 8h2M7 12h2M7 16h2M15 8h2M15 12h2M15 16h2" />
            </>
          )}
        </Svg>
      )
    case 'close':
      return (
        <Svg>
          <path d="m6 6 12 12M6 18 18 6" />
        </Svg>
      )
    default:
      return (
        <Svg>
          <path d="M12 2v9m-5-7a9 9 0 1 0 10 0" />
        </Svg>
      )
  }
}

// The marketing house's callout at dusk: light ink on a dark halo reads over
// any scene; only the controls get a surface.
const CALLOUT_CSS = `
.pascal-callout { --callout-ink:#f1f2f4; --callout-secondary:#e0e3e8; --callout-halo:#000000e0; --callout-halo-soft:#00000080; --callout-control:#24272d70; --callout-active:#e7e9ee2b; position:absolute; width:0; height:0; pointer-events:none; user-select:none; color:var(--callout-ink); text-shadow:0 0 2px var(--callout-halo), 0 1px 6px var(--callout-halo-soft); opacity:0; transition:opacity 70ms ease; }
.pascal-callout[data-visible="true"] { opacity:1; transition-duration:0ms; }
.pascal-callout-pin { position:absolute; left:-2px; top:-2px; width:4px; height:4px; border-radius:50%; background:currentColor; box-shadow:0 0 2px var(--callout-halo); opacity:.8; }
.pascal-callout-leader { position:absolute; left:0; bottom:0; width:1px; height:var(--callout-stem, 100px); background:currentColor; box-shadow:0 0 2px var(--callout-halo); opacity:.48; transform:scaleY(0); transform-origin:bottom; transition:transform 100ms cubic-bezier(.22,1,.36,1); }
.pascal-callout[data-visible="true"] .pascal-callout-leader { transform:scaleY(1); }
.pascal-callout-copy { position:absolute; left:12px; bottom:var(--callout-stem, 100px); width:max-content; transform:translateY(100%); pointer-events:auto; }
.pascal-callout-copy strong { display:block; max-width:min(220px, calc(100vw - 32px)); font-size:15px; line-height:1.3; font-weight:550; letter-spacing:-.015em; }
.pascal-callout-detail { display:block; max-width:min(220px, calc(100vw - 32px)); margin-top:4px; font-size:11px; line-height:1.3; letter-spacing:.025em; font-variant-numeric:tabular-nums; color:var(--callout-secondary); }
.pascal-callout[data-left="true"] .pascal-callout-copy { left:auto; right:12px; text-align:right; }
.pascal-callout[data-left="true"] .pascal-callout-copy strong, .pascal-callout[data-left="true"] .pascal-callout-detail { margin-left:auto; }
.pascal-callout[data-left="true"] .pascal-callout-actions { justify-content:flex-end; }
.pascal-callout[data-below="true"] .pascal-callout-leader { bottom:auto; top:0; transform-origin:top; }
.pascal-callout[data-below="true"] .pascal-callout-copy { bottom:auto; top:var(--callout-stem, 100px); transform:translateY(-100%); }
.pascal-callout-actions { display:flex; flex-wrap:nowrap; gap:6px; margin-top:9px; align-items:center; }
.pascal-callout-actions button, .pascal-callout-range { min-width:44px; height:44px; padding:0 10px; display:inline-flex; align-items:center; justify-content:center; gap:6px; color:var(--callout-ink); font:inherit; font-size:10px; border:1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius:22px; background:var(--callout-control); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); text-shadow:0 0 2px var(--callout-halo), 0 1px 6px var(--callout-halo-soft); cursor:pointer; touch-action:manipulation; white-space:nowrap; }
.pascal-callout-actions button[aria-pressed="true"] { background:var(--callout-active); }
.pascal-callout-actions button:active { transform:scale(.96); }
.pascal-callout-actions button:focus-visible { outline:2px solid var(--callout-ink); outline-offset:3px; }
.pascal-callout-actions svg { width:18px; height:18px; flex:none; filter:drop-shadow(0 0 2px var(--callout-halo)); }
.pascal-callout-action > span { display:inline-block; text-align:left; }
.pascal-callout-action[data-control="toggle"] > span { width:1.7em; }
.pascal-callout-action[data-control="opening"] > span { width:3.4em; }
.pascal-callout-actions .pascal-callout-dismiss { padding:0; background:transparent; border-color:transparent; -webkit-backdrop-filter:none; backdrop-filter:none; }
.pascal-callout-range { cursor:default; }
.pascal-callout-range > span { font-variant-numeric:tabular-nums; }
.pascal-callout-range input { width:96px; accent-color:var(--callout-ink); }
@media (max-width:760px) { .pascal-callout-copy strong, .pascal-callout-detail { max-width:160px; } .pascal-callout-copy strong { font-size:14px; } }
@media (prefers-reduced-motion: reduce) { .pascal-callout, .pascal-callout-leader { transition:none; } }
`
