import { EDITOR_LAYER } from '@pascal-app/editor'
import {
  BoxGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three'

export function createFeaturePreviewBox() {
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshBasicMaterial({
    color: '#8b5cf6',
    transparent: true,
    opacity: 0.25,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  const edgeGeometry = new EdgesGeometry(geometry)
  const edgeMaterial = new LineBasicMaterial({
    color: '#8b5cf6',
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
  })
  const border = new LineSegments(edgeGeometry, edgeMaterial)
  for (const object of [mesh, border]) {
    object.layers.set(EDITOR_LAYER)
    object.userData.pascalExport = 'strip'
    object.raycast = () => {}
  }
  border.renderOrder = 1
  mesh.add(border)
  return {
    mesh,
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
      edgeGeometry.dispose()
      edgeMaterial.dispose()
    },
  }
}
