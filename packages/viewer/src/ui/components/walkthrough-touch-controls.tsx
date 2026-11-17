'use client'

import { usePascalI18n } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import { useWalkthroughInputLifecycle } from '../../hooks/use-walkthrough-input-lifecycle'
import { createWalkthroughInput, onWalkthroughInputClear } from '../../lib/walkthrough-input'
import { useFirstPersonHud } from '../../store/use-first-person-hud'
import useViewer from '../../store/use-viewer'
import { cn } from '../lib/cn'
import { createWalkthroughTouchGestures, STICK_RADIUS } from '../lib/walkthrough-touch'

export type WalkthroughTouchControlsProps = { className?: string }

/** Mount outside the canvas. The host chooses touch mode before entering walkthrough. */
export function WalkthroughTouchControls(props: WalkthroughTouchControlsProps) {
  const active = useViewer(
    (state) => state.walkthroughMode && state.walkthroughInputMode === 'touch',
  )
  return active ? <TouchSession {...props} /> : null
}

function TouchSession({ className }: WalkthroughTouchControlsProps) {
  const i18n = usePascalI18n()
  const target = useFirstPersonHud((state) => state.interact)
  const shuttersInView = useFirstPersonHud((state) => state.shuttersInView)
  const canClose = useFirstPersonHud((state) => state.canClose)
  const stickRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const gestures = useMemo(
    () =>
      createWalkthroughTouchGestures((visual) => {
        const stick = stickRef.current
        const knob = knobRef.current
        if (!stick || !knob) return
        stick.style.display = visual ? 'block' : 'none'
        if (visual) {
          stick.style.left = `${visual.x - STICK_RADIUS}px`
          stick.style.top = `${visual.y - STICK_RADIUS}px`
          knob.style.transform = `translate(${visual.dx}px, ${visual.dy}px)`
        }
      }),
    [],
  )
  useWalkthroughInputLifecycle()
  useEffect(() => onWalkthroughInputClear(gestures.reset), [gestures])
  const input = createWalkthroughInput()
  const buttonClass =
    'pointer-events-auto rounded-full border border-border bg-background/80 px-5 py-3 font-medium text-foreground shadow-sm backdrop-blur disabled:opacity-40'

  return (
    <div
      className={cn('fixed inset-0 z-40 select-none text-foreground', className)}
      data-walkthrough-touch-controls=""
      onLostPointerCapture={gestures.lost}
      onPointerCancel={gestures.cancel}
      onPointerUp={gestures.up}
      style={{ touchAction: 'none' }}
    >
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        data-walkthrough-stick=""
        onPointerDown={gestures.stickDown}
        onPointerMove={gestures.stickMove}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        data-walkthrough-look=""
        onPointerDown={gestures.lookDown}
        onPointerMove={gestures.lookMove}
      />
      <div
        className="pointer-events-none fixed rounded-full border border-border bg-background/40 backdrop-blur"
        ref={stickRef}
        style={{ display: 'none', width: STICK_RADIUS * 2, height: STICK_RADIUS * 2 }}
      >
        <div
          className="absolute top-1/2 left-1/2 -mt-5 -ml-5 h-10 w-10 rounded-full border border-border bg-foreground/30"
          ref={knobRef}
        />
      </div>
      <div className="pointer-events-none absolute right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex max-w-[calc(100%-3rem)] flex-wrap justify-end gap-3">
        {shuttersInView && (
          <button
            className={buttonClass}
            data-walkthrough-shutters=""
            onPointerDown={(event) => {
              if (gestures.buttonDown(event)) input.requestShutters()
            }}
            type="button"
          >
            {i18n._({ id: 'viewer.walkthrough.shutters', message: 'Shutters' })}
          </button>
        )}
        {canClose && (
          <button
            className={buttonClass}
            onPointerDown={(event) => {
              if (gestures.buttonDown(event)) input.requestClose()
            }}
            type="button"
          >
            {i18n._({ id: 'viewer.walkthroughTouch.close', message: 'Close' })}
          </button>
        )}
        <button className={buttonClass} onPointerDown={gestures.crouchDown} type="button">
          {i18n._({ id: 'viewer.walkthroughTouch.crouch', message: 'Crouch' })}
        </button>
        <button
          className={buttonClass}
          onPointerDown={(event) => {
            if (gestures.buttonDown(event)) input.requestJump()
          }}
          type="button"
        >
          {i18n._({ id: 'viewer.walkthroughTouch.jump', message: 'Jump' })}
        </button>
        <button
          className={buttonClass}
          disabled={!target}
          onPointerDown={(event) => {
            if (target && gestures.buttonDown(event)) input.requestInteract()
          }}
          type="button"
        >
          {i18n._({ id: 'viewer.walkthroughTouch.interact', message: 'Interact' })}
        </button>
      </div>
      <button
        className={cn(
          buttonClass,
          'absolute top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1.5rem,env(safe-area-inset-right))]',
        )}
        onClick={gestures.exit}
        onPointerDown={gestures.buttonDown}
        type="button"
      >
        {i18n._({ id: 'viewer.walkthroughTouch.exit', message: 'Exit' })}
      </button>
    </div>
  )
}
