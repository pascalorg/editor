import {
  Fn,
  float,
  interleavedGradientNoise,
  reference,
  screenCoordinate,
  texture,
  textureLoad,
  vec2,
  vogelDiskSample,
} from 'three/tsl'

/**
 * PCSS-style sun shadow filter (percentage-closer soft shadows) for the
 * WebGPU shadow path, plugged in via `LightShadow.filterNode`.
 *
 * Contact-hardening: a blocker search estimates the average occluder depth
 * around the receiver, the receiver–blocker gap sets the penumbra width, and
 * a rotated Vogel-disk PCF filters at that radius. Near contact points the
 * radius collapses to a texel (crisp), far from the caster it widens (soft) —
 * unlike plain PCF whose blur is uniform everywhere.
 *
 * The shadow's `radius` property scales the maximum penumbra, so themes/tuning
 * keep a single knob. Both loops are fixed-count and unrolled (plain JS loops
 * over TSL expressions), sidestepping WGSL uniform-control-flow issues.
 */

// Penumbra width in shadow-map UV per unit of normalized receiver–blocker
// depth gap. The ortho depth range spans the building bounds, so ~0.02 UV per
// unit reads as a sun-like penumbra; `shadow.radius` multiplies on top.
const PENUMBRA_SCALE = 0.02
// Blocker search radius in texels — how far to look for occluders.
const BLOCKER_SEARCH_TEXELS = 8
const BLOCKER_SAMPLES = 8
const PCF_SAMPLES = 12
const TWO_PI = 6.28318530718

export const PCSSShadowFilter = Fn(
  ({ depthTexture, shadowCoord, shadow, depthLayer }: any) => {
    const mapSize: any = reference('mapSize', 'vec2', shadow)
    const radius: any = reference('radius', 'float', shadow)
    const texelSize = vec2(1).div(mapSize)

    // Raw depth reads use texelFetch (textureLoad) — the sampled path would
    // inherit the comparison sampler the PCF taps bind, which WGSL rejects.
    const depthAt = (uv: any) => {
      const texel = uv.mul(mapSize).toIVec2()
      let depth: any = textureLoad(depthTexture, texel)
      if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer)
      return depth.x
    }
    const shadowCompare = (uv: any, compare: any) => {
      let depth: any = texture(depthTexture, uv)
      if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer)
      return depth.compare(compare)
    }

    const receiverDepth: any = shadowCoord.z

    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(TWO_PI)

    // 1. Blocker search: average depth of occluders inside the search disk.
    const searchRadius = texelSize.x.mul(BLOCKER_SEARCH_TEXELS)
    let blockerSum: any = float(0)
    let blockerCount: any = float(0)
    for (let i = 0; i < BLOCKER_SAMPLES; i++) {
      const offset = vogelDiskSample(float(i), float(BLOCKER_SAMPLES), phi).mul(searchRadius)
      const sampleDepth = depthAt(shadowCoord.xy.add(offset))
      const isBlocker = sampleDepth.lessThan(receiverDepth).toFloat()
      blockerSum = blockerSum.add(sampleDepth.mul(isBlocker))
      blockerCount = blockerCount.add(isBlocker)
    }
    const avgBlocker = blockerSum.div(blockerCount.max(1))

    // 2. Penumbra estimate: receiver–blocker gap (parallel sun rays) scaled by
    // the shadow's radius knob, clamped between crisp (1 texel) and the search
    // window so the PCF disk never outruns the blocker estimate.
    const penumbra = receiverDepth
      .sub(avgBlocker)
      .mul(PENUMBRA_SCALE)
      .mul(radius)
      .clamp(texelSize.x, searchRadius)

    // 3. Variable-radius PCF with the same rotated Vogel disk.
    let lit: any = float(0)
    for (let i = 0; i < PCF_SAMPLES; i++) {
      const offset = vogelDiskSample(float(i), float(PCF_SAMPLES), phi).mul(penumbra)
      lit = lit.add(shadowCompare(shadowCoord.xy.add(offset), receiverDepth))
    }
    lit = lit.div(PCF_SAMPLES)

    // Fully lit when the blocker search found nothing (early-out semantics
    // without branching).
    return blockerCount.lessThanEqual(0).select(float(1), lit)
  },
)
