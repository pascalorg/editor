import { type Material, MaterialBlending } from 'three'
import { diffuseColor, mrt, uniform, vec4 } from 'three/tsl'
import { BlendMode } from 'three/webgpu'
import { importedUnlitMaterial } from './gltf-unlit'

const materialBlend = new BlendMode(MaterialBlending)

/**
 * Keeps a material out of the bloom: editor highlights (selection, hover, delete) glow a little
 * to read as marked, and must not haze over the object under a night exposure.
 */
export function markNoBloom<T extends Material>(material: T): T {
  material.userData.noBloom = true
  return material
}

/**
 * Per-pixel weights. R: screen-space AO/GI applies (unlit assets already contain their lighting
 * and must not be lit again). G: the pixel feeds the bloom ({@link markNoBloom}).
 */
export function sceneLightingMask() {
  const weight = uniform(1).onObjectUpdate(({ material }) =>
    importedUnlitMaterial(material) ? 0 : 1,
  )
  const bloomWeight = uniform(1).onObjectUpdate(({ material }) =>
    material?.userData.noBloom ? 0 : 1,
  )
  return vec4(weight, bloomWeight, 0, diffuseColor.a)
}

/**
 * The scene pass's attachments. three blends `output` by the material and leaves every other
 * attachment unblended, so a transparent draw overwrites the whole of what it covers in the normals
 * and the diffuse colour, however faint it is: a dust sprite's square was inked as an edge. With the
 * material's blending on them, a draw that writes alpha 0 there (the dust's `mrtNode`) leaves them
 * as they are, and an opaque draw, which has no blending, still overwrites.
 */
export function scenePassMrt(outputs: Parameters<typeof mrt>[0]) {
  return mrt(outputs)
    .setBlendMode('diffuseColor', materialBlend)
    .setBlendMode('normal', materialBlend)
    .setBlendMode('lighting', materialBlend)
}
