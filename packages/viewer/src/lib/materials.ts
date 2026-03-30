import { type MaterialProperties, type MaterialSchema, resolveMaterial } from '@pascal-app/core'
import * as THREE from 'three'

const sideMap: Record<MaterialProperties['side'], THREE.Side> = {
  front: THREE.FrontSide,
  back: THREE.BackSide,
  double: THREE.DoubleSide,
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

function getCacheKey(props: MaterialProperties): string {
  return `${props.color}-${props.roughness}-${props.metalness}-${props.opacity}-${props.transparent}-${props.side}`
}

export function createMaterial(material?: MaterialSchema): THREE.MeshStandardMaterial {
  const props = resolveMaterial(material)
  const cacheKey = getCacheKey(props)

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!
  }

  const threeMaterial = new THREE.MeshStandardMaterial({
    color: props.color,
    roughness: props.roughness,
    metalness: props.metalness,
    opacity: props.opacity,
    transparent: props.transparent,
    side: sideMap[props.side],
  })

  materialCache.set(cacheKey, threeMaterial)
  return threeMaterial
}

export function createDefaultMaterial(
  color: string = '#ffffff',
  roughness: number = 0.9,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    side: THREE.FrontSide,
  })
}

export const DEFAULT_WALL_MATERIAL = createDefaultMaterial('#ffffff', 0.9)
export const DEFAULT_SLAB_MATERIAL = createDefaultMaterial('#e5e5e5', 0.8)
export const DEFAULT_DOOR_MATERIAL = createDefaultMaterial('#8b4513', 0.7)
export const DEFAULT_WINDOW_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#87ceeb',
  roughness: 0.1,
  metalness: 0.1,
  opacity: 0.3,
  transparent: true,
  side: THREE.DoubleSide,
})
export const DEFAULT_CEILING_MATERIAL = createDefaultMaterial('#f5f5dc', 0.95)
export const DEFAULT_ROOF_MATERIAL = createDefaultMaterial('#808080', 0.85)

export function disposeMaterial(material: THREE.Material): void {
  material.dispose()
}

export function clearMaterialCache(): void {
  for (const material of materialCache.values()) {
    material.dispose()
  }
  materialCache.clear()
}
