/**
 * Structured audit events.
 *
 * The trail stores English prose in `audit_log.message` and always will: it is
 * an immutable record, and rewriting stored history so it reads differently to
 * different people is the one thing an audit trail must not do. Exports,
 * forensics and grep all want that column stable.
 *
 * What a *reader* wants is their own language. So every write also carries an
 * event key and its parameters, and the screens render from those. The stored
 * sentence is the record; the rendered sentence is the presentation.
 *
 * The key lives inside the existing `meta` JSON rather than in a new column —
 * no migration, and rows written before this existed simply fall back to their
 * stored message. That fallback is permanent, not transitional: history written
 * by an older build stays readable exactly as it was written.
 *
 * This module must stay free of Node imports; both the server writer and the
 * client renderer pull it in.
 */

export type AuditEventKey =
  | 'signedOut'
  | 'signedOutAll'
  | 'signInUnknown'
  | 'signInSuspended'
  | 'signInWrongPassword'
  | 'signInAwaitingMfa'
  | 'signedIn'
  | 'signedInMfaCleared'
  | 'sessionRevoked'
  | 'allSessionsRevoked'
  | 'sessionsRevokedFor'
  | 'resetIssued'
  | 'resetUnroutable'
  | 'passwordChanged'
  | 'passwordChangedFirst'
  | 'inviteAccepted'
  | 'inviteRevoked'
  | 'inviteResent'
  | 'mfaEnrolStarted'
  | 'mfaEnrolled'
  | 'mfaCodeRejected'
  | 'recoveryUsed'
  | 'recoveryRejected'
  | 'userInvited'
  | 'userUpdated'
  | 'userUpdatedPlain'
  | 'userDeleted'
  | 'tempPassword'
  | 'siteAccessChanged'
  | 'roleCreated'
  | 'rolePermissions'
  | 'roleDeleted'
  | 'siteCreated'
  | 'siteArchived'
  | 'siteRestored'
  | 'jobRequeued'
  | 'jobCancelled'
  | 'apiKeyCreated'
  | 'apiKeyRevoked'
  | 'webhookAdded'
  | 'webhookPaused'
  | 'webhookResumed'
  | 'webhookDeleted'
  | 'webhookTestDelivered'
  | 'webhookTestFailed'
  | 'settingsChanged'
  | 'diagnosticsCleared'
  | 'accountRequested'
  | 'requestIgnoredExists'
  | 'requestIgnoredPending'
  | 'requestApproved'
  | 'requestRejected'
  | 'browserError';

export interface AuditEvent {
  /** Key into the `audit` dictionary block. */
  k: AuditEventKey;
  /** Placeholder values, already formatted. */
  p?: Record<string, string | number>;
}

/** Reserved slot inside `audit_log.meta`. */
export const AUDIT_EVENT_FIELD = 'event';

/**
 * Pulls the event back out of a stored `meta` blob.
 *
 * Deliberately forgiving: a row whose meta is missing, malformed, or written by
 * an older build returns null and the caller falls back to the stored message.
 * A log screen that throws because one row is odd is worse than one line of
 * English.
 */
export function readAuditEvent(meta: Record<string, unknown> | null | undefined): AuditEvent | null {
  if (!meta) return null;
  const raw = meta[AUDIT_EVENT_FIELD];
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as { k?: unknown; p?: unknown };
  if (typeof candidate.k !== 'string') return null;

  return {
    k: candidate.k as AuditEventKey,
    p: candidate.p && typeof candidate.p === 'object' ? (candidate.p as AuditEvent['p']) : undefined,
  };
}
