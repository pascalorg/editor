/**
 * Core domain types — section 08 of the rebuild plan, verbatim where the document
 * spells them out. These are the types every later step compiles against.
 *
 * At the API boundary `id` is always the CHAR(26) ULID `public_id`; the internal
 * BIGINT primary key never leaves the server. Timestamps are ISO-8601 UTC
 * strings and are formatted in the i18n layer, never in the query.
 */

export type AuthState =
  | 'anonymous'
  | 'verifying'
  | 'mfaRequired'
  | 'mfaLocked'
  | 'firstSignIn'
  | 'passwordExpired'
  | 'signedIn'
  | 'idleWarning'
  | 'expired'
  | 'suspended';

export type Role = 'Admin' | 'Supervisor' | 'Editor' | 'Viewer' | (string & {});
export type UserStatus = 'Active' | 'Inactive' | 'Invited';

export interface User {
  name: string;
  email: string;
  username: string;
  role: Role;
  mfa: 'On' | 'Off';
  status: UserStatus;
  lastSeen: string;
  siteRoles?: Record<string, Role | null>;
}

export interface Assignment {
  user: string;
  site: string;
  role: Role;
  grantedBy: string;
  grantedAt: string;
}

export type Scenario = 'happy' | 'locked' | 'sso' | 'error' | 'empty' | 'slow';

/* ——— v3 types · one-to-one with the tables in section 10 ——— */

export type Org = 'internal' | 'external';
export type SiteStatus = 'active' | 'setup' | 'archived';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type KeyScope = 'read' | 'read_write';
export type HookStatus = 'active' | 'paused' | 'failing';

export interface Site {
  id: string;
  name: string;
  status: SiteStatus;
  storageSlots?: number;
  pickingSlots?: number;
  footprintM2?: number;
  createdBy: string;
  createdAt: string;
  userCount?: number;
}

export interface Invitation {
  id: string;
  userId: string;
  invitedBy: string;
  expiresAt: string;
  resentCount: number;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  state: 'pending' | 'expired' | 'accepted' | 'revoked';
}

export interface Job {
  id: string;
  kind: string;
  siteId?: string | null;
  status: JobStatus;
  progress: number;
  errorText?: string | null;
  attempts: number;
  queuedBy: string;
  queuedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: KeyScope;
  siteId?: string | null; // null = every site
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  secret?: string; // populated ONLY in the POST /api/keys response
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: HookStatus;
  failCount: number;
  lastDeliveryAt?: string | null;
  createdAt: string;
}

export interface OrgSettings {
  sessionMinutes: number;
  keepSignedInAllowed: boolean;
  keepSignedInDays: number;
  trustedDeviceDays: number;
  concurrentSessionLimit: number;
  mfaRequired: boolean;
  ssoEnforcedDomains: string[];
  externalUsersAllowed: boolean;
  inviteExpiryDays: number;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface UserV3 extends User {
  id: string;
  org: Org;
  invitation?: Invitation | null;
}

/* ——— supporting types the screens in steps 3–5 need ——— */

export const PERMISSIONS = [
  'admin_access',
  'edit_projects',
  'create_projects',
  'delete_projects',
  'access_settings',
  'view_projects',
  'edit_users',
  'edit_roles',
  'view_logs',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDefinition {
  name: Role;
  permissions: Permission[];
  isSystem: boolean;
}

export interface SessionInfo {
  id: string;
  device: string | null;
  ip: string | null;
  current: boolean;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  trustedUntil?: string | null;
}

/** What `GET /api/auth/session` hands the client. Never carries a password hash. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  org: Org;
  status: UserStatus;
  mfa: 'On' | 'Off';
  permissions: Permission[];
  mustChangePassword: boolean;
  siteRoles: Record<string, Role>;
}

export interface AccessRequest {
  id: string;
  fullName: string;
  email: string;
  username: string;
  department: string;
  requestedRole: Role;
  note?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export type ListState = 'ready' | 'loading' | 'error' | 'empty';
export type Lang = 'en' | 'tr';
export type Theme = 'dark' | 'light';
