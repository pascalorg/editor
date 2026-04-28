# Testing Patterns

**Analysis Date:** 2026-04-28

## Test Framework

**Status:** Not detected

No test framework (Jest, Vitest, etc.) is configured in the project. No test files exist in the main application code (`packages/editor/src`, `packages/core/src`, `apps/editor/app`).

**Type Checking:**
- TypeScript compiler: `tsc --noEmit` (run via `npm run check-types`)
- TypeScript version: 5.9.3
- Strict mode: Configured via shared TypeScript config `@pascal/typescript-config`

**Linting:**
- Tool: Biome
- Command: `npm run lint`
- Config: `biome.jsonc` in root

## Run Commands

```bash
# Type checking
npm run check-types      # Next.js typegen + tsc --noEmit

# Linting
npm run lint             # Biome lint

# Development
npm run dev              # Bun server with .env.local override

# Build
npm run build            # Next.js build with .env.local override
```

No test commands exist. The project currently has no automated testing infrastructure.

## Test File Organization

**Current State:** Not applicable

The codebase contains no test files. If tests are added in the future:

**Recommended Location:**
- Co-located tests: `src/path/to/Component.test.tsx` alongside `src/path/to/Component.tsx`
- Alternatively: `src/__tests__/path/to/Component.test.tsx` for centralized tests

**Naming Convention:**
- Test files: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- Fixtures/test data: `fixtures/` or `__fixtures__/` directory
- Test utilities: `test-utils.ts`, `test-helpers.ts`

## Code Quality Practices

**Type Safety:**
- All TypeScript files have strict type annotations
- No `any` type used without consideration
- Zod schemas for runtime validation: `const BaseNode = z.object({ ... })`
- Type inference for derived values where clear
- Type guards in utility functions: `getFiniteNumber()`, `getBoolean()`, `getEnumValue()`

Example from `use-scene.ts`:
```typescript
function getFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function getEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}
```

**Validation:**
- Zod for schema validation in core module
- Runtime type checking in state management (above helpers)
- Request validation in API routes: destructure and check required fields
- No explicit validation library beyond Zod and TypeScript

Example from `route.ts`:
```typescript
const { email, password, name } = await req.json()
if (!email || !password || !name) {
  return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
}
```

**Error Prevention:**
- Defensive programming in stores: validate unknown values before use
- Optional chaining: `user?.email`, `session?.user?.email`
- Nullish coalescing for defaults: `userName ?? 'User'`, `userColor ?? '#6366f1'`
- Early returns in handlers

## Mocking Patterns

**Current State:** Not applicable

No testing framework means no mocking infrastructure exists. If tests are added:

**Recommended Approach:**
- Mock API calls in integration tests
- Mock Zustand stores with `create()` for unit tests
- Mock Socket.io events for collaboration testing
- Mock Three.js objects for scene tests

**Libraries to Consider:**
- Vitest (modern, TypeScript-first)
- @testing-library/react (component testing)
- @testing-library/user-event (user interaction simulation)
- vi.mock() for module mocking

## Fixtures and Test Data

**Current State:** Not applicable

No test data infrastructure exists. If tests are added:

**Recommended Location:**
- `packages/core/src/__fixtures__/schemas.ts` - Zod schema test data
- `packages/editor/src/__fixtures__/components.ts` - Component props
- `packages/core/src/__fixtures__/nodes.ts` - Node factory functions

**Example Pattern:**
```typescript
// Factory function for creating test data
export function createTestWall(overrides?: Partial<WallNode>): WallNode {
  return {
    id: 'wall_test',
    type: 'wall',
    name: 'Test Wall',
    start: [0, 0],
    end: [10, 0],
    height: 2.5,
    thickness: 0.2,
    ...overrides,
  }
}
```

## Test Structure

**If Jest/Vitest were added:**

```typescript
describe('WallNode creation', () => {
  it('should create a wall with default properties', () => {
    const wall = createTestWall()
    expect(wall.height).toBe(2.5)
    expect(wall.thickness).toBe(0.2)
  })

  it('should allow property overrides', () => {
    const wall = createTestWall({ height: 3.0 })
    expect(wall.height).toBe(3.0)
  })
})

describe('FeedbackDialog', () => {
  it('should render feedback form', () => {
    render(<FeedbackDialog />)
    expect(screen.getByText('Send Feedback')).toBeInTheDocument()
  })

  it('should validate message input', async () => {
    render(<FeedbackDialog onSubmit={vi.fn()} />)
    const submitButton = screen.getByText('Send Feedback')
    expect(submitButton).toBeDisabled()
  })
})
```

## Async Testing

**Current Pattern:** Used in action files but not tested

Server actions and async handlers use try/catch:

```typescript
export async function inviteMember(organizationId: string, email: string, name: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) throw new Error("Unauthorized")
  
  try {
    const invitedUser = await prisma.user.upsert({ ... })
    return { success: true }
  } catch (error) {
    console.error("Invite error:", error)
    return { success: false, error: "Failed to invite member." }
  }
}
```

**If tests were added:**
```typescript
it('should handle async database operations', async () => {
  vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser)
  const result = await inviteMember('org_1', 'test@example.com', 'Test')
  expect(result.success).toBe(true)
})

it('should catch errors and return failure', async () => {
  vi.mocked(prisma.user.upsert).mockRejectedValue(new Error('DB error'))
  const result = await inviteMember('org_1', 'test@example.com', 'Test')
  expect(result.success).toBe(false)
  expect(result.error).toBeDefined()
})
```

## Error Testing

**Current Pattern:** Error checking in handlers, not in tests

```typescript
// From route.ts
if (!email || !password || !name) {
  return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
}

const existing = await prisma.user.findUnique({ where: { email: emailLower } })
if (existing) {
  return NextResponse.json({ error: "An account with this email already exists." }, { status: 400 })
}
```

**If tests were added:**
```typescript
describe('POST /api/auth/signup', () => {
  it('should reject missing fields', async () => {
    const response = await POST(new Request('...', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' })
    }))
    expect(response.status).toBe(400)
  })

  it('should reject duplicate email', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser)
    const response = await POST(createRequest({ email, password, name }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('already exists')
  })
})
```

## Coverage

**Target:** Not enforced

No coverage requirements or tools configured. Coverage could be added via Vitest:

```bash
vitest --coverage        # Would generate coverage reports
```

**Recommended minimum:**
- Core business logic (schema, actions): 80%+
- API routes: 75%+
- UI components: 60% (harder to test)
- Utils/helpers: 90%+

## Test Types

**Unit Tests (if added):**
- Scope: Individual functions, schema validation, state selectors
- Approach: Direct function calls with mocked dependencies
- Example: Testing `pointsEqual()`, `getWallFreeEndpoint()` from `node-actions.ts`

**Integration Tests (if added):**
- Scope: API routes with database, component + store interaction
- Approach: Mock external services (Prisma, Socket.io), test flows
- Example: Testing `/api/auth/signup` full flow with user creation

**E2E Tests (if added):**
- Framework: Playwright or Cypress
- Scope: Full editor workflow (create project, add walls, collaborate, export)
- Would require separate configuration and test infrastructure

## Complex Areas Needing Tests

**High Priority (if testing added):**
1. **Wall merging logic** (`node-actions.ts`):
   - Collinearity checks
   - Style compatibility
   - Attachment transfer
   - Complex geometry operations

2. **Collaboration sync** (`YjsCollaborationProvider.tsx`, `collaboration.ts`):
   - Yjs update application
   - State synchronization
   - Socket.io event handling
   - Awareness protocol

3. **Scene state management** (`use-scene.ts`):
   - Type-safe value coercion
   - History/undo-redo with zundo
   - Nested node updates

4. **Authentication** (`route.ts`, `actions.ts`):
   - Session validation
   - User creation and validation
   - Error handling

5. **API routes**:
   - Input validation
   - Permission checks
   - Error responses

## Current Quality Practices

**What IS in place:**
- Type-safe validation with Zod
- Defensive coding patterns
- Try/catch error boundaries in async functions
- Null/undefined checks before operations
- Component prop validation via TypeScript
- Biome linting for code consistency

**What's MISSING:**
- Automated test execution
- Test coverage tracking
- Integration test suite
- E2E test coverage
- Snapshot testing
- Performance benchmarks

---

*Testing analysis: 2026-04-28*
