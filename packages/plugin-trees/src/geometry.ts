import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three'
import { TREE_PRESETS } from './presets'
import type { TreeNode } from './schema'

/**
 * Pure procedural tree builder. Returns a `Group` of low-poly meshes in local
 * space with the base at y=0 growing along +Y — the framework's renderer
 * applies the node's position/rotation, so this never bakes world placement in.
 * Depends only on `three` + the node's own `preset`/`height`/`seed`, which is
 * why the definition's `geometryKey` can skip rebuilds on move/reparent.
 *
 * `seed` drives a tiny deterministic RNG so two oaks with different seeds get
 * subtly different canopies without persisting per-vertex data.
 */
export function buildTreeGeometry(node: TreeNode): Group {
  const group = new Group()
  const spec = TREE_PRESETS[node.preset] ?? TREE_PRESETS.oak
  const height = Math.max(0.5, node.height)
  const rng = mulberry32(node.seed >>> 0)

  const trunkHeight = height * spec.trunkFraction
  const trunkRadius = Math.max(0.05, height * 0.04)
  const trunkMat = new MeshStandardMaterial({ color: spec.trunkColor, roughness: 0.9 })
  const foliageMat = new MeshStandardMaterial({ color: spec.foliageColor, roughness: 0.8 })

  const trunk = new Mesh(
    new CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 7),
    trunkMat,
  )
  trunk.position.y = trunkHeight / 2
  trunk.name = 'tree-trunk'
  group.add(trunk)

  const canopyHeight = height - trunkHeight
  const canopyBase = trunkHeight

  if (node.preset === 'pine') {
    // Three stacked cones, narrowing toward the top.
    const tiers = 3
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers
      const radius = height * 0.26 * (1 - t * 0.55) * (0.92 + rng() * 0.16)
      const tierHeight = (canopyHeight / tiers) * 1.5
      const cone = new Mesh(new ConeGeometry(radius, tierHeight, 8), foliageMat)
      cone.position.y = canopyBase + canopyHeight * t + tierHeight * 0.25
      cone.name = `tree-canopy-${i}`
      group.add(cone)
    }
  } else if (node.preset === 'palm') {
    // A crown of angled cone fronds at the top of a tall bare trunk.
    const fronds = 6
    const frondLength = height * 0.4
    for (let i = 0; i < fronds; i++) {
      const angle = (i / fronds) * Math.PI * 2 + rng() * 0.4
      const frond = new Mesh(new ConeGeometry(height * 0.05, frondLength, 5), foliageMat)
      frond.position.set(
        Math.cos(angle) * frondLength * 0.35,
        canopyBase + frondLength * 0.2,
        Math.sin(angle) * frondLength * 0.35,
      )
      frond.rotation.z = Math.PI / 2.4
      frond.rotation.y = -angle
      frond.name = `tree-frond-${i}`
      group.add(frond)
    }
  } else {
    // oak / birch — a rounded canopy: a low-poly icosahedron plus a couple of
    // smaller offset spheres for a hand-clustered look.
    const canopyRadius = height * 0.28
    const crown = new Mesh(new IcosahedronGeometry(canopyRadius, 0), foliageMat)
    crown.position.y = canopyBase + canopyHeight * 0.5
    crown.name = 'tree-canopy'
    group.add(crown)

    const blobs = 2
    for (let i = 0; i < blobs; i++) {
      const blob = new Mesh(new SphereGeometry(canopyRadius * 0.6, 6, 5), foliageMat)
      const angle = rng() * Math.PI * 2
      blob.position.set(
        Math.cos(angle) * canopyRadius * 0.6,
        canopyBase + canopyHeight * (0.4 + rng() * 0.4),
        Math.sin(angle) * canopyRadius * 0.6,
      )
      blob.name = `tree-canopy-blob-${i}`
      group.add(blob)
    }
  }

  return group
}

/** Deterministic 32-bit RNG (mulberry32) — same seed ⇒ same canopy. */
function mulberry32(seed: number): () => number {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
