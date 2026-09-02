/**
 * Zero-network jurisdiction guessing. The plugin's privacy contract is "no
 * external origins", so instead of IP geolocation we read two things the
 * browser already knows:
 *
 *  1. `Intl.DateTimeFormat().resolvedOptions().timeZone` — IANA zone ids name
 *     actual cities (`America/Denver`, `America/Indiana/Indianapolis`), which
 *     maps to a US state (or Canadian province) for every US/CA zone.
 *  2. `navigator.language` region subtag — a non-US/CA locale (fr-FR, de-DE…)
 *     falls back to the INTL profile.
 *
 * This is a SUGGESTION rendered in the panel ("guessed from your browser") —
 * the dropdown always wins. A host that wants real IP geolocation can pass
 * its own default; that stays host integration, not plugin network access.
 */

const TZ_STATE: Record<string, string> = {
  'America/New_York': 'NY',
  'America/Detroit': 'MI',
  'America/Kentucky/Louisville': 'KY',
  'America/Kentucky/Monticello': 'KY',
  'America/Indiana/Indianapolis': 'IN',
  'America/Indiana/Vincennes': 'IN',
  'America/Indiana/Winamac': 'IN',
  'America/Indiana/Marengo': 'IN',
  'America/Indiana/Petersburg': 'IN',
  'America/Indiana/Vevay': 'IN',
  'America/Indiana/Tell_City': 'IN',
  'America/Indiana/Knox': 'IN',
  'America/Chicago': 'TX',
  'America/Menominee': 'MI',
  'America/North_Dakota/Center': 'ND',
  'America/North_Dakota/New_Salem': 'ND',
  'America/North_Dakota/Beulah': 'ND',
  'America/Denver': 'CO',
  'America/Boise': 'ID',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'CA',
  'America/Anchorage': 'AK',
  'America/Juneau': 'AK',
  'America/Sitka': 'AK',
  'America/Metlakatla': 'AK',
  'America/Yakutat': 'AK',
  'America/Nome': 'AK',
  'America/Adak': 'AK',
  'Pacific/Honolulu': 'HI',

  // Canada. Ontario is split three ways (the frost line runs 1200mm in the
  // GTA to 2100mm at Thunder Bay), so the zone picks the region it names.
  // Caveat: modern tzdata folds Montreal into America/Toronto, so Quebec
  // users land on southern Ontario and have to pick their province by hand.
  'America/Toronto': 'CA-ON-S',
  'America/Nipigon': 'CA-ON-N',
  'America/Thunder_Bay': 'CA-ON-N',
  'America/Atikokan': 'CA-ON-N',
  'America/Rainy_River': 'CA-ON-N',
  'America/Blanc-Sablon': 'CA-QC',
  // Legacy tzdata id (pre-fold): an environment still reporting
  // America/Montreal NAMES Montreal, so the zone picks the region it names
  // — Quebec directly, no Toronto detour. Modern tzdata reports
  // America/Toronto for Montreal (the caveat above).
  'America/Montreal': 'CA-QC',
  'America/Winnipeg': 'CA-MB',
  'America/Regina': 'CA-SK',
  'America/Swift_Current': 'CA-SK',
  'America/Edmonton': 'CA-AB',
  'America/Vancouver': 'CA-BC',
  'America/Dawson_Creek': 'CA-BC',
  'America/Fort_Nelson': 'CA-BC',
  'America/Creston': 'CA-BC',
  'America/Halifax': 'CA-NS',
  'America/Glace_Bay': 'CA-NS',
  'America/Moncton': 'CA-NB',
  'America/St_Johns': 'CA-NL',
  'America/Goose_Bay': 'CA-NL',
  'America/Whitehorse': 'CA-YT',
  'America/Dawson': 'CA-YT',
  'America/Yellowknife': 'CA-NT',
  'America/Inuvik': 'CA-NT',
  'America/Iqaluit': 'CA-NU',
  'America/Rankin_Inlet': 'CA-NU',
  'America/Cambridge_Bay': 'CA-NU',
  'America/Resolute': 'CA-NU',
}

/** Read-only view of the zone→jurisdiction table for the data-shape gate
 * (every mapped code must resolve to a real profile row). */
export const TZ_GUESS_TABLE: Readonly<Record<string, string>> = TZ_STATE

export type JurisdictionGuess = {
  code: string
  /** Why we guessed it — shown next to the dropdown. */
  reason: string
}

export function guessJurisdiction(
  /** Test seam: inject the browser signals instead of reading them (gates
   * the zone→code table + locale fallbacks without faking `Intl`). */
  signals?: { tz?: string; lang?: string },
): JurisdictionGuess {
  try {
    const tz = signals?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    const byTz = TZ_STATE[tz]
    if (byTz) return { code: byTz, reason: `guessed from timezone ${tz}` }
    const lang =
      signals?.lang ??
      (typeof navigator !== 'undefined' ? (navigator.language ?? navigator.languages?.[0]) : '')
    const region = lang?.split('-')[1]?.toUpperCase()
    if (region === 'US') return { code: 'TX', reason: `US locale (${lang}), unknown state` }
    if (region === 'CA') {
      return { code: 'CA-GEN', reason: `Canadian locale (${lang}), unknown province` }
    }
    if (region) return { code: 'INTL', reason: `non-US locale (${lang})` }
  } catch {
    // SSR or restricted environment — fall through.
  }
  return { code: 'INTL', reason: 'no locale signal' }
}

/** Resolve the config value: 'AUTO' → the browser guess, else pass-through. */
export function resolveJurisdiction(configured: string): { code: string; auto: boolean } {
  if (configured !== 'AUTO') return { code: configured, auto: false }
  return { code: guessJurisdiction().code, auto: true }
}
