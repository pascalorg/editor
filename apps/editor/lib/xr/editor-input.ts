export class XRSelectReleaseGuard {
  private readonly cycles = new WeakMap<XRInputSource, { nodeClicked: boolean }>()

  start(source: XRInputSource) {
    this.cycles.set(source, { nodeClicked: false })
  }

  markNodeClick(source: XRInputSource) {
    const cycle = this.cycles.get(source)
    if (cycle) cycle.nodeClicked = true
  }

  cancel(source: XRInputSource) {
    this.cycles.delete(source)
  }

  deferEmptyRelease(source: XRInputSource, onEmptyRelease: () => void) {
    const cycle = this.cycles.get(source)
    if (!cycle) return

    queueMicrotask(() => {
      if (this.cycles.get(source) !== cycle) return
      this.cycles.delete(source)
      if (!cycle.nodeClicked) onEmptyRelease()
    })
  }
}

export type XRReleaseAction =
  | 'defer-empty-selection'
  | 'emit-tool-grid-click'
  | 'finish-placement-drag'
  | 'ignore'

export function replayXRWallOpeningRelease<T>(
  event: T | null,
  emit: (suffix: 'move' | 'click', event: T) => void,
): boolean {
  if (!event) return false
  emit('move', event)
  emit('click', event)
  return true
}

export function resolveXRReleaseAction({
  mode,
  placementDrag,
  scopeKind,
}: {
  mode: string
  placementDrag: boolean
  scopeKind: string
}): XRReleaseAction {
  if (placementDrag) return 'finish-placement-drag'
  // Paint is committed by the shared node click handler, just like desktop
  // paint. Do not also route an empty XR release through grid tool logic.
  if (mode === 'material-paint') return 'ignore'
  if (mode !== 'select') return 'emit-tool-grid-click'
  return scopeKind === 'idle' ? 'defer-empty-selection' : 'ignore'
}

export function selectPrimaryXRInputSource(
  inputSources: readonly XRInputSource[],
  activeInputSource?: XRInputSource | null,
): XRInputSource | null {
  if (activeInputSource && inputSources.includes(activeInputSource)) return activeInputSource

  return (
    inputSources.find(
      (source) => source.handedness === 'right' && source.targetRayMode === 'tracked-pointer',
    ) ??
    inputSources.find((source) => source.targetRayMode === 'tracked-pointer') ??
    null
  )
}

export function shouldRouteXRMove(
  source: XRInputSource | null,
  capturedSource: XRInputSource | null,
  panelHit: boolean,
): boolean {
  if (!source) return false
  return source === capturedSource || !panelHit
}

export function shouldReleaseCapturedXRInput(
  inputSources: readonly XRInputSource[],
  capturedSource: XRInputSource | null,
): boolean {
  return capturedSource != null && !inputSources.includes(capturedSource)
}

export function isXRCancelPressed(inputSources: readonly XRInputSource[]): boolean {
  const rightController = inputSources.find(
    (source) => source.handedness === 'right' && source.gamepad != null,
  )
  return rightController?.gamepad?.buttons[5]?.pressed === true
}

export function didXRButtonPressStart(previousPressed: boolean, nextPressed: boolean): boolean {
  return !previousPressed && nextPressed
}

export function pulseXRInputSource(
  source: XRInputSource,
  intensity = 0.18,
  durationMs = 25,
): boolean {
  const actuator = (
    source.gamepad as
      | (Gamepad & {
          hapticActuators?: readonly {
            pulse: (intensity: number, duration: number) => Promise<boolean>
          }[]
        })
      | null
  )?.hapticActuators?.[0]
  if (!actuator) return false

  try {
    void actuator.pulse(intensity, durationMs).catch(() => undefined)
    return true
  } catch {
    return false
  }
}
