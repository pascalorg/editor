import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { displayName, initials, PresencePopover } from './presence-popover'
import type { Person } from './use-scene-presence'

describe('PresencePopover Adversarial & Boundary Stress Test Suite (R1, R2, R3 UI)', () => {
  // ── 1. Avatar Pile Rendering & +N Badge Boundary Testing ──────────────────
  describe('Avatar Pile Rendering & +N Calculation', () => {
    it('handles 0 users: empty avatar pile and empty state message in popover', () => {
      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="user_me"
          defaultOpen={true}
          isEditor={false}
          present={[]}
        />,
      )

      expect(markup).toContain('Çevrimiçi Kullanıcılar (0)')
      expect(markup).toContain('Kimse çevrimiçi değil')
      expect(markup).not.toMatch(/\+\d+/)
    })

    it('handles 1 user: exactly 1 avatar rendered, no +N badge', () => {
      const users: Person[] = [
        { userId: 'u_1', email: 'alice@domain.com', isEditor: true },
      ]
      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="u_1"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('AL')
      expect(markup).toContain('Çevrimiçi Kullanıcılar (1)')
      expect(markup).not.toMatch(/\+\d+/)
    })

    it('handles 2 users: exactly 2 avatars rendered, no +N badge', () => {
      const users: Person[] = [
        { userId: 'u_1', email: 'alice@domain.com', isEditor: true },
        { userId: 'u_2', email: 'bob@domain.com', isEditor: false },
      ]
      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="u_1"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('AL')
      expect(markup).toContain('BO')
      expect(markup).toContain('Çevrimiçi Kullanıcılar (2)')
      expect(markup).not.toMatch(/\+\d+/)
    })

    it('handles 3 users: exactly 3 avatars rendered, no +N badge (boundary cutoff)', () => {
      const users: Person[] = [
        { userId: 'u_1', email: 'alice@domain.com', isEditor: true },
        { userId: 'u_2', email: 'bob@domain.com', isEditor: false },
        { userId: 'u_3', email: 'charlie@domain.com', isEditor: false },
      ]
      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="u_1"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('AL')
      expect(markup).toContain('BO')
      expect(markup).toContain('CH')
      expect(markup).toContain('Çevrimiçi Kullanıcılar (3)')
      expect(markup).not.toMatch(/\+\d+/)
    })

    it('handles 4 users: 3 avatars rendered, +1 overflow badge appears', () => {
      const users: Person[] = [
        { userId: 'u_1', email: 'alice@domain.com', isEditor: true },
        { userId: 'u_2', email: 'bob@domain.com', isEditor: false },
        { userId: 'u_3', email: 'charlie@domain.com', isEditor: false },
        { userId: 'u_4', email: 'david@domain.com', isEditor: false },
      ]
      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="u_1"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('AL')
      expect(markup).toContain('BO')
      expect(markup).toContain('CH')
      expect(markup).toContain('+1')
      expect(markup).toContain('Çevrimiçi Kullanıcılar (4)')
    })

    it('handles large rosters (10, 25, 50, 100 users): verifies accurate +N badge calculation', () => {
      const counts = [10, 25, 50, 100]
      for (const count of counts) {
        const users: Person[] = Array.from({ length: count }, (_, i) => ({
          userId: `user_${i}`,
          email: `user${i}@example.com`,
          isEditor: i === 0,
        }))

        const markup = renderToStaticMarkup(
          <PresencePopover
            canEdit={true}
            currentUserId="user_0"
            defaultOpen={true}
            isEditor={true}
            present={users}
          />,
        )

        const expectedOverflow = count - 3
        expect(markup).toContain(`+${expectedOverflow}`)
        expect(markup).toContain(`Çevrimiçi Kullanıcılar (${count})`)
      }
    })

    it('verifies initials and displayName utility edge cases', () => {
      // Single char name
      expect(displayName(null, 'x')).toBe('x')
      expect(initials('x')).toBe('X')

      // Short userId fallback
      expect(displayName(null, 'usr_123456789')).toBe('usr_12')
      expect(displayName('', 'usr_abcdef')).toBe('usr_ab')

      // Standard email
      expect(displayName('jane.doe+test@domain.co.uk', 'u_99')).toBe('jane.doe+test')
      expect(initials('jane.doe+test')).toBe('JA')

      // Anonymous guest with null email and UUID
      const guestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      expect(displayName(null, guestId)).toBe('a1b2c3')
      expect(initials(displayName(null, guestId))).toBe('A1')
    })
  })

  // ── 2. Current User Highlight Verification (R2) ───────────────────────────
  describe('Current User Highlight (R2)', () => {
    it('highlights current user with (Sen) badge and bg-primary/10 styling when matched by userId', () => {
      const users: Person[] = [
        { userId: 'alice_id', email: 'alice@domain.com', isEditor: true },
        { userId: 'bob_id', email: 'bob@domain.com', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="alice_id"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('(Sen)')
      expect(markup).toContain('bg-primary/10')
      expect(markup).toContain('font-semibold')
    })

    it('highlights anonymous guest with null email when matching currentUserId', () => {
      const users: Person[] = [
        { userId: 'guest_alpha_99', email: null, isEditor: false },
        { userId: 'guest_beta_100', email: null, isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId="guest_alpha_99"
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )

      expect(markup).toContain('guest_')
      expect(markup).toContain('(Sen)')
      expect(markup).toContain('bg-primary/10')
    })

    it('highlights user with complex email containing dots and plus signs', () => {
      const users: Person[] = [
        { userId: 'u_comp', email: 'alex.smith+tag@work.io', isEditor: true },
        { userId: 'u_other', email: 'other@work.io', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="u_comp"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).toContain('alex.smith+tag')
      expect(markup).toContain('(Sen)')
    })

    it('does NOT highlight any row when currentUserId is null or undefined', () => {
      const users: Person[] = [
        { userId: 'u1', email: 'user1@domain.com', isEditor: true },
        { userId: 'u2', email: 'user2@domain.com', isEditor: false },
      ]

      const markupNull = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId={null}
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )
      expect(markupNull).not.toContain('(Sen)')

      const markupUndefined = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId={undefined}
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )
      expect(markupUndefined).not.toContain('(Sen)')
    })

    it('does NOT highlight when currentUserId does not match any present user', () => {
      const users: Person[] = [
        { userId: 'u1', email: 'user1@domain.com', isEditor: true },
        { userId: 'u2', email: 'user2@domain.com', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId="u_ghost_disconnected"
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )
      expect(markup).not.toContain('(Sen)')
    })

    it('prevents substring prefix false positive highlights (e.g. u1 vs u10 vs u100)', () => {
      const users: Person[] = [
        { userId: 'user_1', email: 'user1@domain.com', isEditor: false },
        { userId: 'user_10', email: 'user10@domain.com', isEditor: false },
        { userId: 'user_100', email: 'user100@domain.com', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId="user_10"
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )

      // Count occurrences of (Sen)
      const senMatches = markup.match(/\(Sen\)/g)
      expect(senMatches?.length).toBe(1)
    })
  })

  // ── 3. Action Button Visibility (R3) ──────────────────────────────────────
  describe('Action Button Visibility ("Yetki Devret")', () => {
    it('ensures "Yetki Devret" is NEVER rendered for the active editor themselves', () => {
      const users: Person[] = [
        { userId: 'editor_user', email: 'editor@domain.com', isEditor: true },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="editor_user"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).not.toContain('Yetki Devret')
    })

    it('ensures "Yetki Devret" is NEVER rendered to viewers (isEditor: false)', () => {
      const users: Person[] = [
        { userId: 'editor_user', email: 'editor@domain.com', isEditor: true },
        { userId: 'viewer_user_1', email: 'v1@domain.com', isEditor: false },
        { userId: 'viewer_user_2', email: 'v2@domain.com', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="viewer_user_1"
          defaultOpen={true}
          isEditor={false}
          present={users}
        />,
      )

      expect(markup).not.toContain('Yetki Devret')
    })

    it('renders "Yetki Devret" for ALL present viewers when caller is Editor', () => {
      const users: Person[] = [
        { userId: 'editor_me', email: 'editor@domain.com', isEditor: true },
        { userId: 'viewer_1', email: 'viewer1@domain.com', isEditor: false },
        { userId: 'viewer_2', email: 'viewer2@domain.com', isEditor: false },
        { userId: 'viewer_3', email: 'viewer3@domain.com', isEditor: false },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="editor_me"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      const matches = markup.match(/Yetki Devret/g)
      // Exactly 3 "Yetki Devret" buttons for the 3 viewers
      expect(matches?.length).toBe(3)
    })

    it('does NOT render "Yetki Devret" next to another user who is already marked isEditor: true', () => {
      const users: Person[] = [
        { userId: 'editor_1', email: 'editor1@domain.com', isEditor: true },
        { userId: 'editor_2', email: 'editor2@domain.com', isEditor: true },
      ]

      const markup = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="editor_1"
          defaultOpen={true}
          isEditor={true}
          present={users}
        />,
      )

      expect(markup).not.toContain('Yetki Devret')
    })

    it('renders "Düzenlemeye geç" takeover button only when viewer canEdit and no editor is active', () => {
      const users: Person[] = [
        { userId: 'viewer_1', email: 'v1@domain.com', isEditor: false },
      ]

      const markupTakeover = renderToStaticMarkup(
        <PresencePopover
          canEdit={true}
          currentUserId="viewer_1"
          defaultOpen={true}
          editor={null}
          isEditor={false}
          present={users}
        />,
      )
      expect(markupTakeover).toContain('Düzenlemeye geç')

      const markupNoEditPerm = renderToStaticMarkup(
        <PresencePopover
          canEdit={false}
          currentUserId="viewer_1"
          defaultOpen={true}
          editor={null}
          isEditor={false}
          present={users}
        />,
      )
      expect(markupNoEditPerm).not.toContain('Düzenlemeye geç')
    })
  })
})
