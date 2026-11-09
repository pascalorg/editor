import { Color, type Material } from 'three'

/**
 * Marks an editor highlight material (selection, hover, delete): a clone of the object's own
 * material with a soft emissive tint, so it reads as marked. The daylight look must not treat
 * that tint as a glowing surface (no night boost, no exposure lift, no bloom): the object stays
 * readable under it at any time of day.
 */
export function markHighlight<T extends Material>(material: T): T {
  material.userData.editorHighlight = true
  // three shares a compiled program between materials of the same shape (userData aside): a
  // highlight must get its own, or it renders with its source's and the daylight hooks miss it.
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${key()}|editor-highlight`
  return material
}

export function isHighlight(material: Material | null | undefined): boolean {
  return material?.userData.editorHighlight === true
}

/**
 * Adds a highlight tint to `material`'s emission: its own glow (a lamp's shade) as it was, plus
 * `color` × `amount`. The intensity is folded into the colour (and set to 1): a material's default
 * intensity is 1, so raising it to the tint's would have run the tint at full strength.
 */
export function tintEmissive(material: Material, color: Color, amount: number): void {
  const m = material as Material & { emissive?: Color; emissiveIntensity?: number }
  if (!(m.emissive instanceof Color)) return
  m.emissive = m.emissive
    .clone()
    .multiplyScalar(m.emissiveIntensity ?? 1)
    .add(color.clone().multiplyScalar(amount))
  m.emissiveIntensity = 1
}
