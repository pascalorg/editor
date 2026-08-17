import type { Object3D } from 'three'

function isFlameObject(object: Object3D): boolean {
  return Boolean(
    object.userData.cabinetFlameJet ||
      object.userData.cabinetFlamePulse ||
      object.userData.cabinetFlameMaterialPulse,
  )
}

export function collectCabinetFlameObjects(root: Object3D): Object3D[] {
  const objects: Object3D[] = []
  root.traverse((object) => {
    if (isFlameObject(object)) objects.push(object)
  })
  return objects
}
