import { type Material, Vector3 } from 'three'

/**
 * A shared, always-on wind — the plugin's equivalent of ez-tree's demo wind, but
 * driven through a single set of uniforms referenced by every patched material,
 * so one per-frame `uTime` update sways the whole scene (trees, flowers, grass).
 * The sway is injected into each material's `begin_vertex` so the standard
 * instancing / view / lighting pipeline runs untouched on the displaced vertex.
 */
export const WIND = {
  uTime: { value: 0 },
  /** Sway amplitude per axis (metres of horizontal offset per metre of height). */
  uWindStrength: { value: new Vector3(0.05, 0, 0.05) },
  uWindFrequency: { value: 1.2 },
}

// Object-space sway added to `transformed`. Amplitude grows with height above
// the root (`transformed.y`), so bases stay planted and tips move most. Each
// instance is de-phased by a hash of its world-space root, so a forest doesn't
// sway in lockstep. `USE_INSTANCING` guards keep the same material valid for the
// non-instanced placement ghost.
const WIND_GLSL = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec3 windRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec3 windRoot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float windPhase = fract(sin(dot(windRoot.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float windT = uTime * uWindFrequency + windPhase;
  float windAmp = max(transformed.y, 0.0);
  transformed.x += windAmp * uWindStrength.x * sin(windT) * cos(windT * 1.4 + windPhase);
  transformed.z += windAmp * uWindStrength.z * sin(windT + 1.3) * cos(windT * 1.2 + windPhase);
}
`

type Patchable = Material & { __windPatched?: boolean }

function patchOne(material: Material): void {
  const m = material as Patchable
  if (m.__windPatched) return
  m.__windPatched = true
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer)
    shader.uniforms.uTime = WIND.uTime
    shader.uniforms.uWindStrength = WIND.uWindStrength
    shader.uniforms.uWindFrequency = WIND.uWindFrequency
    shader.vertexShader =
      'uniform float uTime;\nuniform vec3 uWindStrength;\nuniform float uWindFrequency;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${WIND_GLSL}`,
      )
  }
  material.needsUpdate = true
}

/** Inject the shared wind into a material (or each material of an array).
 * Idempotent — safe to call once per cached variant material. */
export function applyWind(material: Material | Material[]): void {
  if (Array.isArray(material)) for (const m of material) patchOne(m)
  else patchOne(material)
}
