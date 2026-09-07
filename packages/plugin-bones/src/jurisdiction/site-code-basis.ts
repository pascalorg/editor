/**
 * The SITE's design values over the state-typical table.
 *
 * The Pascal Map dossier's code basis (ASCE 7 / FBC county wind map, IECC,
 * the state seismic and snow maps) rides the site node as
 * `site.dossier.codeBasis`. Where it answers, it beats the jurisdiction
 * profile's state-typical wind / snow / seismic figures — the county's
 * number, not the state's — and says so once in the warnings. Without it
 * the profile stands verbatim (byte-identical to before this existed).
 */
import type { JurisdictionProfile } from './profiles'

export type SiteCodeBasis = {
  windMph: number | null
  snowPsf: number | null
  sdc: string | null
  debrisRegion: boolean | null
  climateZone: string | null
  frostFt: number | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** The code basis on the scene's site node, or null without one. */
export function siteCodeBasisOf(nodes: Record<string, unknown>): SiteCodeBasis | null {
  for (const node of Object.values(nodes)) {
    const n = node as { type?: unknown; dossier?: { codeBasis?: Record<string, unknown> } }
    if (n?.type !== 'site') continue
    const cb = n.dossier?.codeBasis
    if (!cb || typeof cb !== 'object') return null
    return {
      windMph: num(cb.wind_speed_mph),
      snowPsf: num(cb.ground_snow_load_psf),
      sdc: str(cb.seismic_design_category),
      debrisRegion: typeof cb.wind_borne_debris_region === 'boolean' ? cb.wind_borne_debris_region : null,
      climateZone: str(cb.climate_zone_iecc),
      frostFt: num(cb.frost_depth_ft),
    }
  }
  return null
}

/**
 * The profile with the site's wind / snow / seismic in place of the state's
 * — the derived flags (hurricane ties at 130 mph+, seismic hold-downs in
 * SDC D–F) follow the new values. `note` says what changed, null when
 * nothing did.
 */
export function applySiteCodeBasis(
  profile: JurisdictionProfile,
  basis: SiteCodeBasis | null,
): { profile: JurisdictionProfile; note: string | null } {
  if (!basis) return { profile, note: null }
  const changes: string[] = []
  let next = profile
  if (basis.windMph !== null && basis.windMph !== profile.ultimateWindMph) {
    next = { ...next, ultimateWindMph: basis.windMph, hurricaneTies: basis.windMph >= 130 || profile.hurricaneTies }
    changes.push(`wind ${basis.windMph} mph (state table ${profile.ultimateWindMph})`)
  }
  if (basis.snowPsf !== null && basis.snowPsf !== profile.groundSnowLoadPsf) {
    next = { ...next, groundSnowLoadPsf: basis.snowPsf }
    changes.push(`ground snow ${basis.snowPsf} psf (state table ${profile.groundSnowLoadPsf})`)
  }
  if (basis.sdc !== null && basis.sdc !== profile.seismicSdc) {
    next = { ...next, seismicSdc: basis.sdc, seismicHoldDowns: /^[DEF]/.test(basis.sdc) }
    changes.push(`SDC ${basis.sdc} (state table ${profile.seismicSdc})`)
  }
  if (changes.length === 0) return { profile, note: null }
  return {
    profile: next,
    note: `design values from the site's code basis (Pascal Map — ASCE 7 / FBC county wind map, IECC, state seismic and snow maps): ${changes.join(', ')}; verify with the AHJ`,
  }
}
