import { type AuditEventKey, readAuditEvent } from '../audit-events'
import { LOCALE } from '../casing'
import type { Lang } from '../types'
import { type Dictionary, en } from './en'
import { tr } from './tr'

export const dictionaries: Record<Lang, Dictionary> = { en, tr }
export const DEFAULT_LANG: Lang = 'en'
export type { Dictionary }

export function dictionaryFor(lang: Lang): Dictionary {
  return dictionaries[lang] ?? en
}

/**
 * Compile-time proof that every audit event the server can write has copy to
 * render it. `tr` is typed as `Dictionary`, so satisfying this for English
 * satisfies it for Turkish too.
 */
const _auditCoverage: Record<AuditEventKey, string> = en.audit
void _auditCoverage

/**
 * The audit trail, in the reader's language.
 *
 * Falls back to the stored English sentence whenever there is no event to
 * render from — rows written before events existed, and any row whose meta did
 * not survive. That is a permanent fallback, not a migration step: history is
 * not rewritten, it is read as it was written.
 */
export function auditText(
  dict: Dictionary,
  entry: { message: string; meta?: Record<string, unknown> | null },
): string {
  const event = readAuditEvent(entry.meta)
  if (!event) return entry.message

  const template = (dict.audit as Record<string, string | undefined>)[event.k]
  if (!template) return entry.message

  return format(template, event.p ?? {})
}

/** Replaces `{name}` placeholders. Anything unmatched is left as-is, visibly. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  )
}

/**
 * Number and date formatting are locale-bound (K8): 12.480 in Turkish, 12,480 in
 * English. Going through Intl rather than hand-rolling separators is what keeps
 * that true for every value, not just the ones someone remembered to convert.
 *
 * The locale table is shared with the casing helper — formatting and casing must
 * never disagree about what "tr" means.
 */

export function formatNumber(lang: Lang, value: number): string {
  return new Intl.NumberFormat(LOCALE[lang]).format(value)
}

export function formatDate(lang: Lang, value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short', timeStyle: 'short' }).format(
    date,
  )
}

export function formatDateOnly(lang: Lang, value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'short' }).format(date)
}

/**
 * Turkish sorting lives in the app layer, never in the database (section 10) —
 * MySQL's utf8mb4_0900_ai_ci gets İ/ı wrong and moving the rule into a collation
 * would make it invisible.
 */
export function collator(lang: Lang): Intl.Collator {
  return new Intl.Collator(LOCALE[lang], { sensitivity: 'base', numeric: true })
}

/**
 * Resolves an `err.*` key from the API into display text. Unknown keys fall back
 * to the generic server error rather than rendering the raw key at the user.
 */
export function resolveApiMessage(
  dict: Dictionary,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const map: Record<string, string> = {
    'err.credentials': dict.errCreds,
    'err.locked': dict.errLocked,
    'err.suspended': dict.errSuspended,
    'err.inactive': dict.errInactive,
    'err.ssoRequired': dict.errSsoRequired,
    'err.mfaInvalid': dict.errCode,
    'err.recoveryInvalid': dict.recErr,
    'err.sessionExpired': dict.sessionExpiredTitle,
    'err.tokenInvalid': dict.errTokenInvalid,
    'err.tokenExpired': dict.errTokenExpired,
    'err.tokenUsed': dict.errTokenUsed,
    'err.inviteExpired': dict.errInviteExpired,
    'err.inviteRevoked': dict.errInviteRevoked,
    'err.passwordPolicy': dict.errPasswordPolicy,
    'err.passwordMismatch': dict.errPasswordMismatch,
    'err.policyRequired': dict.errPolicyRequired,
    'err.validation': dict.errValidation,
    'err.usernameChars': dict.errUsernameChars,
    'err.forbidden': dict.errForbidden,
    'err.primaryAdminProtected': dict.errPrimaryAdminProtected,
    'err.cannotDeleteSelf': dict.errCannotDeleteSelf,
    'err.mailFailed': dict.errMailFailed,
    'err.logsRestricted': dict.c.logsRestrictedLead,
    'err.siteExists': dict.errSiteExists,
    'err.hookHttps': dict.errHookHttps,
    'err.eventRequired': dict.errEventRequired,
    'err.badJson': dict.errValidation,
    'err.server': dict.errServer,
  }
  return format(map[key] ?? dict.errServer, values)
}
