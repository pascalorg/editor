# Phase 4: Dashboard - Research

**Researched:** 2026-04-29
**Domain:** Next.js App Router dashboard, Prisma schema migration, server actions, context menu UX
**Confidence:** HIGH (all findings from direct codebase inspection)

---

## Summary

The dashboard infrastructure is partially built but has several meaningful gaps before all eight requirements are met. The layout, sidebar, ProjectCard component, and ProjectPreviewCanvas are all solid and production-quality. The main page (`dashboard/page.tsx`) renders a "Recent Projects" masonry grid sorted by `updatedAt` — functional but not using a dedicated `lastOpenedAt` field. The projects page is a basic client-component scaffold that duplicates the create-project modal without context menus, search, or starring.

Three schema-level additions are needed: `lastOpenedAt DateTime?` on Project for proper "recent" tracking (DASH-02), a `StarredProject` join table (DASH-03), and optionally a `thumbnailUrl` update path (already present on Project model). Five new or upgraded server actions are needed: `renameProject`, `deleteProject`, `starProject`, `unstarProject`, and a search/filter variant of the project query. The context menu pattern is absent from the codebase — it needs to be introduced from scratch using a kebab-button + absolute-positioned dropdown (no Radix UI available).

**Primary recommendation:** Add two Prisma migrations (lastOpenedAt + StarredProject), then upgrade `dashboard/projects/page.tsx` into a server component with client sub-components for search, context menus, and the starred/recent sections. Reuse `ProjectCard` throughout.

---

## Codebase State (Direct Inspection)

### What exists and works

| File | State | Notes |
|------|-------|-------|
| `dashboard/layout.tsx` | Complete | Auth guard, sidebar mount, org query |
| `dashboard/_components/DashboardSidebar.tsx` | Complete | Org switcher, all nav links, user profile |
| `dashboard/page.tsx` | Functional scaffold | Stats + masonry recent grid; sorts by `updatedAt`, shows max 9 |
| `dashboard/_components/ProjectCard.tsx` | High quality | Hover-triggered 3D preview via lazy `<Suspense>`, role badge, timeAgo |
| `dashboard/_components/ProjectPreviewCanvas.tsx` | Complete | `@react-three/fiber` Canvas, animated indigo building, generic placeholder |
| `dashboard/actions.ts` | Partial | Has: `getDashboardData`, `createProject`, `createTeam`, `getFirstTeamId`, `inviteMember`. Missing: rename, delete, star, unstar, updateLastOpened |
| `dashboard/projects/page.tsx` | Thin client scaffold | Grid + create modal; no search, no context menu, no starring, uses `any` types |

### Project model (schema.prisma line 135)

```
model Project {
  id           String   @id @default(cuid())
  teamId       String
  name         String
  description  String?
  thumbnailUrl String?
  stateUrl     String?
  isPublic     Boolean  @default(false)

  team             Team              @relation(fields: [teamId], references: [id])
  members          ProjectMember[]
  publishedAsset   MarketplaceAsset?
  clonedFrom       ProjectClone?     @relation("ClonedProject")

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([teamId])
}
```

**Critical gaps for this phase:**
- No `lastOpenedAt` field — DASH-02 "Recent 6" currently falls back to `updatedAt` (acceptable for now but incorrect semantics)
- No `StarredProject` model — DASH-03 cannot be implemented without schema migration
- No `@@index([createdAt])` or `@@index([lastOpenedAt])` — add with migration for sort performance

### getDashboardData query shape

The existing `getDashboardData` action loads `user -> organizations -> organization -> teams -> projects + members`. Projects are fetched as `projects: true` (full select) per team. This is the data source for both dashboard pages. It does NOT currently include starred projects.

---

## Standard Stack

### Core (already installed, confirmed in codebase)

| Library | Version | Purpose |
|---------|---------|---------|
| Next.js App Router | 16 | Server components, server actions, routing |
| React | 19 | UI |
| TypeScript | - | Strict typing throughout |
| Tailwind CSS | 4 | Utility styling |
| Prisma | ~5.10 | ORM, schema migrations |
| NextAuth v4 | - | Session via `getServerSession(authOptions)` |
| `@react-three/fiber` | - | 3D canvas in ProjectPreviewCanvas |
| `lucide-react` | - | Icons throughout |
| Framer Motion | - | Available for animations (imported in other pages) |

### No Radix UI

The tech constraint is confirmed — no Radix UI is installed. All dropdown/modal/popover UI must be built with raw HTML + Tailwind + state. The existing codebase demonstrates this pattern: the org-switcher dropdown in DashboardSidebar is a plain `useState` boolean + absolute-positioned `div`.

---

## Architecture Patterns

### Existing patterns to follow

**Server component page + client sub-components:**
`dashboard/page.tsx` is an `async` server component that calls `getDashboardData()` and passes data down. Interactive pieces (`ProjectCard`) are separate `'use client'` components. Follow this same split for the upgraded projects page.

**Server actions pattern:**
All mutations go through `"use server"` functions in `actions.ts`. They call `getServerSession` for auth, run Prisma queries, then call `revalidatePath`. Return shape is `{ success: boolean, ...data }` or throw on error.

**Org-scoped data:**
All data is fetched through the org membership chain: `user -> organizations -> organization -> teams -> projects`. There is no direct `project.userId` — projects are always team-owned. Search and filtering must operate on the already-fetched `allProjects` array (client-side filter) or a new targeted Prisma query.

**Context menu (no Radix):**
DashboardSidebar demonstrates the custom dropdown pattern. For project context menus, use a kebab button (`MoreHorizontal` icon from lucide) that toggles a `useState` boolean, rendering an absolute-positioned `div` with `z-50` and a `useEffect` click-outside listener.

**Modal pattern:**
`dashboard/projects/page.tsx` has the create modal pattern: fixed inset overlay + centered card. Reuse this for rename confirmation.

### Recommended structure for upgraded projects page

```
dashboard/projects/page.tsx          ← async server component, fetches data
dashboard/projects/_components/
  ProjectsGrid.tsx                   ← 'use client', handles search state + grid render
  ProjectContextMenu.tsx             ← 'use client', kebab + dropdown menu
  StarButton.tsx                     ← 'use client', optimistic star toggle
  RenameModal.tsx                    ← 'use client', inline rename dialog
  DeleteConfirmModal.tsx             ← 'use client', confirmation dialog
```

The page fetches data server-side and passes the projects array into `ProjectsGrid` as a prop. `ProjectsGrid` owns the search input state and filters locally.

### Starred projects section

Since there is no `StarredProject` model yet, add it to the schema:

```prisma
model StarredProject {
  userId    String
  projectId String
  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([userId, projectId])
  @@index([userId])
}
```

Add corresponding relations to User and Project models.

### Recent section (DASH-02)

Add `lastOpenedAt DateTime?` to Project. Update it via a server action called when a user clicks "Open Project" on a card (or when the editor loads). For the dashboard "Recent" section, query projects where `lastOpenedAt IS NOT NULL` ordered by `lastOpenedAt DESC LIMIT 6`. Until `lastOpenedAt` is populated, the fallback of sorting by `updatedAt` (already in page.tsx) is acceptable.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Click-outside detection | Custom event listener each time | Single `useEffect` hook with `mousedown` listener, extracted to a reusable hook or inline |
| Optimistic UI for star toggle | Complex state machines | Local `useState` for starred set + server action in background; revert on error |
| 3D preview | New canvas setup | `ProjectPreviewCanvas.tsx` already exists — just pass `projectId` prop if project-specific data is needed |
| Search | Debounced fetch / server query | Client-side `.filter()` on the already-loaded `allProjects` array — dataset is small |
| Date formatting | Manual math | `timeAgo()` util already exists in `ProjectCard.tsx` — extract to `lib/utils.ts` or duplicate |

---

## Common Pitfalls

### Pitfall 1: Prisma migration breaks existing data
Adding `lastOpenedAt DateTime?` is nullable — safe. Adding `StarredProject` table is additive — safe. The risk is forgetting to run `prisma generate` after schema change. Both `apps/editor/prisma/schema.prisma` and `apps/editor/prisma/generated-client/` must stay in sync.

### Pitfall 2: getDashboardData not including starred projects
After adding `StarredProject`, `getDashboardData` must be updated to include the user's starred project IDs. Currently it doesn't include this relation. Without it, the star toggle state will not persist across page loads.

**Fix:** Add to the user include:
```typescript
starredProjects: {
  select: { projectId: true }
}
```

### Pitfall 3: Projects page is currently a client component calling getDashboardData in useEffect
`dashboard/projects/page.tsx` uses `useEffect` + `getDashboardData()` (which is a server action). This works but causes a loading flash and is not the App Router pattern. The upgrade should convert the page to an async server component.

### Pitfall 4: Context menu z-index conflicts
The sidebar has `z-40`. Context menu dropdowns need `z-50`. The modal overlays should be `z-[60]` to appear above both.

### Pitfall 5: ProjectCard is a full-width Link wrapper
`ProjectCard` wraps the entire card in `<Link href={/editor/${project.id}}>`. Adding a star button or context menu inside requires `e.stopPropagation()` on click handlers to prevent navigation.

### Pitfall 6: revalidatePath scope
`createProject` calls `revalidatePath('/dashboard/projects')` and `revalidatePath('/dashboard')`. New actions (rename, delete, star) must also call both paths, or the overview page's "Recent Projects" count will be stale.

### Pitfall 7: "Recent" section limit is currently 9 on the overview page
DASH-02 specifies 6. The existing `page.tsx` slices to 9 (`.slice(0, 9)`). This needs correcting to 6 and should use `lastOpenedAt` once that field exists.

---

## Missing Actions (must add to actions.ts)

| Action | Parameters | Prisma operation | revalidatePaths |
|--------|------------|-----------------|----------------|
| `renameProject` | `projectId, name` | `project.update` | `/dashboard`, `/dashboard/projects` |
| `deleteProject` | `projectId` | `project.delete` (cascades to ProjectMember via Cascade) | `/dashboard`, `/dashboard/projects` |
| `starProject` | `projectId` | `starredProject.create` | `/dashboard`, `/dashboard/projects` |
| `unstarProject` | `projectId` | `starredProject.delete` | `/dashboard`, `/dashboard/projects` |
| `updateLastOpened` | `projectId` | `project.update { lastOpenedAt: new Date() }` | none (fire-and-forget acceptable) |

All need the standard auth guard pattern: `getServerSession(authOptions)` + user lookup.

---

## Code Examples

### Click-outside hook (inline pattern, no library)
```typescript
// Source: established React pattern, matches codebase style
useEffect(() => {
  if (!open) return
  const handler = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setOpen(false)
    }
  }
  document.addEventListener('mousedown', handler)
  return () => document.removeEventListener('mousedown', handler)
}, [open])
```

### Optimistic star toggle (matches codebase action pattern)
```typescript
'use client'
const [starred, setStarred] = useState(initialStarred)

async function handleStar(e: React.MouseEvent) {
  e.preventDefault() // prevent Link navigation
  e.stopPropagation()
  setStarred(!starred) // optimistic
  try {
    if (starred) await unstarProject(projectId)
    else await starProject(projectId)
  } catch {
    setStarred(starred) // revert
  }
}
```

### Client-side search filter (matches codebase data shape)
```typescript
const filtered = allProjects.filter(p =>
  p.name.toLowerCase().includes(query.toLowerCase())
)
```

### Rename action (server action pattern)
```typescript
"use server"
export async function renameProject(projectId: string, name: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) throw new Error("Unauthorized")
  await prisma.project.update({ where: { id: projectId }, data: { name } })
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/projects")
  return { success: true }
}
```

---

## Open Questions

1. **Should "Recent" on the overview page pull from lastOpenedAt or remain updatedAt-sorted?**
   - What we know: `updatedAt` changes on any edit; `lastOpenedAt` tracks explicit opens
   - Recommendation: Add `lastOpenedAt`, use it for DASH-02. Fall back to `updatedAt` until data populates.

2. **Should deleteProject hard-delete or soft-delete?**
   - What we know: No `deletedAt` field on Project, no soft-delete pattern in codebase
   - Recommendation: Hard delete. `ProjectMember` already has `onDelete: Cascade`. Ensure `MarketplaceAsset` and `ProjectClone` cascade correctly (they use `projectId` as FK — verify cascade rules in schema before migrating).

3. **Does ProjectPreviewCanvas need to be project-specific?**
   - What we know: It currently renders a generic indigo building with no project props
   - Recommendation: Keep generic for now (all projects show the same animated placeholder). Project-specific thumbnails can use `thumbnailUrl` (already on model) when available.

---

## Sources

### Primary (HIGH confidence — direct file inspection)
- `apps/editor/prisma/schema.prisma` — Project model, all relations
- `apps/editor/app/dashboard/page.tsx` — overview page logic
- `apps/editor/app/dashboard/projects/page.tsx` — projects page state
- `apps/editor/app/dashboard/_components/ProjectCard.tsx` — card component
- `apps/editor/app/dashboard/_components/ProjectPreviewCanvas.tsx` — 3D preview
- `apps/editor/app/dashboard/actions.ts` — all existing server actions
- `apps/editor/app/dashboard/layout.tsx` — auth guard, sidebar mount
- `apps/editor/app/dashboard/_components/DashboardSidebar.tsx` — nav, org switcher

---

## Metadata

**Confidence breakdown:**
- Codebase state: HIGH — direct file inspection, no inference
- Schema gaps: HIGH — schema.prisma confirmed, missing fields identified
- Missing actions: HIGH — actions.ts fully read
- Architecture patterns: HIGH — follows existing patterns in codebase
- Framer Motion usage: MEDIUM — available in package.json (not verified), used in other parts of the app per prior context

**Research date:** 2026-04-29
**Valid until:** Stable — until schema or component files are modified
