export function pulseInputSource(
  inputSource: XRInputSource | undefined,
  intensity = 0.2,
  duration = 35,
) {
  const actuator = inputSource?.gamepad?.hapticActuators?.[0]
  if (!actuator || typeof actuator.pulse !== 'function') return false
  void actuator.pulse(intensity, duration)
  return true
}
