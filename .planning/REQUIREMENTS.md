# Requirements: PascalEditor

**Defined:** 2026-04-29
**Core Value:** The platform around the editor must make discovering, organizing, and sharing 3D spaces as fluid as Figma makes 2D design.

## v1 Requirements

### Landing / Marketing

- [ ] **LAND-01**: Visitor can view marketing landing page with product value proposition, feature highlights, and CTAs
- [ ] **LAND-02**: Visitor can navigate to sign up or log in from the landing page
- [ ] **LAND-03**: Landing page renders with SEO meta tags and Open Graph images for social sharing

### Authentication

- [ ] **AUTH-01**: User can sign up with email and password
- [ ] **AUTH-02**: User can sign in with Google OAuth (in addition to email/password)
- [ ] **AUTH-03**: User can reset password via email link
- [ ] **AUTH-04**: User session persists across browser refresh and tab close/reopen

### Onboarding

- [ ] **ONBD-01**: First-time user is redirected to paginated onboarding flow after account creation
- [ ] **ONBD-02**: Onboarding Step 1 — user selects their role (architect / interior designer / homeowner / student)
- [ ] **ONBD-03**: Onboarding Step 2 — user selects use case (personal projects / team collaboration / client work)
- [ ] **ONBD-04**: Onboarding Step 3 — user can create a team, join an existing team via invite, or skip
- [ ] **ONBD-05**: Onboarding Step 4 — user is prompted to start their first project (blank scene or template) or skip to dashboard
- [ ] **ONBD-06**: User can navigate back and forward between onboarding steps without losing selections
- [ ] **ONBD-07**: Onboarding progress is persisted so refreshing does not restart the flow

### Dashboard

- [ ] **DASH-01**: Authenticated user lands on dashboard showing their projects in a grid with 2D/3D thumbnail previews
- [ ] **DASH-02**: Dashboard shows a "Recent" section with the last 6 opened/edited projects
- [ ] **DASH-03**: User can star/favourite a project and view starred projects in a dedicated section
- [ ] **DASH-04**: User can create a new project from the dashboard
- [ ] **DASH-05**: User can search and filter their projects by name
- [ ] **DASH-06**: Dashboard has a persistent sidebar with: Home, Teams, Marketplace, Profile navigation
- [ ] **DASH-07**: User can rename or delete a project from the dashboard context menu
- [ ] **DASH-08**: User can open a project's editor directly from the dashboard card

### Teamspaces

- [ ] **TEAM-01**: User can create a new teamspace (organization) with a name and optional avatar
- [ ] **TEAM-02**: Team owner can invite members via email, assigning a role: Editor / Commenter / Viewer
- [ ] **TEAM-03**: Invited user receives an email invitation and can accept or decline
- [ ] **TEAM-04**: Team owner and admins can change a member's role or remove them from the team
- [ ] **TEAM-05**: Team has a shared projects view showing all projects within the teamspace
- [ ] **TEAM-06**: User can belong to multiple teams and switch between them from the sidebar

### Marketplace

- [ ] **MKTPL-01**: User can browse marketplace as a grid of published 3D+2D scenes with thumbnail previews
- [ ] **MKTPL-02**: User can search marketplace by name and filter by category/tags
- [ ] **MKTPL-03**: User can view a scene detail page with title, description, author, preview (embedded viewer), and stats
- [ ] **MKTPL-04**: Authenticated user can duplicate a marketplace scene into their own workspace as a new project
- [ ] **MKTPL-05**: User can publish one of their own projects to the marketplace with title, description, category, tags, and cover image
- [ ] **MKTPL-06**: Publisher can unpublish/remove their scene listing from the marketplace
- [ ] **MKTPL-07**: User can like/save a marketplace scene to a personal collection

### Designer Profile

- [ ] **PROF-01**: Each user has a public profile page accessible without login at a vanity URL (e.g. /u/username)
- [ ] **PROF-02**: Profile displays user's avatar, display name, bio, and all their published marketplace scenes
- [ ] **PROF-03**: Visitor can send a contact message to a designer via a contact button/modal on their profile
- [ ] **PROF-04**: Authenticated user can edit their own profile: avatar, display name, bio, social links
- [ ] **PROF-05**: Profile page shows aggregate stats: number of published scenes, total likes received

## v2 Requirements

### Monetization

- **MONET-01**: Designer can mark a published scene as paid with a set price
- **MONET-02**: User can purchase a paid scene via integrated payment (Stripe)
- **MONET-03**: Designer receives payouts from scene sales

### Notifications

- **NOTF-01**: User receives in-app notification when someone duplicates their marketplace scene
- **NOTF-02**: User receives email notification when invited to a team
- **NOTF-03**: User receives in-app notification when a teammate comments on a shared project

### Moderation

- **MODR-01**: User can report a marketplace scene for inappropriate content
- **MODR-02**: Admin dashboard to review and remove reported scenes or suspend accounts

### Advanced Discovery

- **DISC-01**: Marketplace homepage shows featured/curated scenes section
- **DISC-02**: Marketplace supports tag-based browsing pages
- **DISC-03**: Trending scenes algorithm based on duplicates and likes

## Out of Scope

| Feature | Reason |
|---------|--------|
| Paid marketplace listings | Deferred to v2; validate demand first |
| Mobile native app | Web-first platform |
| In-app real-time messaging/chat | Comment model sufficient for v1 |
| First-person walkthrough preview in marketplace | Too heavy for browse context; viewer embed is sufficient |
| Video recording/export of scenes | Deferred; high complexity |
| OAuth beyond Google (GitHub, Apple) | Email + Google covers v1 signup friction |
| Custom domain for team/portfolio | Nice to have, deferred |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAND-01 | Phase 1 | Pending |
| LAND-02 | Phase 1 | Pending |
| LAND-03 | Phase 1 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| ONBD-01 | Phase 3 | Pending |
| ONBD-02 | Phase 3 | Pending |
| ONBD-03 | Phase 3 | Pending |
| ONBD-04 | Phase 3 | Pending |
| ONBD-05 | Phase 3 | Pending |
| ONBD-06 | Phase 3 | Pending |
| ONBD-07 | Phase 3 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DASH-05 | Phase 4 | Pending |
| DASH-06 | Phase 4 | Pending |
| DASH-07 | Phase 4 | Pending |
| DASH-08 | Phase 4 | Pending |
| TEAM-01 | Phase 5 | Pending |
| TEAM-02 | Phase 5 | Pending |
| TEAM-03 | Phase 5 | Pending |
| TEAM-04 | Phase 5 | Pending |
| TEAM-05 | Phase 5 | Pending |
| TEAM-06 | Phase 5 | Pending |
| MKTPL-01 | Phase 6 | Pending |
| MKTPL-02 | Phase 6 | Pending |
| MKTPL-03 | Phase 6 | Pending |
| MKTPL-04 | Phase 6 | Pending |
| MKTPL-05 | Phase 6 | Pending |
| MKTPL-06 | Phase 6 | Pending |
| MKTPL-07 | Phase 6 | Pending |
| PROF-01 | Phase 7 | Pending |
| PROF-02 | Phase 7 | Pending |
| PROF-03 | Phase 7 | Pending |
| PROF-04 | Phase 7 | Pending |
| PROF-05 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 after initial definition*
