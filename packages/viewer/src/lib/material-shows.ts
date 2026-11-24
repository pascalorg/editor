import type { Material } from 'three'

/** Whether the material draws a surface, excluding pick-only proxies and near-invisible sheets. */
export function materialShows(material: Material | Material[]): boolean {
  const list = Array.isArray(material) ? material : [material]
  return list.some(
    (m) =>
      m && m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity <= 0.02),
  )
}
