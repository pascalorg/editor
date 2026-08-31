export function resolveAttachmentPreviewRotation(
  freeRotation: number,
  attachmentRotation: number | null,
): number {
  return attachmentRotation ?? freeRotation
}

export function rigidPlanSvgTransform({
  from,
  fromRotation,
  to,
  toRotation,
}: {
  from: readonly [number, number]
  fromRotation: number
  to: readonly [number, number]
  toRotation: number
}): string {
  const rotationDegrees = (-(toRotation - fromRotation) * 180) / Math.PI
  if (Math.abs(rotationDegrees) < 1e-10) {
    return `translate(${to[0] - from[0]} ${to[1] - from[1]})`
  }
  return `translate(${to[0]} ${to[1]}) rotate(${rotationDegrees}) translate(${-from[0]} ${-from[1]})`
}
