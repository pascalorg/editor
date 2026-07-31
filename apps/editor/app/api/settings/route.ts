import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type SettingsResponse, updateSettingsSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission, requireSession } from '@panel/lib/auth/guard'
import { exec } from '@panel/lib/db'
import { getSettings, invalidateSettingsCache } from '@panel/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The single settings row. The console edits it; nothing here enforces it —
 * session length is applied in the session layer, invite expiry when an invite
 * is issued and checked, the MFA requirement in the sign-in flow. Section 08 is
 * explicit that enforcement lives on the server, not in this screen.
 */
export const GET = handler(async () => {
  const guard = await requireSession()
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired')

  const body: SettingsResponse = {
    settings: await getSettings(),
    canEdit: guard.session.user.permissions.includes('admin_access'),
  }
  return ok(body)
})

const COLUMNS: Record<string, string> = {
  sessionMinutes: 'session_minutes',
  keepSignedInAllowed: 'keep_signed_in_allowed',
  keepSignedInDays: 'keep_signed_in_days',
  trustedDeviceDays: 'trusted_device_days',
  concurrentSessionLimit: 'concurrent_session_limit',
  mfaRequired: 'mfa_required',
  externalUsersAllowed: 'external_users_allowed',
  inviteExpiryDays: 'invite_expiry_days',
}

export const PUT = handler(async (request: Request) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, updateSettingsSchema)
  if (!parsed.ok) return parsed.response

  const before = await getSettings()
  const sets: string[] = []
  const params: unknown[] = []

  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = (parsed.data as Record<string, unknown>)[key]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
  }

  if (parsed.data.ssoEnforcedDomains !== undefined) {
    // Normalised to a leading @ so the sign-in suffix check has one shape to match.
    const domains = parsed.data.ssoEnforcedDomains.map((d) =>
      d.startsWith('@') ? d.toLowerCase() : `@${d.toLowerCase()}`,
    )
    sets.push('sso_enforced_domains = CAST(? AS JSON)')
    params.push(JSON.stringify(domains))
  }

  if (sets.length === 0) return ok<SettingsResponse>({ settings: before, canEdit: true })

  sets.push('updated_by = ?')
  params.push(guard.session.userId)
  await exec(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, params)
  invalidateSettingsCache()

  const after = await getSettings()
  const read = (source: Record<string, unknown>, key: string) => JSON.stringify(source[key])
  const changed = Object.keys(parsed.data)
    .filter(
      (key) =>
        read(before as unknown as Record<string, unknown>, key) !==
        read(after as unknown as Record<string, unknown>, key),
    )
    .map(
      (key) =>
        `${key}: ${read(before as unknown as Record<string, unknown>, key)} → ` +
        `${read(after as unknown as Record<string, unknown>, key)}`,
    )

  if (changed.length > 0) {
    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'warn',
      kind: 'settings',
      message: `Settings changed — ${changed.join(', ')}`,
      event: { k: 'settingsChanged', p: { changes: changed.join(', ') } },
      meta: parsed.data,
    })
  }

  const body: SettingsResponse = { settings: after, canEdit: true }
  return ok(body)
})
