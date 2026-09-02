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

export function isXRCancelPressed(inputSources: readonly XRInputSource[]): boolean {
  const rightController = inputSources.find(
    (source) => source.handedness === 'right' && source.gamepad != null,
  )
  return rightController?.gamepad?.buttons[5]?.pressed === true
}

export function didXRButtonPressStart(previousPressed: boolean, nextPressed: boolean): boolean {
  return !previousPressed && nextPressed
}
