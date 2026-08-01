/**
 * Request/response shape for every endpoint reachable in steps 3–5, plus the
 * zod schemas the route handlers validate against. Section 08 asks for exactly
 * this: "no code in this step, types — every later step compiles against them."
 *
 * Error envelope is uniform: `{ error: { code, message, details? } }`. `code` is
 * stable and machine-readable; `message` is an i18n key the client resolves, so
 * the server never ships user-facing prose.
 */
import { z } from 'zod'
import type {
  AccessRequest,
  ApiKey,
  AuthState,
  Invitation,
  Job,
  OrgSettings,
  Permission,
  Role,
  SessionInfo,
  SessionUser,
  Site,
  UserV3,
  Webhook,
} from './types'

export type ApiErrorCode =
  | 'invalid_credentials'
  | 'account_locked'
  | 'account_inactive'
  | 'account_suspended'
  | 'sso_required'
  | 'mfa_required'
  | 'mfa_invalid'
  | 'mfa_not_enrolled'
  | 'recovery_invalid'
  | 'token_invalid'
  | 'token_expired'
  | 'invite_expired'
  | 'invite_revoked'
  | 'password_policy'
  | 'password_mismatch'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'server_error'

export interface ApiError {
  error: {
    code: ApiErrorCode
    /** i18n key, e.g. `err.credentials`. Never pre-translated prose. */
    message: string
    details?: Record<string, unknown>
  }
}

export type ApiResult<T> = T | ApiError

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'error' in value
}

/* ——— POST /api/auth/signin ——— */

export const signInSchema = z.object({
  /** Username, local part, or full work address — resolved server-side. */
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(512),
  keepSignedIn: z.boolean().default(false),
})
export type SignInRequest = z.infer<typeof signInSchema>

export interface SignInResponse {
  state: Extract<AuthState, 'mfaRequired' | 'firstSignIn' | 'signedIn'>
  /** Present once the session is fully established (state === 'signedIn'). */
  user?: SessionUser
  /** Masked identity shown on the OTP screen while the session is half-open. */
  pendingLabel?: string
  /** True when the account has no confirmed TOTP secret and MFA is mandatory. */
  enrolmentRequired?: boolean
}

/* ——— GET /api/auth/session ——— */

export interface SessionResponse {
  state: AuthState
  user: SessionUser | null
  /** Idle countdown source of truth. Seconds remaining before forced sign-out. */
  expiresInSeconds: number
  /** settings.session_minutes, so the client can render "20 min idle ends…". */
  sessionMinutes: number
}

/* ——— POST /api/auth/signout ——— */

export const signOutSchema = z.object({ allDevices: z.boolean().default(false) })
export type SignOutRequest = z.infer<typeof signOutSchema>
export interface SignOutResponse {
  revoked: number
}

/* ——— POST /api/auth/session/touch — idle-warning "stay signed in" ——— */

export interface TouchResponse {
  expiresInSeconds: number
}

/* ——— GET /api/auth/sessions · DELETE /api/auth/sessions/:id ——— */

export interface SessionsResponse {
  sessions: SessionInfo[]
}

/* ——— MFA ——— */

export interface MfaSetupResponse {
  /** otpauth:// URI rendered as a data-URL QR by the server. */
  qrDataUrl: string
  /** Grouped manual-entry key, e.g. "NETL OG7K Q2VD 8XT4 J9RM". */
  manualKey: string
}

export const mfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  /** Only meaningful during enrolment; the sign-in step reads trustDevice. */
  trustDevice: z.boolean().default(false),
})
export type MfaVerifyRequest = z.infer<typeof mfaVerifySchema>

export interface MfaVerifyResponse {
  state: Extract<AuthState, 'signedIn' | 'firstSignIn'>
  user?: SessionUser
  /** Returned once, on enrolment confirmation. Shown then never again. */
  recoveryCodes?: string[]
}

export const mfaRecoverySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
})
export type MfaRecoveryRequest = z.infer<typeof mfaRecoverySchema>

export interface MfaRecoveryResponse {
  state: Extract<AuthState, 'signedIn' | 'firstSignIn'>
  user?: SessionUser
  /** How many unused codes are left, so the UI can nudge a regeneration. */
  codesRemaining: number
}

/* ——— Password reset & first sign-in ——— */

export const resetRequestSchema = z.object({
  email: z.string().trim().email().max(320),
})
export type ResetRequestBody = z.infer<typeof resetRequestSchema>

/** Always 202 with the same body — existence of an address is never disclosed. */
export interface ResetRequestResponse {
  accepted: true
}

export const resetConfirmSchema = z
  .object({
    token: z.string().min(16).max(256),
    password: z.string().min(10).max(512),
    passwordAgain: z.string().min(10).max(512),
    revokeOtherSessions: z.boolean().default(true),
    /** Required on the `welcome` (first sign-in) variant of the screen. */
    acceptPolicy: z.boolean().default(false),
  })
  .refine((v) => v.password === v.passwordAgain, {
    path: ['passwordAgain'],
    params: { code: 'password_mismatch' },
    message: 'err.passwordMismatch',
  })
export type ResetConfirmRequest = z.infer<typeof resetConfirmSchema>

export interface ResetConfirmResponse {
  state: Extract<AuthState, 'anonymous' | 'signedIn' | 'mfaRequired'>
  /** Where the screen should continue: sign-in, MFA enrolment, or the console. */
  next: 'signin' | 'mfa-setup' | 'console'
  revokedSessions: number
}

/** Server-side mirror of the five policy rules the strength meter renders. */
export interface PasswordPolicyResult {
  minLength: boolean
  mixedCase: boolean
  digit: boolean
  symbol: boolean
  noIdentity: boolean
  ok: boolean
  /** 0–3, matching the four meter segments. */
  strength: 0 | 1 | 2 | 3
}

/* ——— Invitations ——— */

export interface InvitationResponse {
  invitation: Invitation
}

export const invitationResendSchema = z.object({}).default({})

/** GET /api/invitations/:token/preview — powers the `#/welcome` screen. */
export interface InvitationPreviewResponse {
  state: Invitation['state']
  fullName: string
  email: string
  expiresAt: string
}

/* ——— Access requests ——— */

export const accessRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  /** Local part only; the domain suffix is fixed by the form and the server. */
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'err.usernameChars'),
  department: z.string().trim().min(1).max(64),
  requestedRole: z.string().trim().min(1).max(48),
  note: z.string().trim().max(1024).optional(),
})
export type AccessRequestBody = z.infer<typeof accessRequestSchema>

export interface AccessRequestResponse {
  request: Pick<AccessRequest, 'id' | 'email' | 'status'>
}

/* ——— Roles (read side is needed by the console shell guard) ——— */

export interface RolesResponse {
  roles: Array<{ name: Role; permissions: Permission[]; isSystem: boolean }>
}

/* ——— Step 6 · Users, assignments and roles ——— */

/** GET /api/users — server-side slicing; the total is always returned. */
export interface UsersListResponse {
  users: UserV3[]
  total: number
  totalUnfiltered: number
  page: number
  pageSize: number
  without2fa: number
  /** Site names the assign dialog and drawer offer. */
  sites: string[]
  /** Role names, ordered Admin → Supervisor → Editor → Viewer → custom. */
  roles: string[]
  /** Whether the caller may mutate — drives the read-only banner. */
  canEdit: boolean
}

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  /** Local part or full address; a foreign domain is rejected, not rewritten. */
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'err.usernameChars'),
  role: z.string().trim().min(1).max(48),
  org: z.enum(['internal', 'external']).default('internal'),
  siteNames: z.array(z.string().trim().min(1)).default([]),
})
export type CreateUserRequest = z.infer<typeof createUserSchema>

export interface CreateUserResponse {
  user: UserV3
  invitation: Invitation
}

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'err.usernameChars')
    .optional(),
  role: z.string().trim().min(1).max(48).optional(),
  status: z.enum(['Active', 'Inactive', 'Invited']).optional(),
})
export type UpdateUserRequest = z.infer<typeof updateUserSchema>

/**
 * POST /api/users/bulk — the selection toolbar.
 *
 * `ids` is capped at 200 because the endpoint applies each account in its own
 * statement and writes one audit row per account: the trail is per-account
 * history, and collapsing it into a single "12 accounts changed" line would
 * lose exactly the record the trail exists for.
 *
 * `requireMfa` from the prototype is deliberately absent — see the response
 * type below.
 */
export const bulkUsersSchema = z.object({
  action: z.enum(['roleViewer', 'revokeSessions', 'deactivate', 'delete']),
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
})
export type BulkUsersRequest = z.infer<typeof bulkUsersSchema>

export interface BulkUsersResponse {
  /** Accounts the action actually changed. */
  applied: number
  /**
   * Accounts deliberately left alone, with the reason. The primary
   * administrator and your own account are always skipped; the UI names them
   * rather than silently reporting a smaller number than the user selected.
   */
  skipped: Array<{
    id: string
    label: string
    reason: 'primaryAdmin' | 'self' | 'notFound' | 'noop'
  }>
}

export interface UserDetailResponse {
  user: UserV3 & {
    effectivePermissions: Permission[]
    isPrimaryAdmin: boolean
    createdAt: string
    passwordSetAt: string | null
    activeSessions: number
  }
  sites: string[]
  roles: string[]
  canEdit: boolean
}

/** PUT /api/users/:id/assignments — `null` role removes access to that site. */
export const assignmentsSchema = z.object({
  siteRoles: z.record(z.string(), z.string().nullable()),
})
export type AssignmentsRequest = z.infer<typeof assignmentsSchema>

/** POST /api/users/:id/temp-password — the raw password is returned once. */
export interface TempPasswordResponse {
  temporaryPassword: string
}

/* ——— Access request review ——— */

export interface PendingRequestsResponse {
  requests: AccessRequest[]
}

export const approveRequestSchema = z.object({
  role: z.string().trim().min(1).max(48),
  siteNames: z.array(z.string().trim().min(1)).min(1, 'err.siteRequired'),
  org: z.enum(['internal', 'external']).default('internal'),
})
export type ApproveRequestBody = z.infer<typeof approveRequestSchema>

export interface ApproveRequestResponse {
  user: UserV3
  invitation: Invitation
}

/* ——— Roles ——— */

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(48),
})
export type CreateRoleRequest = z.infer<typeof createRoleSchema>

export const updateRoleSchema = z.object({
  permissions: z.array(z.string()).max(32),
})
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>

export interface RolesFullResponse {
  roles: Array<{ name: Role; permissions: Permission[]; isSystem: boolean; userCount: number }>
  canEdit: boolean
}

/** DELETE /api/roles/:name — the role's users fall back to Viewer. */
export interface DeleteRoleResponse {
  reassigned: number
}

/* ——— Step 7 · Sites, jobs, integrations and settings ——— */

export const createSiteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Where provisioning starts from; carried in the job payload. */
  template: z.enum(['empty', 'ifc', 'copy']).default('empty'),
  footprintM2: z.number().int().min(0).max(10_000_000).nullable().optional(),
})
export type CreateSiteRequest = z.infer<typeof createSiteSchema>

export interface SitesResponse {
  sites: Site[]
  canEdit: boolean
}

export interface JobsResponse {
  jobs: Job[]
}

/* ——— API keys ——— */

export const createKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  scope: z.enum(['read', 'read_write']).default('read'),
  /** Site name, or null for "every site". */
  siteName: z.string().trim().min(1).nullable().optional(),
})
export type CreateKeyRequest = z.infer<typeof createKeySchema>

export interface KeysResponse {
  keys: ApiKey[]
  sites: string[]
  canEdit: boolean
}

/** The raw key is present exactly once, in this response, and never stored. */
export interface CreateKeyResponse {
  key: ApiKey & { secret: string }
}

/* ——— Webhooks ——— */

export const createWebhookSchema = z.object({
  url: z.string().trim().url().max(2048).startsWith('https://', 'err.hookHttps'),
  events: z.array(z.string().trim().min(1)).min(1, 'err.eventRequired').max(32),
})
export type CreateWebhookRequest = z.infer<typeof createWebhookSchema>

export const patchWebhookSchema = z.object({
  status: z.enum(['active', 'paused']),
})
export type PatchWebhookRequest = z.infer<typeof patchWebhookSchema>

export interface WebhooksResponse {
  webhooks: Webhook[]
  events: string[]
  canEdit: boolean
}

export interface WebhookTestResponse {
  delivered: boolean
  status: Webhook['status']
  /** HTTP status the endpoint answered with, or null if it never responded. */
  responseStatus: number | null
}

/* ——— Org settings ——— */

export const updateSettingsSchema = z.object({
  sessionMinutes: z.number().int().min(5).max(1440).optional(),
  keepSignedInAllowed: z.boolean().optional(),
  keepSignedInDays: z.number().int().min(1).max(90).optional(),
  trustedDeviceDays: z.number().int().min(1).max(365).optional(),
  concurrentSessionLimit: z.number().int().min(1).max(50).optional(),
  mfaRequired: z.boolean().optional(),
  ssoEnforcedDomains: z.array(z.string().trim().min(2).max(190)).max(20).optional(),
  externalUsersAllowed: z.boolean().optional(),
  inviteExpiryDays: z.number().int().min(1).max(90).optional(),
})
export type UpdateSettingsRequest = z.infer<typeof updateSettingsSchema>

export interface SettingsResponse {
  settings: OrgSettings
  canEdit: boolean
}

/* ——— Step 8 · Diagnostics, telemetry and changelog ——— */

export const telemetrySchema = z.object({
  message: z.string().trim().min(1).max(1024),
  source: z.string().trim().max(512).optional(),
  line: z.number().int().min(0).max(10_000_000).optional(),
  column: z.number().int().min(0).max(10_000_000).optional(),
  stack: z.string().trim().max(4000).optional(),
})
export type TelemetryRequest = z.infer<typeof telemetrySchema>

export interface HealthResponse {
  cpuPercent: number
  heapGb: number
  systemUsedGb: number
  systemTotalGb: number
  loadAverage1m: number
  cores: number
  uptimeSeconds: number
  at: string
}

export interface LogsResponse {
  entries: Array<{
    id: string
    level: 'info' | 'warn' | 'error'
    kind: string | null
    actor: string
    message: string
    meta: Record<string, unknown> | null
    createdAt: string
    permanent: boolean
  }>
  nextCursor: string | null
  actors: string[]
  counts: { info: number; warn: number; error: number }
  canClear?: boolean
  kinds?: string[]
}

export interface OverviewResponse {
  health: HealthResponse
  counts: {
    users: number
    activeUsers: number
    sites: number
    activeSites: number
    signedIn: number
    without2fa: number
    queuedJobs: number
  }
  connected: Array<{ actor: string; lastAction: string; at: string }>
  incidents: LogsResponse['entries']
}

/** One changelog entry, source-agnostic — the UI never names the upstream repo. */
export interface ReleaseEntry {
  id: string
  title: string
  summary: string
  version: string | null
  date: string
  tags: string[]
  authors: string[]
  /** Which product line the entry belongs to. */
  channel: 'editor' | 'plugin' | 'console'
}

export interface ChangelogResponse {
  entries: ReleaseEntry[]
  nextCursor: string | null
  /** Whether the payload came from upstream or the bundled snapshot. */
  live: boolean
  fetchedAt: string
}
