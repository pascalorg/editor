import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'

/**
 * De-risk spike for item instancing (charter backlog #3a): mounts one
 * BatchedMesh — two geometries, a few hundred instances, one material —
 * through the real render pipeline (post-FX, shadow pass, WebGPU backend).
 * `?spike=batch` only; never mounted in normal sessions.
 *
 * What it proves, read via the ?perf panel + `window.__batchSpike`:
 * - DRAW rises by ~1 per pass, not by the instance count.
 * - TRI drops as instances leave the frustum (perObjectFrustumCulled works).
 * - Shadows cast/receive; no pipeline crash.
 */
export const BATCH_SPIKE_ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('spike') === 'batch'

// `?spike=batch&spikeGrid=70` → 4,900 instances; default 20×20 = 400.
const GRID =
  typeof window !== 'undefined'
    ? Math.min(120, Number(new URLSearchParams(window.location.search).get('spikeGrid')) || 20)
    : 20
const SPACING = 1.2

export const BatchedMeshSpike = () => {
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const box = new THREE.BoxGeometry(0.4, 0.4, 0.4)
    const sphere = new THREE.SphereGeometry(0.25, 16, 12)
    const material = new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.6 })

    const maxVertices =
      (box.attributes.position?.count ?? 0) + (sphere.attributes.position?.count ?? 0)
    const maxIndices = (box.index?.count ?? 0) + (sphere.index?.count ?? 0)
    const batch = new THREE.BatchedMesh(GRID * GRID, maxVertices, maxIndices, material)
    batch.castShadow = true
    batch.receiveShadow = true
    // Default is true — asserted explicitly because per-instance frustum
    // culling is the property the whole plan depends on.
    batch.perObjectFrustumCulled = true

    const boxGeomId = batch.addGeometry(box)
    const sphereGeomId = batch.addGeometry(sphere)
    const m = new THREE.Matrix4()
    let count = 0
    for (let x = 0; x < GRID; x++) {
      for (let z = 0; z < GRID; z++) {
        const geomId = (x + z) % 2 === 0 ? boxGeomId : sphereGeomId
        const id = batch.addInstance(geomId)
        m.setPosition(
          (x - GRID / 2) * SPACING,
          6 + Math.sin(x * 0.7) * 0.5 + Math.cos(z * 0.5) * 0.5,
          (z - GRID / 2) * SPACING,
        )
        batch.setMatrixAt(id, m)
        count++
      }
    }
    scene.add(batch)
    ;(window as unknown as { __batchSpike?: unknown }).__batchSpike = {
      instances: count,
      geometries: 2,
    }

    return () => {
      scene.remove(batch)
      batch.dispose()
      box.dispose()
      sphere.dispose()
      material.dispose()
      delete (window as unknown as { __batchSpike?: unknown }).__batchSpike
    }
  }, [scene])

  return null
}
