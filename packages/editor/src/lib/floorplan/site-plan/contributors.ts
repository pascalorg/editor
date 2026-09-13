/**
 * Site-plan contributors — how plugin packages put their own kinds on the
 * site plan without the editor depending on them.
 *
 * The site-plan layer draws only what `buildSitePlanDrawing` returns (it
 * replaces the registry layer, so `def.floorplan` is not consulted in site
 * view). A plugin whose kinds live in SITE metres (utilities: poles, runs,
 * service points) registers a contributor at bootstrap; its primitives are
 * appended to every site-plan drawing, on screen and on sheets alike.
 */
import type { FloorplanGeometry, SceneSnapshot } from '@pascal-app/core'

export type SitePlanContributor = (scene: SceneSnapshot) => { primitives: FloorplanGeometry[] } | null

const contributors = new Map<string, SitePlanContributor>()

export function registerSitePlanContributor(key: string, contributor: SitePlanContributor): void {
  contributors.set(key, contributor)
}

export function sitePlanContributions(scene: SceneSnapshot): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  for (const [key, contributor] of contributors) {
    try {
      const result = contributor(scene)
      if (result) out.push(...result.primitives)
    } catch (error) {
      if (typeof console !== 'undefined') console.warn(`[site-plan] contributor ${key} failed`, error)
    }
  }
  return out
}
