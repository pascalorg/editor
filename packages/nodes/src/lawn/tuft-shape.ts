// XY describes the silhouette; Z selects its crossing plane.
export const MID_TUFT = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0])
export const MID_ORDER = new Uint16Array([0, 1, 2, 2, 1, 3])
export const NEAR_TUFT = new Float32Array([
  -0.5, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 1, 0.5, 0, 1,
  -0.5, 1, 1, 0.5, 1, 1,
])
export const NEAR_ORDER = new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 6, 7, 8, 8, 7, 9])
