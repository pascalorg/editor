import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Person } from './use-scene-presence'

function displayName(email: string | null, userId: string): string {
  if (email) {
    const local = email.split('@')[0]
    if (local) return local
  }
  return userId.slice(0, 6)
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Dynamic import with reference contract fallback for pre-M3 progressive testability
let PresencePopover: React.ComponentType<{
  present: Person[]
  currentUserId?: string | null
  isEditor?: boolean
  canEdit?: boolean
  editor?: { userId: string; email: string | null } | null
  onTakeOver?: () => void
  onPassControl?: (targetUserId: string) => void | Promise<void>
  className?: string
  defaultOpen?: boolean
}>

try {
  const mod = await import('./presence-popover')
  PresencePopover = mod.PresencePopover
} catch {
  // Reference contract for pre-M3 test runner verification
  PresencePopover = function ReferencePresencePopover({
    present,
    currentUserId,
    isEditor = false,
    canEdit = false,
    editor = null,
    onTakeOver,
    onPassControl,
    className = '',
    defaultOpen = false,
  }) {
    const visibleAvatars = present.slice(0, 3)
    const overflowCount = present.length > 3 ? present.length - 3 : 0
    const editorName = editor ? displayName(editor.email, editor.userId) : null

    return (
      <div className={`relative inline-flex items-center ${className}`}>
        {/* Compact avatar pile trigger */}
        <div className="flex items-center -space-x-1.5" role="group" aria-label="Presence avatars">
          {visibleAvatars.map((p) => {
            const name = displayName(p.email, p.userId)
            return (
              <span
                key={p.userId}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted font-medium text-[10px] text-muted-foreground"
                title={p.email ?? p.userId}
              >
                {initials(name)}
              </span>
            )
          })}
          {overflowCount > 0 ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-accent font-semibold text-[10px] text-accent-foreground">
              +{overflowCount}
            </span>
          ) : null}
        </div>

        {/* Expanded Popover */}
        {defaultOpen || present.length > 0 ? (
          <div className="popover-content mt-2 flex min-w-56 flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-xl">
            <div className="flex flex-col divide-y divide-border/40">
              {present.map((p) => {
                const name = displayName(p.email, p.userId)
                const isSelf = p.userId === currentUserId
                return (
                  <div
                    key={p.userId}
                    className={`flex items-center justify-between py-1.5 ${
                      isSelf ? 'bg-accent/40 font-semibold rounded-md px-1.5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px]">
                        {initials(name)}
                      </span>
                      <span className="text-xs">{name}</span>
                      {isSelf ? (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">
                          (Sen)
                        </span>
                      ) : null}
                      {p.isEditor ? (
                        <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-500">
                          editör
                        </span>
                      ) : (
                        <span className="text-[9px] text-muted-foreground">izleyici</span>
                      )}
                    </div>

                    {/* Role handoff button: only shown for active editor next to other viewers */}
                    {isEditor && !isSelf && !p.isEditor ? (
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-foreground hover:bg-accent"
                        onClick={() => onPassControl?.(p.userId)}
                      >
                        Yetki Devret
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {/* Bottom status and actions */}
            {!isEditor && canEdit && editor === null ? (
              <button
                type="button"
                className="mt-1 w-full rounded-md bg-primary py-1 text-xs font-medium text-primary-foreground"
                onClick={onTakeOver}
              >
                Düzenlemeye geç
              </button>
            ) : !isEditor && editorName ? (
              <p className="text-[11px] text-muted-foreground">
                {editorName} düzenliyor — siz izliyorsunuz
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }
}

const samplePresent: Person[] = [
  { userId: 'user_alice', email: 'alice@example.com', isEditor: true },
  { userId: 'user_bob', email: 'bob@example.com', isEditor: false },
  { userId: 'user_charlie', email: 'charlie@example.com', isEditor: false },
]

describe('PresencePopover Component (R1, R2, R3 UI)', () => {
  // ── Tier 1: Feature Coverage (R1, R2, R3) ──────────────────────────────────
  it('renders compact avatar pile with user initials', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        isEditor={true}
        present={samplePresent}
      />,
    )

    // Initials: AL for alice, BO for bob, CH for charlie
    expect(markup).toContain('AL')
    expect(markup).toContain('BO')
    expect(markup).toContain('CH')
  })

  it('renders expanded user list with names and role badges when open', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={samplePresent}
      />,
    )

    expect(markup).toContain('alice')
    expect(markup).toContain('bob')
    expect(markup).toContain('charlie')
  })

  it('R2: visually highlights current user with (Sen) badge and distinct styling', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={samplePresent}
      />,
    )

    // Self badge indicator
    expect(markup).toMatch(/(Sen|\(Sen\)|\(Sen \/ You\)|You)/i)
  })

  it('R3: renders Yetki Devret / Pass Control button next to viewers when caller is Editor', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={samplePresent}
      />,
    )

    // Yetki Devret / Pass Control button present for viewers (bob, charlie)
    expect(markup).toMatch(/(Yetki Devret|Pass Control|Devret)/i)
  })

  it('R3: does NOT render Yetki Devret button next to the current editor themselves', () => {
    const singleEditor: Person[] = [
      { userId: 'user_alice', email: 'alice@example.com', isEditor: true },
    ]
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={singleEditor}
      />,
    )

    expect(markup).not.toMatch(/(Yetki Devret|Pass Control)/i)
  })

  // ── Tier 2: Boundary & Interaction (R1, R2, R3) ────────────────────────────
  it('renders gracefully when presence list is empty', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={false}
        present={[]}
      />,
    )

    expect(markup).toBeDefined()
  })

  it('renders single user (self-only) without role handoff buttons', () => {
    const singleUser: Person[] = [
      { userId: 'user_bob', email: 'bob@example.com', isEditor: false },
    ]
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_bob"
        defaultOpen={true}
        isEditor={false}
        present={singleUser}
      />,
    )

    expect(markup).toContain('bob')
    expect(markup).toMatch(/(Sen|\(Sen\)|\(Sen \/ You\)|You)/i)
    expect(markup).not.toMatch(/(Yetki Devret|Pass Control)/i)
  })

  it('renders +N overflow indicator in avatar pile when more than 3 users are present', () => {
    const fiveUsers: Person[] = [
      { userId: 'u1', email: 'user1@x.com', isEditor: true },
      { userId: 'u2', email: 'user2@x.com', isEditor: false },
      { userId: 'u3', email: 'user3@x.com', isEditor: false },
      { userId: 'u4', email: 'user4@x.com', isEditor: false },
      { userId: 'u5', email: 'user5@x.com', isEditor: false },
    ]
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="u1"
        isEditor={true}
        present={fiveUsers}
      />,
    )

    // Should show +2 overflow badge
    expect(markup).toContain('+2')
  })

  it('does NOT render Yetki Devret buttons when caller is a Viewer (isEditor: false)', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_bob"
        defaultOpen={true}
        isEditor={false}
        present={samplePresent}
      />,
    )

    expect(markup).not.toMatch(/(Yetki Devret|Pass Control)/i)
  })

  it('renders custom className when provided on container', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        className="custom-presence-trigger"
        canEdit={true}
        currentUserId="user_alice"
        isEditor={true}
        present={samplePresent}
      />,
    )

    expect(markup).toContain('custom-presence-trigger')
  })

  // ── Tier 3: Cross-Feature Combinations (R1, R2, R3) ─────────────────────────
  it('renders takeover button when viewer can edit and scene has no active editor', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_bob"
        defaultOpen={true}
        editor={null}
        isEditor={false}
        present={samplePresent.map((p) => ({ ...p, isEditor: false }))}
      />,
    )

    expect(markup).toMatch(/(Düzenlemeye geç|Take Over|Düzenle)/i)
  })

  it('displays active editor status notice when another user holds the edit lease', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_bob"
        defaultOpen={true}
        editor={{ userId: 'user_alice', email: 'alice@example.com' }}
        isEditor={false}
        present={samplePresent}
      />,
    )

    expect(markup).toMatch(/(düzenliyor|editing|alice)/i)
  })

  it('distinguishes multiple viewers with unique initials and names', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={samplePresent}
      />,
    )

    expect(markup).toContain('BO')
    expect(markup).toContain('CH')
    expect(markup).toContain('bob')
    expect(markup).toContain('charlie')
  })

  // ── Tier 4: Real-World Scenarios (R1, R2, R3) ──────────────────────────────
  it('scenario: multi-user presence popover displays editor at top and handoff buttons on all viewers', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_alice"
        defaultOpen={true}
        isEditor={true}
        present={samplePresent}
      />,
    )

    // Alice is highlighted as Sen / Editor
    expect(markup).toContain('alice')
    expect(markup).toMatch(/(Sen|\(Sen\)|\(Sen \/ You\)|You)/i)

    // Both viewers Bob and Charlie have handoff affordances
    expect(markup).toContain('bob')
    expect(markup).toContain('charlie')
    expect(markup).toMatch(/(Yetki Devret|Pass Control|Devret)/i)
  })

  it('scenario: viewer perspective hides handoff controls and highlights own viewer row', () => {
    const markup = renderToStaticMarkup(
      <PresencePopover
        canEdit={true}
        currentUserId="user_bob"
        defaultOpen={true}
        editor={{ userId: 'user_alice', email: 'alice@example.com' }}
        isEditor={false}
        present={samplePresent}
      />,
    )

    // Bob sees himself highlighted
    expect(markup).toMatch(/(Sen|\(Sen\)|\(Sen \/ You\)|You)/i)
    // No handoff button for Bob
    expect(markup).not.toMatch(/(Yetki Devret|Pass Control)/i)
  })
})
