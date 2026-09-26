/**
 * Site-plan contributors — how plugin packages put their own kinds on the
 * site plan without the editor depending on them.
 *
 * The site-plan layer draws only what `buildSitePlanDrawing` returns (it
 * replaces the registry layer, so `def.floorplan` is not consulted in site
 * view). A plugin whose kinds live in SITE metres (utilities: poles, runs,
 * service points) registers a contributor at bootstrap; its primitives are
 * appended to every site-plan drawing, on screen and on sheets alike. A
 * plugin that locates the house's utility services also passes `services`,
 * and the site plan runs them schematically to the street.
 */
import type { AnyNodeId, FloorplanGeometry, SceneSnapshot } from '@pascal-app/core'

export type SitePlanContributor = (
  scene: SceneSnapshot,
) => { primitives: FloorplanGeometry[] } | null

export type SitePlanServiceRole = 'electric' | 'water' | 'sewer'

/**
 * Where one service leaves the house, in the storey's plan frame. A point
 * hosted by a wall with no position of its own sits `wallT` along `wallId`.
 */
export type SitePlanServicePoint = {
  role: SitePlanServiceRole | 'ac' | 'pole'
  position: readonly [number, number, number]
  wallId?: AnyNodeId
  wallT?: number
}

export type SitePlanServices = {
  /** The storey's service points; the first point of each role is drawn. */
  points?: (scene: SceneSnapshot, levelId: AnyNodeId) => readonly SitePlanServicePoint[]
  /** The storey's electric service entrance, when the plugin decides it. */
  entrance?: (scene: SceneSnapshot, levelId: AnyNodeId) => 'overhead' | 'underground' | null
  /** Services the plugin already draws as its own run, so the site plan does not route them. */
  drawnRuns?: (scene: SceneSnapshot) => readonly SitePlanServiceRole[]
}

type Registration = { draw: SitePlanContributor | null; services?: SitePlanServices }

const contributors = new Map<string, Registration>()
const listeners = new Set<() => void>()

export function registerSitePlanContributor(
  key: string,
  contributor: SitePlanContributor | null,
  services?: SitePlanServices,
): void {
  contributors.set(key, { draw: contributor, services })
  for (const listener of listeners) listener()
}

/** Whether any plugin has put its kinds on the site plan. */
export function hasSitePlanContributors(): boolean {
  return contributors.size > 0
}

export function subscribeSitePlanContributors(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function sitePlanContributions(scene: SceneSnapshot): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  for (const [key, { draw }] of contributors) {
    if (!draw) continue
    try {
      const result = draw(scene)
      if (result) out.push(...result.primitives)
    } catch (error) {
      if (typeof console !== 'undefined')
        console.warn(`[site-plan] contributor ${key} failed`, error)
    }
  }
  return out
}

/** Every registered `services` hook's answer, in registration order; a throwing hook is skipped. */
export function sitePlanServiceAnswers<T>(
  ask: (services: SitePlanServices) => T | null | undefined,
): T[] {
  const out: T[] = []
  for (const [key, { services }] of contributors) {
    if (!services) continue
    try {
      const answer = ask(services)
      if (answer !== null && answer !== undefined) out.push(answer)
    } catch (error) {
      if (typeof console !== 'undefined') console.warn(`[site-plan] services ${key} failed`, error)
    }
  }
  return out
}
