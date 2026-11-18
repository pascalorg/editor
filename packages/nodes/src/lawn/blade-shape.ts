export const LAWN_NEAR_POSITIONS = new Float32Array([
  -0.5, 0, 0, 0.5, 0, 0, -0.34, 0.4, 0, 0.34, 0.4, 0, -0.16, 0.75, 0, 0.16, 0.75, 0, 0, 1, 0,
])
export const LAWN_NEAR_INDICES = new Uint16Array([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6])
export const LAWN_MID_POSITIONS = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0])
export const LAWN_MID_INDICES = new Uint16Array([0, 1, 2])

export function lawnBladePoint(
  widthOffset: number,
  progress: number,
  height: number,
  yaw: number,
  lean: number,
  wind: number,
  seconds: number,
  rootX: number,
  rootZ: number,
): [number, number, number] {
  const gust =
    Math.sin(rootX * 0.19 + rootZ * 0.13 + seconds * 1.7) * 0.65 +
    Math.sin(rootX * 0.43 - rootZ * 0.27 + seconds * 2.3) * 0.35
  const bend = progress * progress * height
  return [
    Math.cos(yaw) * widthOffset + (Math.sin(yaw) * lean * 1.6 + gust * wind * 0.42) * bend,
    progress * height,
    -Math.sin(yaw) * widthOffset + (Math.cos(yaw) * lean * 1.6 + gust * wind * 0.22) * bend,
  ]
}
