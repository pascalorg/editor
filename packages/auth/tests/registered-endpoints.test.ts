import { describe, expect, test } from 'bun:test'
import type { Database } from '@pascal-app/db'
import { createUnconfiguredSender } from '../src/email'
import { createAuth } from '../src/server'

/**
 * The bug this pins: `sendMagicLink` used to be optional, and the magic-link
 * plugin was registered only when it was supplied. The app never supplied one,
 * so `/sign-in/magic-link` did not exist — while the sign-in dialog offered it
 * as the *default* method. Nothing failed loudly; the endpoint was simply
 * absent. Building the instance is enough to see the route table, so no
 * database is touched here.
 */
function buildAuth() {
  return createAuth({
    // The adapter is only consulted when a request runs; building the route
    // table does not query.
    db: {} as Database,
    appName: 'Menart 3D',
    baseURL: 'http://localhost:3002',
    secret: 'test-secret',
    sendEmail: createUnconfiguredSender('not configured in tests'),
  })
}

describe('createAuth registers every advertised flow', () => {
  const api = buildAuth().api

  test.each([
    ['magic link', 'signInMagicLink'],
    ['email sign-in', 'signInEmail'],
    ['email sign-up', 'signUpEmail'],
    ['password reset request', 'requestPasswordReset'],
    ['password reset', 'resetPassword'],
    ['email verification', 'sendVerificationEmail'],
  ])('%s', (_label, endpoint) => {
    expect(typeof (api as Record<string, unknown>)[endpoint]).toBe('function')
  })
})
