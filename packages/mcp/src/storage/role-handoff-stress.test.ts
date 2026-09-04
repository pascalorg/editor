import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SqliteSceneStore, type SqliteSceneStoreOptions } from './sqlite-scene-store'

function makeGraph(): SceneGraph {
  return {
    nodes: {
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
      },
    } as SceneGraph['nodes'],
    rootNodeIds: ['site_1'] as SceneGraph['rootNodeIds'],
  }
}

async function mkTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pascal-stress-test-'))
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

function createStore(rootDir: string, opts: Partial<SqliteSceneStoreOptions> = {}) {
  return new SqliteSceneStore({
    databasePath: path.join(rootDir, 'pascal.db'),
    ...opts,
  })
}

describe('Empirical Adversarial Stress Testing — Role Handoff (R3 Backend)', () => {
  let rootDir: string
  let store: SqliteSceneStore
  const SCENE_ID = 'stress-scene-handoff'

  beforeEach(async () => {
    rootDir = await mkTmpRoot()
    store = createStore(rootDir)
    await store.save({ id: SCENE_ID, name: 'Stress Handoff Scene', graph: makeGraph() })
  })

  afterEach(async () => {
    store.close()
    await rmrf(rootDir)
  })

  // ── 1. Sequential handoffs: User A -> User B -> User C -> User A ────────────
  test('stress 1: multi-cycle sequential handoff loop (A -> B -> C -> D -> A x 25 cycles)', async () => {
    const users = [
      { id: 'user_a', email: 'a@example.com' },
      { id: 'user_b', email: 'b@example.com' },
      { id: 'user_c', email: 'c@example.com' },
      { id: 'user_d', email: 'd@example.com' },
    ]

    // Initialize all users in scene presence
    await store.touchPresence(SCENE_ID, users[0]!.id, users[0]!.email, { claimEditor: true })
    for (let i = 1; i < users.length; i++) {
      await store.touchPresence(SCENE_ID, users[i]!.id, users[i]!.email, { claimEditor: false })
    }

    let currentEditorIndex = 0
    const TOTAL_CYCLES = 25

    for (let cycle = 0; cycle < TOTAL_CYCLES; cycle++) {
      for (let i = 0; i < users.length; i++) {
        const fromUser = users[currentEditorIndex]!
        const nextEditorIndex = (currentEditorIndex + 1) % users.length
        const toUser = users[nextEditorIndex]!

        // Perform handoff
        const handoffResult = await store.transferPresenceEditor(SCENE_ID, fromUser.id, toUser.id)

        expect(handoffResult.isEditor).toBe(false)
        expect(handoffResult.editorUserId).toBe(toUser.id)
        expect(handoffResult.editorEmail).toBe(toUser.email)

        // Verify single-editor invariant via presence query
        const presenceList = await store.listScenePresence(SCENE_ID)
        const editors = presenceList.filter((p) => p.isEditor)
        expect(editors).toHaveLength(1)
        expect(editors[0]!.userId).toBe(toUser.id)

        // Verify the promoted editor is at index 0 (sorted by is_editor DESC)
        expect(presenceList[0]!.userId).toBe(toUser.id)
        expect(presenceList[0]!.isEditor).toBe(true)

        // Verify former editor is now a viewer
        const formerEditorPresence = presenceList.find((p) => p.userId === fromUser.id)
        expect(formerEditorPresence?.isEditor).toBe(false)

        // Advance index
        currentEditorIndex = nextEditorIndex
      }
    }
  })

  // ── 2. Attempting transfer by non-editor user ───────────────────────────────
  test('stress 2: comprehensive non-editor transfer rejection matrix', async () => {
    const editor = { id: 'user_alpha', email: 'alpha@test.com' }
    const viewers = [
      { id: 'user_beta', email: 'beta@test.com' },
      { id: 'user_gamma', email: 'gamma@test.com' },
      { id: 'user_delta', email: 'delta@test.com' },
      { id: 'user_epsilon', email: 'epsilon@test.com' },
    ]

    await store.touchPresence(SCENE_ID, editor.id, editor.email, { claimEditor: true })
    for (const v of viewers) {
      await store.touchPresence(SCENE_ID, v.id, v.email, { claimEditor: false })
    }

    // Every viewer attempts to transfer to every other participant
    const allParticipants = [editor, ...viewers]
    for (const caller of viewers) {
      for (const target of allParticipants) {
        const result = await store.transferPresenceEditor(SCENE_ID, caller.id, target.id)

        // Must be rejected
        expect(result.isEditor).toBe(false)
        expect(result.editorUserId).toBe(editor.id)
        expect(result.editorEmail).toBe(editor.email)

        // Verify alpha is still the ONLY editor
        const presence = await store.listScenePresence(SCENE_ID)
        const activeEditors = presence.filter((p) => p.isEditor)
        expect(activeEditors).toHaveLength(1)
        expect(activeEditors[0]!.userId).toBe(editor.id)
      }
    }
  })

  // ── 3. Attempting transfer to non-existent or expired user ID ───────────────
  test('stress 3: transfer rejection for non-existent, cross-scene, and TTL-expired targets', async () => {
    const editor = { id: 'user_editor', email: 'editor@test.com' }
    const validViewer = { id: 'user_viewer', email: 'viewer@test.com' }
    const OTHER_SCENE = 'other-scene-unrelated'

    await store.save({ id: OTHER_SCENE, name: 'Other Scene', graph: makeGraph() })

    await store.touchPresence(SCENE_ID, editor.id, editor.email, { claimEditor: true })
    await store.touchPresence(SCENE_ID, validViewer.id, validViewer.email, { claimEditor: false })

    // User in a different scene
    await store.touchPresence(OTHER_SCENE, 'user_other_scene', 'other@test.com', { claimEditor: false })

    // Subcase 3a: Non-existent target UUIDs
    const invalidTargetIds = [
      'non_existent_123',
      'phantom_uuid_99999',
      '',
      'unknown_user_abc',
      'user_other_scene', // exists in OTHER_SCENE, but not in SCENE_ID
    ]

    for (const targetId of invalidTargetIds) {
      const claim = await store.transferPresenceEditor(SCENE_ID, editor.id, targetId)
      expect(claim.isEditor).toBe(true)
      expect(claim.editorUserId).toBe(editor.id)

      // Ensure editor remains unchanged
      const present = await store.listScenePresence(SCENE_ID)
      expect(present[0]!.userId).toBe(editor.id)
      expect(present[0]!.isEditor).toBe(true)
    }

    // Subcase 3b: Expired / Stale user target
    const db = await (store as unknown as { database: () => Promise<Database> }).database()
    const ancientTime = new Date(Date.now() - 120_000).toISOString() // 2 minutes ago (cutoff is 60s)
    db.query(
      'INSERT INTO scene_presence (scene_id, user_id, email, last_seen, is_editor) VALUES (?, ?, ?, ?, ?)',
    ).run(SCENE_ID, 'user_stale_ghost', 'ghost@test.com', ancientTime, 0)

    const staleTransferClaim = await store.transferPresenceEditor(SCENE_ID, editor.id, 'user_stale_ghost')
    expect(staleTransferClaim.isEditor).toBe(true)
    expect(staleTransferClaim.editorUserId).toBe(editor.id)

    // Stale user must be pruned
    const presentAfterStale = await store.listScenePresence(SCENE_ID)
    expect(presentAfterStale.find((p) => p.userId === 'user_stale_ghost')).toBeUndefined()
    expect(presentAfterStale[0]!.userId).toBe(editor.id)
    expect(presentAfterStale[0]!.isEditor).toBe(true)
  })

  // ── 4. Attempting transfer to oneself ───────────────────────────────────────
  test('stress 4: self-transfer idempotency for editor and non-editor', async () => {
    const editor = { id: 'user_self_ed', email: 'ed@self.com' }
    const viewer = { id: 'user_self_vw', email: 'vw@self.com' }

    await store.touchPresence(SCENE_ID, editor.id, editor.email, { claimEditor: true })
    await store.touchPresence(SCENE_ID, viewer.id, viewer.email, { claimEditor: false })

    // Editor transfers to self (no-op retention)
    for (let i = 0; i < 10; i++) {
      const edSelfClaim = await store.transferPresenceEditor(SCENE_ID, editor.id, editor.id)
      expect(edSelfClaim.isEditor).toBe(true)
      expect(edSelfClaim.editorUserId).toBe(editor.id)
      expect(edSelfClaim.editorEmail).toBe(editor.email)
    }

    // Viewer transfers to self (attempted privilege escalation) -> must fail!
    for (let i = 0; i < 10; i++) {
      const vwSelfClaim = await store.transferPresenceEditor(SCENE_ID, viewer.id, viewer.id)
      expect(vwSelfClaim.isEditor).toBe(false)
      expect(vwSelfClaim.editorUserId).toBe(editor.id)
    }

    // Final state check
    const presence = await store.listScenePresence(SCENE_ID)
    expect(presence).toHaveLength(2)
    expect(presence[0]!.userId).toBe(editor.id)
    expect(presence[0]!.isEditor).toBe(true)
    expect(presence[1]!.userId).toBe(viewer.id)
    expect(presence[1]!.isEditor).toBe(false)
  })

  // ── 5. Concurrency / race condition simulation ──────────────────────────────
  test('stress 5a: concurrent competing transfers from current editor to different viewers', async () => {
    const editor = { id: 'alice', email: 'alice@race.com' }
    const viewers = [
      { id: 'bob', email: 'bob@race.com' },
      { id: 'charlie', email: 'charlie@race.com' },
      { id: 'dave', email: 'dave@race.com' },
    ]

    await store.touchPresence(SCENE_ID, editor.id, editor.email, { claimEditor: true })
    for (const v of viewers) {
      await store.touchPresence(SCENE_ID, v.id, v.email, { claimEditor: false })
    }

    // Alice attempts simultaneous transfers to Bob, Charlie, and Dave
    const transferPromises = [
      store.transferPresenceEditor(SCENE_ID, 'alice', 'bob'),
      store.transferPresenceEditor(SCENE_ID, 'alice', 'charlie'),
      store.transferPresenceEditor(SCENE_ID, 'alice', 'dave'),
    ]

    const results = await Promise.all(transferPromises)

    // In SQLite atomic transactions, exactly one transfer commits first (making Alice is_editor=0).
    // Subsequent transfers from Alice will fail because Alice is no longer the editor.
    const presence = await store.listScenePresence(SCENE_ID)
    const activeEditors = presence.filter((p) => p.isEditor)

    expect(activeEditors).toHaveLength(1)
    const finalEditorId = activeEditors[0]!.userId
    expect(['bob', 'charlie', 'dave']).toContain(finalEditorId)

    // Alice is now definitely a non-editor
    expect(presence.find((p) => p.userId === 'alice')?.isEditor).toBe(false)
  })

  test('stress 5b: massive concurrent multi-user transfer and heartbeat storm (100 parallel operations)', async () => {
    const userIds = Array.from({ length: 8 }, (_, i) => `user_${i}`)
    
    // Seed presence
    await store.touchPresence(SCENE_ID, userIds[0]!, `${userIds[0]}@test.com`, { claimEditor: true })
    for (let i = 1; i < userIds.length; i++) {
      await store.touchPresence(SCENE_ID, userIds[i]!, `${userIds[i]}@test.com`, { claimEditor: false })
    }

    // Launch 100 concurrent interleaved operations (transfers and heartbeats)
    const ops: Promise<unknown>[] = []
    for (let i = 0; i < 100; i++) {
      const fromUser = userIds[Math.floor(Math.random() * userIds.length)]!
      const toUser = userIds[Math.floor(Math.random() * userIds.length)]!
      
      if (i % 2 === 0) {
        // Transfer attempt
        ops.push(store.transferPresenceEditor(SCENE_ID, fromUser, toUser))
      } else {
        // Heartbeat attempt
        const wantsEdit = Math.random() > 0.5
        ops.push(store.touchPresence(SCENE_ID, fromUser, `${fromUser}@test.com`, { claimEditor: wantsEdit }))
      }
    }

    await Promise.all(ops)

    // Database integrity invariant: AT MOST 1 active editor
    const presence = await store.listScenePresence(SCENE_ID)
    const activeEditors = presence.filter((p) => p.isEditor)
    expect(activeEditors.length).toBeLessThanOrEqual(1)

    // If there is an editor, they must be ranked first
    if (activeEditors.length === 1) {
      expect(presence[0]!.userId).toBe(activeEditors[0]!.userId)
      expect(presence[0]!.isEditor).toBe(true)
    }
  })

  // ── 6. Disconnection and TTL cutoff interaction ────────────────────────────
  test('stress 6: role handoff followed by clean disconnect, TTL timeout, and lease reclaiming', async () => {
    const userA = { id: 'user_disconnect_a', email: 'a@dc.com' }
    const userB = { id: 'user_disconnect_b', email: 'b@dc.com' }
    const userC = { id: 'user_disconnect_c', email: 'c@dc.com' }

    await store.touchPresence(SCENE_ID, userA.id, userA.email, { claimEditor: true })
    await store.touchPresence(SCENE_ID, userB.id, userB.email, { claimEditor: false })
    await store.touchPresence(SCENE_ID, userC.id, userC.email, { claimEditor: false })

    // Step 1: User A transfers to User B
    const handoff = await store.transferPresenceEditor(SCENE_ID, userA.id, userB.id)
    expect(handoff.editorUserId).toBe(userB.id)

    // Step 2: User A disconnects cleanly
    await store.releaseScenePresence(SCENE_ID, userA.id)
    const presAfterA = await store.listScenePresence(SCENE_ID)
    expect(presAfterA.find((p) => p.userId === userA.id)).toBeUndefined()
    expect(presAfterA[0]!.userId).toBe(userB.id)
    expect(presAfterA[0]!.isEditor).toBe(true)

    // Step 3: User B holds editor lease, User C heartbeats wanting edit -> rejected
    const cClaimAttempt = await store.touchPresence(SCENE_ID, userC.id, userC.email, { claimEditor: true })
    expect(cClaimAttempt.isEditor).toBe(false)
    expect(cClaimAttempt.editorUserId).toBe(userB.id)

    // Step 4: User B disconnects cleanly
    await store.releaseScenePresence(SCENE_ID, userB.id)
    const presAfterB = await store.listScenePresence(SCENE_ID)
    expect(presAfterB.filter((p) => p.isEditor)).toHaveLength(0)

    // Step 5: User C heartbeats wanting edit -> successfully acquires vacant lease!
    const cTakeover = await store.touchPresence(SCENE_ID, userC.id, userC.email, { claimEditor: true })
    expect(cTakeover.isEditor).toBe(true)
    expect(cTakeover.editorUserId).toBe(userC.id)

    // Step 6: User C transfers back to newly reconnected User A
    await store.touchPresence(SCENE_ID, userA.id, userA.email, { claimEditor: false })
    const cToA = await store.transferPresenceEditor(SCENE_ID, userC.id, userA.id)
    expect(cToA.editorUserId).toBe(userA.id)

    const finalPres = await store.listScenePresence(SCENE_ID)
    expect(finalPres[0]!.userId).toBe(userA.id)
    expect(finalPres[0]!.isEditor).toBe(true)
  })
})
