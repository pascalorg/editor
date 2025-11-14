import { Edges } from '@react-three/drei'
import { useEffect, useState } from 'react'
import * as THREE from 'three'

interface SelectionBoxProps {
  group: React.RefObject<THREE.Group | null>
}

export function SelectionBox({ group }: SelectionBoxProps) {
  const [size, setSize] = useState<THREE.Vector3 | null>(null)
  const [center, setCenter] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!group.current) return

    const updateBounds = () => {
      const innerGroup = group.current!

      // Force update of world matrices to ensure accurate calculation
      innerGroup.updateMatrixWorld(true)

      // Calculate bounding box in local space by manually computing it
      const box = new THREE.Box3()
      let hasContent = false

      innerGroup.traverse((child) => {
        if (child === innerGroup) return

        // For meshes with geometry
        if (child instanceof THREE.Mesh && child.geometry) {
          const geometry = child.geometry

          if (!geometry.boundingBox) {
            geometry.computeBoundingBox()
          }

          if (geometry.boundingBox) {
            hasContent = true
            // Get the geometry bounds in local space
            const localBox = geometry.boundingBox.clone()

            // Transform by the mesh's matrix (relative to inner group)
            // We need the transform from inner group to this child
            const relativeMatrix = new THREE.Matrix4()
            relativeMatrix.copy(child.matrix)

            // If child has a parent chain within innerGroup, accumulate their matrices
            let current = child.parent
            while (current && current !== innerGroup) {
              relativeMatrix.premultiply(current.matrix)
              current = current.parent
            }

            localBox.applyMatrix4(relativeMatrix)
            box.union(localBox)
          }
        }
      })

      if (!hasContent || box.isEmpty()) return

      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      setSize(size)
      setCenter(center)
    }

    updateBounds()
  }, [group])

  if (!(size && center)) return null

  return (
    <mesh position={center}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial opacity={0} transparent />
      <Edges color="#00ff00" dashSize={0.1} depthTest={false} gapSize={0.05} linewidth={2} />
    </mesh>
  )
}
