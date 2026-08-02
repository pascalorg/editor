export function resolveFloorplanLabelAngle(
  angleRadians: number,
  sceneRotationDeg: number,
  screenUpright = false,
): number {
  if (screenUpright) return -sceneRotationDeg

  let localAngleDeg = (angleRadians * 180) / Math.PI
  let screenAngleDeg = localAngleDeg + sceneRotationDeg
  screenAngleDeg = ((((screenAngleDeg + 180) % 360) + 360) % 360) - 180
  if (screenAngleDeg > 90) localAngleDeg -= 180
  else if (screenAngleDeg <= -90) localAngleDeg += 180
  return ((((localAngleDeg + 180) % 360) + 360) % 360) - 180
}

export function shouldUpdateFloorplanLabelRotation(
  previousRotationDeg: number | null,
  nextRotationDeg: number,
  minimumDeltaDeg = 1,
): boolean {
  if (previousRotationDeg === null) return true
  const deltaDeg = ((((nextRotationDeg - previousRotationDeg + 180) % 360) + 360) % 360) - 180
  return Math.abs(deltaDeg) >= minimumDeltaDeg
}

export function resolveFloorplanAnnotationUpdate({
  layoutInputsChanged,
  previousRotationDeg,
  nextRotationDeg,
}: {
  layoutInputsChanged: boolean
  previousRotationDeg: number | null
  nextRotationDeg: number
}): {
  resolveCollisions: boolean
  updateLabelPresentation: boolean
} {
  return {
    resolveCollisions: layoutInputsChanged,
    updateLabelPresentation:
      layoutInputsChanged ||
      shouldUpdateFloorplanLabelRotation(previousRotationDeg, nextRotationDeg),
  }
}

export function resolveFloorplanAnnotationLabelTransform({
  angleRadians,
  sceneRotationDeg,
  screenUpright,
  beforeRotation,
  afterRotation,
  layoutDx = 0,
  layoutDy = 0,
}: {
  angleRadians: number
  sceneRotationDeg: number
  screenUpright: boolean
  beforeRotation: string
  afterRotation: string
  layoutDx?: number
  layoutDy?: number
}): {
  defaultTransform: string
  transform: string
} {
  const degrees = resolveFloorplanLabelAngle(angleRadians, sceneRotationDeg, screenUpright)
  const defaultTransform = [beforeRotation, `rotate(${degrees})`, afterRotation]
    .filter(Boolean)
    .join(' ')
  return {
    defaultTransform,
    transform:
      layoutDx === 0 && layoutDy === 0
        ? defaultTransform
        : `${defaultTransform} translate(${layoutDx} ${layoutDy})`,
  }
}

export function updateSvgFloorplanLabelOrientations(
  labels: Iterable<SVGGElement>,
  sceneRotationDeg: number,
): number {
  let updated = 0

  for (const label of labels) {
    const angleRadians = Number(label.dataset.floorplanAnnotationAngleRadians)
    if (!Number.isFinite(angleRadians)) continue

    const { defaultTransform, transform } = resolveFloorplanAnnotationLabelTransform({
      angleRadians,
      sceneRotationDeg,
      screenUpright: label.dataset.floorplanAnnotationScreenUpright === 'true',
      beforeRotation: label.dataset.floorplanAnnotationTransformBeforeRotation ?? '',
      afterRotation: label.dataset.floorplanAnnotationTransformAfterRotation ?? '',
      layoutDx: Number(label.dataset.floorplanAnnotationLayoutDx ?? 0),
      layoutDy: Number(label.dataset.floorplanAnnotationLayoutDy ?? 0),
    })
    if (label.getAttribute('transform') === transform) continue

    label.dataset.floorplanAnnotationDefaultTransform = defaultTransform
    label.setAttribute('transform', transform)
    updated += 1
  }

  return updated
}
