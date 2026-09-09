'use client'

import { useGLTFKTX2 } from '@pascal-app/viewer'
import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { DoubleSide, FrontSide, type Material, type Mesh, type Object3D } from 'three'
import { USDLoader } from 'three/addons/loaders/USDLoader.js'
import { rewriteLoopbackAssetUrl } from '../asset-url'
import type { CaptureModelFormat } from '../stream-rendering'

export function CaptureRoomModel({
  dollhouse,
  format,
  mediaType,
  opacity = 100,
  url,
}: {
  dollhouse?: boolean
  format?: CaptureModelFormat
  mediaType: string
  opacity?: number
  url: string
}) {
  if (
    format === 'usdz' ||
    mediaType === 'model/vnd.usdz+zip' ||
    url.toLowerCase().endsWith('.usdz')
  ) {
    return <UsdzRoomModel dollhouse={dollhouse} opacity={opacity} url={url} />
  }
  return <GlbRoomModel dollhouse={dollhouse} opacity={opacity} url={url} />
}

function UsdzRoomModel({
  dollhouse,
  opacity,
  url,
}: {
  dollhouse?: boolean
  opacity: number
  url: string
}) {
  const source = useLoader(USDLoader, rewriteLoopbackAssetUrl(url))
  const model = useClonedModel(source, opacity, dollhouse)
  return <primitive object={model} />
}

function GlbRoomModel({
  dollhouse,
  opacity,
  url,
}: {
  dollhouse?: boolean
  opacity: number
  url: string
}) {
  const gltf = useGLTFKTX2(rewriteLoopbackAssetUrl(url)) as { scene: Object3D }
  const model = useClonedModel(gltf.scene, opacity, dollhouse)
  return <primitive object={model} />
}

function useClonedModel(source: Object3D, opacity: number, dollhouse?: boolean): Object3D {
  const model = useMemo(() => {
    const clone = source.clone(true)
    clone.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (dollhouse !== undefined) material.side = dollhouse ? FrontSide : DoubleSide
      }
    })
    return clone
  }, [source, dollhouse])

  useEffect(() => {
    const normalizedOpacity = opacity / 100
    const transparent = normalizedOpacity < 1
    model.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        material.transparent = transparent
        material.opacity = normalizedOpacity
        material.depthWrite = !transparent
        material.needsUpdate = true
      }
    })
  }, [model, opacity])

  useEffect(
    () => () => {
      model.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) material.dispose()
      })
    },
    [model],
  )

  return model
}
