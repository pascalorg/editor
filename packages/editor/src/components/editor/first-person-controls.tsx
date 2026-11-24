'use client'

import { useHasPointAskHandler, usePascalI18n, useScene } from '@pascal-app/core'
import { LiveWalkthroughController, useFirstPersonHud, useViewer } from '@pascal-app/viewer'
import { DroneHud, WalkthroughHud } from '@pascal-app/viewer/ui'
import { useCallback, useMemo } from 'react'
import useEditor from '../../store/use-editor'
import { usePointAsk } from '../../store/use-point-ask'

const selectPointAskEngaged = (state: ReturnType<typeof usePointAsk.getState>) =>
  state.active ||
  Boolean(state.bubble) ||
  Boolean(state.cardFor && state.pins[state.cardFor]?.behavior === 'persistent')

export function FirstPersonControls() {
  const capture = useEditor((state) => state.isCaptureMode)
  const paused = useEditor((state) => state.captureShutterHold)
  const pointAskEngaged = usePointAsk(selectPointAskEngaged)
  // Read at walkthrough start and end, as the capture rig may own the FOV by then.
  const captureOwnsFov = useCallback(() => useEditor.getState().isCaptureMode, [])
  const onExit = useCallback(() => {
    const editor = useEditor.getState()
    if (editor.isCaptureMode) editor.setCaptureMode(false)
    else editor.setFirstPersonMode(false)
  }, [])

  return (
    <LiveWalkthroughController
      externalFov={captureOwnsFov}
      externalOverlayActive={pointAskEngaged}
      onExit={onExit}
      paused={paused}
      pointerInteraction={!capture}
      suspendOnUnlock={capture || pointAskEngaged}
    />
  )
}

export const FirstPersonOverlay = ({ onExit }: { onExit: () => void }) => {
  const i18n = usePascalI18n()
  const hasPlacedSpawn = useScene((state) =>
    Object.values(state.nodes).some((node) => node.type === 'spawn'),
  )
  const floorLabel = useFirstPersonHud((state) => state.floorLabel)
  const zoneLabel = useFirstPersonHud((state) => state.zoneLabel)
  const interact = useFirstPersonHud((state) => state.interact)
  const suspended = useViewer((state) => state.walkthroughSuspended)
  const isDroneMode = useEditor((state) => state.firstPersonMovementMode === 'drone')
  const hasPointAsk = useHasPointAskHandler()
  const pointAskEngaged = usePointAsk(selectPointAskEngaged)

  const extraHints = useMemo(
    () =>
      hasPointAsk
        ? [
            {
              keys: ['C'],
              action: i18n._({ id: 'editor.walkthroughHud.comment', message: 'comment' }),
            },
          ]
        : undefined,
    [hasPointAsk, i18n],
  )

  const handleExit = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    onExit()
  }, [onExit])

  if (isDroneMode) {
    return (
      <DroneHud
        extraHints={extraHints}
        hideBottomHints={pointAskEngaged}
        hideCrosshair={pointAskEngaged}
        onExit={handleExit}
        suspended={suspended}
      />
    )
  }

  return (
    <WalkthroughHud
      extraHints={extraHints}
      floorLabel={floorLabel}
      hideBottomHints={pointAskEngaged}
      hideCrosshair={pointAskEngaged}
      interact={interact}
      onExit={handleExit}
      suspended={suspended}
      zoneLabel={zoneLabel}
    >
      {!hasPlacedSpawn && (
        <div className="corner-smooth rounded-full border border-border/40 bg-background/80 px-3 py-1 text-center text-muted-foreground text-xs shadow-elevation-3 backdrop-blur-xl">
          Place a spawn point from the Build tab to control where walkthrough starts.
        </div>
      )}
    </WalkthroughHud>
  )
}
