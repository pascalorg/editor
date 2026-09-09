'use client'

import { useEffect, useMemo } from 'react'
import { DoubleSide, FrontSide } from 'three'
import { createClayMatcap } from './clay-matcap'
import { createSurfaceMeshGeometry } from './surface-mesh-data'

export { buildSurfaceMeshData, type SurfaceMeshData } from './surface-mesh-data'

export function CaptureSurfaceMeshLayer({
  inline,
  dollhouse = false,
  appearance = 'recorded',
}: {
  inline: unknown
  dollhouse?: boolean
  appearance?: 'clay' | 'recorded'
}) {
  const matcap = useMemo(() => (appearance === 'clay' ? createClayMatcap() : null), [appearance])
  useEffect(() => () => matcap?.dispose(), [matcap])
  const geometry = useMemo(() => createSurfaceMeshGeometry(inline), [inline])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <mesh frustumCulled={false} geometry={geometry}>
      {matcap ? (
        <meshMatcapMaterial matcap={matcap} side={dollhouse ? FrontSide : DoubleSide} />
      ) : (
        <meshStandardMaterial
          metalness={0}
          roughness={0.9}
          side={dollhouse ? FrontSide : DoubleSide}
          vertexColors
        />
      )}
    </mesh>
  )
}
