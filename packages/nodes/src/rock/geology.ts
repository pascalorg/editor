/*!
 * Garden-focused TSL adaptation of loverocks geology-detail.glsl and surface-detail.glsl.
 * @license MIT Copyright (c) 2026 wrong-nebula. See this package's LICENSE.
 * Procedural mineral fabric only; no third-party maps or atmosphere code.
 */
import { type RockLevel, type RockNode, type RockSpan, rockCentre } from '@pascal-app/core'
import { Vector3 } from 'three'
import {
  color,
  Fn,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_float,
  normalViewGeometry,
  normalWorldGeometry,
  positionLocal,
  positionView,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'

/** sRGB authoring colours; TSL color() converts these to the renderer's linear working space. */
export const ROCK_BASE_COLORS: Record<RockNode['rockType'], string> = {
  boulder: '#89847b',
  fjord: '#7c8384',
  granite: '#b1a39b',
  volcanic: '#514c48',
  river: '#8a8980',
  stacked: '#978c79',
  stepping: '#92958d',
}

const noise = (p: Node<'vec3'>) => mx_noise_float(p).mul(0.5).add(0.5)
const fbm = (p: Node<'vec3'>, octaves = 3) =>
  mx_fractal_noise_float(p, octaves, 2.13, 0.5).mul(0.5).add(0.5)
const fade = (footprint: Node<'float'>, frequency: number) =>
  smoothstep(0.3, 0.9, footprint.mul(frequency)).oneMinus()
const mask = (value: Node<'float'>, threshold: Node<'float'> | number) => {
  const width = value.fwidth().mul(0.75).max(0.012)
  const edge = typeof threshold === 'number' ? float(threshold) : threshold
  return smoothstep(edge.sub(width), edge.add(width), value)
}

/**
 * Screen-space surface gradient for a procedural height in metres. UV differencing cannot
 * perturb a position-driven field. Guard grazing/degenerate derivatives and bound the slope.
 */
function reliefNormal(height: Node<'float'>) {
  return Fn(() => {
    const n = normalViewGeometry.normalize().toVar()
    const dx = positionView.dFdx().toVar()
    const dy = positionView.dFdy().toVar()
    const r1 = dy.cross(n).toVar()
    const r2 = n.cross(dx).toVar()
    const determinant = dx.dot(r1).toVar()
    const gradient = r1
      .mul(height.dFdx())
      .add(r2.mul(height.dFdy()))
      .mul(determinant.sign())
      .div(determinant.abs().max(1e-10))
    const bounded = gradient.div(gradient.length().max(0.65).div(0.65))
    return n.sub(bounded).normalize()
  })()
}

/** Owned by the returned geometry tree; no global cache and no rounded/first-value-wins keys. */
export function rockMaterial(
  rock: RockNode,
  span: RockSpan = { footY: -0.3, topY: rock.height },
  level: RockLevel = 'near',
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: ROCK_BASE_COLORS[rock.rockType],
    metalness: 0,
    roughness: 0.86,
  })
  material.name = `rock-geology-${rock.rockType}-${level}`
  const [cx, cz] = rockCentre(rock.polygon)
  const p = positionLocal.sub(uniform(new Vector3(cx, span.footY, cz)))
  // Bounded seed translations keep detail stable across placement and avoid loss of GPU precision.
  const seed = rock.seed >>> 0
  const q = p.add(
    uniform(
      new Vector3(
        (seed % 251) * 0.137,
        ((seed >>> 8) % 241) * 0.173,
        ((seed >>> 16) % 239) * 0.193,
      ),
    ),
  )
  const height = p.y.div(uniform(span.topY - span.footY))
  const footprint = p.dFdx().length().max(p.dFdy().length()).max(1e-6)
  const broad = fbm(q.mul(1.7), level === 'near' ? 3 : 2)
  const weather = uniform(rock.weathering)
  const mossAmount = uniform(rock.moss)
  const lichenAmount = uniform(rock.lichen)
  let stone: Node<'vec3'> = color(ROCK_BASE_COLORS[rock.rockType]).mul(broad.mul(0.32).add(0.81))
  let roughness: Node<'float'> = float(rock.rockType === 'river' ? 0.56 : 0.82)
  let relief: Node<'float'> = float(0)

  // Finite, bent joint traces, a broader oxidised rind and pale healed veinlets.
  const warp = broad.sub(0.5).mul(0.065)
  const traceA = p.x
    .mul(0.29)
    .add(p.y.mul(0.84))
    .add(p.z.mul(0.18))
    .add(warp)
    .sub(uniform(0.45 + (seed % 13) * 0.063))
    .abs()
  const traceB = p.z
    .mul(0.73)
    .sub(p.x.mul(0.21))
    .add(p.y.mul(0.18))
    .add(warp)
    .sub(uniform(((seed >>> 4) % 11) * 0.057 - 0.2))
    .abs()
  const trace = traceA.min(traceB)
  const lineWidth = trace.fwidth().max(0.0015)
  const finite = smoothstep(0.26, 0.58, broad)
  const crack = smoothstep(float(0.004).sub(lineWidth).max(0), lineWidth.add(0.009), trace)
    .oneMinus()
    .mul(finite)
    .mul(rock.rockType === 'river' ? 0.2 : 1)
  const rind = smoothstep(0.012, weather.mul(0.07).add(0.065), trace).oneMinus().mul(finite)

  if (level === 'near') {
    // Mineral grain at three scales fades to its mean when subpixel, not a noisy distant shimmer.
    const grain = noise(q.mul(34)).sub(0.5).mul(fade(footprint, 34))
    const fine = noise(q.mul(102)).sub(0.5).mul(fade(footprint, 102))
    const grit = noise(q.mul(230)).sub(0.5).mul(fade(footprint, 230))
    stone = stone.mul(grain.mul(0.15).add(fine.mul(0.08)).add(1))
    relief = grain.mul(weather.mul(0.002).add(0.0025)).add(fine.mul(0.0008)).add(grit.mul(0.00025))

    if (rock.rockType === 'granite') {
      // Warped feldspar phenocrysts in an interlocking quartz/plagioclase groundmass,
      // with ragged mafic clusters. Not a uniform Voronoi colour mosaic.
      const warp3 = vec3(
        noise(q.mul(15.3)),
        noise(q.mul(15.3).add(5.1)),
        noise(q.mul(15.3).add(9.7)),
      ).sub(0.5)
      const crystals = mx_worley_noise_float(q.add(warp3.mul(0.035)).mul(vec3(25.8, 33, 28.8)))
      const feldspar = smoothstep(0.12, 0.24, crystals).mul(
        smoothstep(0.42, 0.62, crystals).oneMinus(),
      )
      const white = mask(fbm(q.mul(45)).add(noise(q.mul(123)).sub(0.5).mul(0.18)), 0.45)
      const mafics = mask(fbm(q.mul(64)).add(fbm(q.mul(8.1)).sub(0.5).mul(0.16)), 0.65)
      const quartz = mix(color('#959997'), color('#d4d2c9'), white)
      const pink = mix(color('#b99c8d'), color('#d8b8a5'), noise(q.mul(63)))
      let fabric = mix(quartz, pink, feldspar.mul(0.67))
      fabric = mix(fabric, color('#42413c'), mafics.mul(0.88))
      stone = mix(color(ROCK_BASE_COLORS.granite), fabric, fade(footprint, 45)).mul(
        grain.mul(0.1).add(0.97),
      )
      roughness = mix(weather.mul(0.2).add(0.58), weather.mul(0.22).add(0.43), mafics)
      relief = relief.add(crystals.mul(0.0007).mul(fade(footprint, 33)))
    } else if (rock.rockType === 'volcanic') {
      const pores = mx_worley_noise_float(q.mul(28))
      const cavities = smoothstep(0.12, 0.28, pores).oneMinus().mul(fade(footprint, 28))
      const rust = smoothstep(0.5, 0.72, broad)
      stone = mix(stone, color('#6c4939'), rust.mul(0.38))
      stone = stone.mul(cavities.mul(0.58).oneMinus())
      roughness = float(0.95)
      relief = relief.sub(cavities.mul(0.007))
    } else if (rock.rockType === 'river') {
      // A thin healed fracture through the stone, not a noise contour that closes into loops.
      const vein = p.y
        .add(p.x.mul(0.26))
        .sub(p.z.mul(0.13))
        .add(noise(q.mul(3.2)).sub(0.5).mul(0.035))
        .add(noise(q.mul(19)).sub(0.5).mul(0.003))
        .sub(uniform((span.topY - span.footY) * 0.42))
        .abs()
      const veinWidth = vein.fwidth().max(0.001)
      const quartz = smoothstep(
        float(0.004).sub(veinWidth).max(0),
        veinWidth.add(0.008),
        vein,
      ).oneMinus()
      stone = mix(stone, color('#b5b5a7'), quartz.mul(0.28))
      relief = relief.mul(0.23)
    }
  }

  if (
    rock.strata ||
    rock.rockType === 'fjord' ||
    rock.rockType === 'stacked' ||
    rock.rockType === 'stepping'
  ) {
    const bed = p.y.add(p.x.mul(0.13)).add(p.z.mul(0.07)).add(broad.mul(0.075))
    const phase = bed.mul(rock.rockType === 'fjord' ? 38 : 24)
    const layers = phase.sin().mul(0.5).add(0.5)
    const filtered = mix(float(0.5), layers, smoothstep(0.3, 1, phase.fwidth()).oneMinus())
    stone = mix(stone, color(rock.rockType === 'fjord' ? '#555f66' : '#77664f'), filtered.mul(0.16))
    if (level === 'near') relief = relief.add(filtered.mul(0.0018))
  }
  stone = mix(stone, color('#8a7961'), rind.mul(weather.mul(0.24)))
  stone = stone.mul(crack.mul(0.64).oneMinus())
  if (level === 'near') relief = relief.sub(crack.mul(weather.mul(0.003).add(0.004)))

  // Moss favours catchment, damp basal margins and sheltered joints. World geometry normals
  // avoid feeding the perturbed normal back into its own habitat/normal calculation.
  const up = smoothstep(0.1, 0.82, normalWorldGeometry.y)
  const base = smoothstep(0.06, 0.32, height).oneMinus()
  const habitat = up.mul(0.65).add(base.mul(0.52)).add(rind.mul(0.65)).clamp()
  const colonies = smoothstep(
    float(0.64).sub(mossAmount.mul(0.43)),
    float(0.83).sub(mossAmount.mul(0.36)),
    broad.add(habitat.mul(0.28)),
  )
  let moss = colonies.mul(habitat).mul(mossAmount.mul(2.2).min(1))
  const cushionedMoss = rock.rockType !== 'river' && rock.rockType !== 'stacked'
  if (cushionedMoss) {
    // Moist catchments support opaque colonies with a ragged boundary, not a
    // translucent green wash. Amount controls their extent; habitat keeps bare faces.
    const edge = float(0.76).sub(mossAmount.mul(0.4))
    const colonyField = broad.add(habitat.mul(0.18))
    const halfWidth = colonyField.fwidth().mul(1.25).add(0.0275)
    const midpoint = edge.add(0.0275)
    moss = smoothstep(midpoint.sub(halfWidth), midpoint.add(halfWidth), colonyField)
      .mul(smoothstep(0.18, 0.52, habitat))
      .mul(mossAmount.mul(2.2).min(1))
  }
  let mossColor: Node<'vec3'> = cushionedMoss
    ? mix(color('#2e451e'), color('#667d46'), smoothstep(0.25, 0.75, broad))
    : mix(color('#394527'), color('#6e7941'), broad)
  if (level === 'near' && rock.moss > 0) {
    const cushions = noise(q.mul(19)).mul(fade(footprint, 19))
    const fibres = noise(q.mul(145)).sub(0.5).mul(fade(footprint, 145))
    mossColor = mossColor.mul(cushions.mul(0.22).add(fibres.mul(0.18)).add(0.88))
    relief = relief.mul(moss.oneMinus()).add(cushions.mul(moss).mul(cushionedMoss ? 0.009 : 0.006))
    if (cushionedMoss) relief = relief.add(fibres.mul(0.0013).add(0.0025).mul(moss))
  }
  stone = mix(stone, mossColor, moss)
  roughness = mix(roughness, float(0.97), moss)

  if (rock.lichen > 0) {
    const colonyNoise = level === 'near' ? noise(q.mul(12.5)) : broad
    const lichen = mask(colonyNoise.add(up.mul(0.12)), float(0.8).sub(lichenAmount.mul(0.31)))
      .mul(lichenAmount)
      .mul(moss.oneMinus())
    stone = mix(stone, mix(color('#a3a379'), color('#c1b98e'), broad), lichen)
    roughness = mix(roughness, float(0.94), lichen)
  }
  material.colorNode = stone
  material.roughnessNode = roughness
  // The far graph never constructs Voronoi, grain, fibre or derivative-normal work.
  if (level === 'near') material.normalNode = reliefNormal(relief)
  return material
}
