# PascalEditor

## What This Is

A Figma-styled realtime collaborative 3D architectural/interior design platform for architects, designers, and homeowners. Users design spaces with a dual 2D floorplan + 3D scene editor, collaborate in real-time with teammates or clients, and share their work on a community marketplace — all within a dashboard experience modeled after Figma and Miro.

## Core Value

The editor already works — now the platform around it must make discovering, organizing, and sharing 3D spaces as fluid as Figma makes 2D design.

## Requirements

### Validated

- ✓ Realtime collaborative 3D editor with 2D floorplan + 3D viewport — existing
- ✓ CRDT-based conflict-free sync via Yjs + Socket.io — existing
- ✓ Presence engine (avatar cursors, awareness) — existing
- ✓ 3-tier RBAC system (Organization → Team → Project, Owner/Admin/Member/Viewer) — existing
- ✓ Email/password authentication via NextAuth + Prisma — existing
- ✓ Project creation and management — existing
- ✓ Cloudflare R2 file storage (S3-compatible) — existing
- ✓ Basic dashboard, signup, login pages (scaffolded) — existing

### Active

- [ ] Landing/marketing page with product value proposition and CTAs
- [ ] Paginated multi-step onboarding (role → use case → team setup → first project prompt)
- [ ] Google OAuth sign-in alongside email/password
- [ ] Figma-styled dashboard — project grid with 2D/3D previews, recents, starred
- [ ] Teamspace management — create teams, invite by role (edit/comment/view), manage members
- [ ] Marketplace — browse and discover published 3D+2D scenes, duplicate into own workspace
- [ ] Project publishing flow — publish complete scenes (floorplan + 3D) to marketplace
- [ ] Designer portfolio/profile — Dribbble-style public page, contact for work

### Out of Scope

- Paid/monetized marketplace listings — planned for v2, free-only for v1
- Mobile native app — web-first platform
- In-editor first-person walkthrough in marketplace preview — too heavy for browse context
- Real-time chat/messaging — invite + comment model is sufficient for v1
- Video/screen recording of designs — deferred

## Context

The 3D editor, realtime collaboration engine, Yjs sync, and RBAC data model are fully implemented. The gap is the surrounding platform: marketing, onboarding, dashboard UX, teamspaces UI, marketplace, and public profiles.

The existing auth (NextAuth, Prisma) uses email/password with credentials provider. Google OAuth needs to be added as a second provider. The RBAC model already supports 3-tier hierarchy — the UI to manage it is what's missing.

The viewer package (`packages/viewer`) renders read-only 3D scenes and can be embedded in marketplace cards/previews without requiring a full editor session.

Tech stack: Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Radix UI, Framer Motion, Zustand, Prisma + PostgreSQL, Socket.io, Yjs, Cloudflare R2, NextAuth, Redis.

## Constraints

- **Tech stack**: Must stay within existing monorepo stack — no new frameworks
- **Auth**: NextAuth v4 already integrated; Google OAuth must use same session strategy
- **DB**: Prisma schema changes need migrations — existing Org/Team/Project models are stable
- **Editor**: Editor package is out of scope — no changes to `packages/core`, `packages/editor`, `packages/viewer`
- **Collab**: Socket.io server handles editor sessions only — dashboard/marketplace are standard HTTP
 
## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Viewer package for marketplace previews | Embeds read-only 3D scene without full editor overhead | — Pending |
| Figma Community "duplicate" model for marketplace | Familiar UX; preserves original, gives user a copy in their workspace | — Pending |
| Dribbble-style profile over separate portfolio app | Keeps platform self-contained; designers stay within ecosystem | — Pending |
| Free-only marketplace for v1 | Reduces complexity; validate demand before adding monetization | — Pending |
| URL-based team invites for v1 (no email) | Resend not configured; generate shareable invite token URL instead of sending email | — Pending |

---
*Last updated: 2026-04-28 after initialization*
