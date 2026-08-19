'use client'

import { useGLTFKTX2 } from '@pascal-app/viewer'
import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Material, Mesh, Object3D } from 'three'
import { USDLoader } from 'three/addons/loaders/USDLoader.js'
import { rewriteLoopbackAssetUrl } from '../asset-url'
import type { CaptureModelFormat } from '../stream-rendering'

export function CaptureRoomModel({
  format,
  mediaType,
  opacity = 100,
  url,
}: {
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
    return <UsdzRoomModel opacity={opacity} url={url} />
  }
  return <GlbRoomModel opacity={opacity} url={url} />
}

function UsdzRoomModel({ opacity, url }: { opacity: number; url: string }) {
  const source = useLoader(USDLoader, rewriteLoopbackAssetUrl(url))
  const model = useClonedModel(source, opacity)
  return <primitive object={model} />
}

function GlbRoomModel({ opacity, url }: { opacity: number; url: string }) {
  const gltf = useGLTFKTX2(rewriteLoopbackAssetUrl(url)) as { scene: Object3D }
  const model = useClonedModel(gltf.scene, opacity)
  return <primitive object={model} />
}

function useClonedModel(source: Object3D, opacity: number): Object3D {
  const model = useMemo(() => {
    const clone = source.clone(true)
    clone.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone()
    })
    return clone
  }, [source])

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
