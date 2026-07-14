import {
  abs,
  colorToDirection,
  float,
  max,
  min,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl'

// The TSL node types aren't cleanly exported from `three/tsl`. The scene/ink
// color inputs are loose node handles at this shader boundary, but the result
// is always a vec3 color node — pin that so the `vec4(...)` wrap at the call
// site type-checks without an escape-hatch cast.
type Vec3Node = ReturnType<typeof vec3>

// Screen-space ink outline (SketchUp / Moebius look). Reads the scene-pass
// depth + normal MRT and inks two signals:
//
//   1. Crease  — center normal vs each neighbour (`1 - dot`): 0 on a flat
//      surface, ~1 at a 90° corner. Catches wall↔roof, wall↔wall and window-
//      reveal creases. Normals are re-normalized because the 8-bit normal MRT
//      decodes to non-unit vectors, which otherwise crushes the signal.
//   2. Depth   — raw-depth Laplacian (screen-linear across planes → ~0 on flat
//      ground, no banding) normalized by (1 - depth)² so it becomes ≈
//      worldStep / near, i.e. DISTANCE-INDEPENDENT (a window reveal reads the
//      same zoomed in or out). A raw-Laplacian gate rejects flat-plane
//      quantization noise so the far ground/roof never inks.
//
// Topology-agnostic: works on CSG triangle soup, organic GLBs, anything — it
// only sees the rendered buffers. `intensity` scales the final mask; `inkColor`
// should track the background luminance (dark lines on light scenes).
export function inkedEdges({
  depthTex,
  normalTex,
  inkColor,
  radius,
  opacity,
  sceneRgb,
}: {
  depthTex: any
  normalTex: any
  inkColor: any
  // Line thickness in px (the detected band is ~2×radius) and final line
  // darkness — these are what distinguish soft (thin/faint) from strong
  // (thick/solid); the edge masks themselves saturate, so a gain wouldn't.
  radius: number
  opacity: number
  sceneRgb: any
}): Vec3Node {
  const px = vec2(1, 1).div(screenSize).mul(radius)
  const uvN = screenUV

  const dC = depthTex.sample(uvN).r
  const dR = depthTex.sample(uvN.add(vec2(px.x, 0))).r
  const dL = depthTex.sample(uvN.sub(vec2(px.x, 0))).r
  const dU = depthTex.sample(uvN.add(vec2(0, px.y))).r
  const dD = depthTex.sample(uvN.sub(vec2(0, px.y))).r

  const depthLap = abs(dR.add(dL).add(dU).add(dD).sub(dC.mul(4)))
  const invDepth = float(1).sub(dC)
  const depthMetric = depthLap.div(invDepth.mul(invDepth).add(float(0.00002)))
  const noiseGate = smoothstep(float(0.00002), float(0.00006), depthLap)
  // ≈ metres of step / near (near≈0.1): ~5cm starts a line, ~25cm solid.
  const depthEdge = smoothstep(float(0.5), float(2.5), depthMetric).mul(noiseGate)

  const nC = colorToDirection(normalTex.sample(uvN)).normalize()
  const nR = colorToDirection(normalTex.sample(uvN.add(vec2(px.x, 0)))).normalize()
  const nL = colorToDirection(normalTex.sample(uvN.sub(vec2(px.x, 0)))).normalize()
  const nU = colorToDirection(normalTex.sample(uvN.add(vec2(0, px.y)))).normalize()
  const nD = colorToDirection(normalTex.sample(uvN.sub(vec2(0, px.y)))).normalize()
  const nDiff = max(
    max(float(1).sub(nC.dot(nR)), float(1).sub(nC.dot(nL))),
    max(float(1).sub(nC.dot(nU)), float(1).sub(nC.dot(nD))),
  )
  const normalEdge = smoothstep(float(0.01), float(0.05), nDiff)

  const edgeMask = min(max(depthEdge, normalEdge).mul(opacity), float(1))
  // TSL's node types are not exported from `three/tsl`, so `sceneRgb`/`inkColor`
  // stay loose node handles and `mix`'s overload resolves to its float form.
  // At runtime this mixes two vec3 colors and produces a vec3; the two node
  // types don't structurally overlap for a direct assertion, so an `unknown`
  // bridge to `Vec3Node` is unavoidable — but it still hands callers a correct,
  // non-`any` return type (which `vec4(...)` at the call site requires).
  return mix(sceneRgb, inkColor, edgeMask) as unknown as Vec3Node
}
