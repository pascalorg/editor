# Coding Conventions

**Analysis Date:** 2026-04-28

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension - `FeedbackDialog.tsx`, `YjsCollaborationProvider.tsx`, `CustomCameraControls.tsx`
- Hooks: kebab-case prefixed with `use-` for custom hooks - `use-editor.tsx`, `use-audio.tsx`, `use-command-registry.ts`
- Actions/utilities: kebab-case or camelCase - `node-actions.ts`, `asset-storage.ts`
- Schema/types: kebab-case - `scene-registry.ts`, `wall-spatial-grid.ts`

**Functions:**
- React hooks: camelCase with `use` prefix - `useCollaboration()`, `useScene()`, `useEditor()`
- Exported functions: camelCase - `generateId()`, `createTeam()`, `getDashboardData()`
- Internal helpers: camelCase - `pointsEqual()`, `getWallFreeEndpoint()`, `getFiniteNumber()`
- React components: PascalCase - `CustomCameraControls`, `FeedbackDialog`, `LeftColumn`

**Variables:**
- Local state variables: camelCase - `message`, `isDragging`, `isSubmitting`, `dragCounter`
- Constants: SCREAMING_SNAKE_CASE - `MAX_IMAGES`, `MAX_IMAGE_SIZE`, `DEFAULT_ACTIVE_SIDEBAR_PANEL`
- Private/internal state: camelCase with leading underscore discouraged; use module-scope `let` or `const`
- React state setters: camelCase with `set` prefix - `setOpen()`, `setMessage()`, `setIsDragging()`

**Types:**
- TypeScript interfaces: PascalCase - `CollaborationContextType`, `GridEvent`, `NodeEvent<T>`
- Type aliases: PascalCase - `ImagePreview`, `ViewMode`, `StructureTool`
- Type parameters: Single uppercase letter - `T`, `K`, `E`
- Generic constraints with context: descriptive - `AnyNode`, `AnyNodeId`, `AnyContainerNode`

## Code Style

**Formatting:**
- Tool: Biome
- Indent: 2 spaces
- Line width: 100 characters
- Indentation style: spaces

**JavaScript/TypeScript:**
- Semicolons: asNeeded (not required)
- Trailing commas: all (comma after last item in arrays/objects)
- Quote style: single quotes (standard code)
- JSX quotes: double quotes (for JSX attributes)

Example:
```typescript
interface Props {
  projectId: string
  userId: string
  userName?: string
  userColor?: string
  socket: any
  children?: ReactNode
}

export function YjsCollaborationProvider({
  projectId,
  userId,
  userName = 'User',
  userColor = '#6366f1',
  socket,
  children,
}: Props) {
  // implementation
}
```

**Linting:**
- Tool: Biome (biome.jsonc)
- Most style rules disabled for flexibility
- Key enforcements:
  - `noUnusedImports`: warn (auto-fix safe)
  - `useExhaustiveDependencies`: info (React hook dependencies)
  - `noDangerouslySetInnerHtml`: info (security warning)
  - Accessibility rules: mostly disabled (noSvgWithoutTitle, useKeyWithClickEvents, etc.)

## Import Organization

**Order:**
1. React/framework imports - `import { createContext, useContext } from 'react'`
2. Third-party library imports - `import { create } from 'zustand'`, `import mitt from 'mitt'`
3. Type imports - `import type { ThreeEvent } from '@react-three/fiber'`, `import type { AnyNode } from '../schema'`
4. Internal absolute path imports - `import { useScene } from '@pascal-app/core'`
5. Relative imports - `import { getDefaultCatalogItem } from '../components/ui/item-catalog/catalog-items'`

**Path Aliases:**
- `@/*` → `./` (in editor app)
- `@pascal-app/core` → `packages/core` monorepo package
- `@pascal-app/editor` → `packages/editor` monorepo package
- `@pascal-app/viewer` → `packages/viewer` monorepo package

**Barrel Files:**
- Used selectively in schema and core modules
- Example: `packages/core/src/schema/index.ts` exports multiple schema types
- Biome configured to allow barrel files (`noBarrelFile: off`)

## Error Handling

**Patterns:**
- Server actions: throw native Error for Unauthorized/not-found cases - `throw new Error("Unauthorized")`
- API routes: NextResponse with status codes - `return NextResponse.json({ error: "..." }, { status: 400 })`
- Async handlers: try/catch with console.error logging - `console.error("Signup error:", error)`
- Components: conditional checks before state updates
- Zustand stores: defensive functions with type guards - `getFiniteNumber()`, `getBoolean()`, `getEnumValue()`

Example from route handler:
```typescript
export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json()
    if (!email || !password || !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    // ... handler logic
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

## Logging

**Framework:** console (native)

**Patterns:**
- Prefix log messages with component/system identifier in brackets: `console.log('[Collaboration] Connecting to project:', projectId)`
- Error logs: `console.error('...', error)` for caught errors
- Warnings: `console.warn('...')` for recoverable issues
- Debug logs: Conditional or behind feature flags in production code

Example:
```typescript
console.log('[Collaboration] Received sync-step-1 from server')
console.log('[Yjs -> Zustand] Syncing updates from Yjs to store')
console.error('Failed to load asset:', error)
console.warn(`Asset not found: ${id}`)
```

## Comments

**When to Comment:**
- Complex algorithms or business logic requiring explanation
- Non-obvious calculations or transformations
- Event listener setup and protocol handling
- Comments above state initialization explaining purpose

**JSDoc/TSDoc:**
- Used sparingly; primarily for exported APIs and complex types
- Example from schema:
```typescript
/**
 * Building-local intersection point, relative to the currently selected building.
 * Equals `position` when no building is selected.
 * Use this for placing or committing anything that lives inside a building
 * (walls, slabs, items, etc.).
 */
localPosition: [number, number, number]
```

**Comment style:**
- Inline comments: `// Capital letter, full context`
- Block comments: JSDoc style for exported functions/types
- TODO/FIXME: Not commonly used (Biome doesn't enforce)

## Function Design

**Size:** 
- Component functions: Typically 30-250 lines (complex components like layout use helper functions)
- Utility functions: Keep under 50 lines when possible
- Example: `FeedbackDialog` is 265 lines (breaks into visual sections with comment dividers)

**Parameters:**
- Destructured object parameters for 2+ parameters - `({ projectId, userId, userName, userColor, socket, children }: Props)`
- Type annotations required for all parameters
- Optional parameters with defaults: `userName = 'User'`
- Use type inference for derived values when clear

**Return Values:**
- Explicit return types for functions (not auto-inferred)
- React components return JSX.Element or ReactNode
- Server actions return `{ success: boolean, error?: string }` or throw
- Async handlers return Promise types explicitly

Example:
```typescript
export async function inviteMember(
  organizationId: string,
  email: string,
  name: string
): Promise<{ success: boolean; error?: string }> {
  // implementation
}
```

## Module Design

**Exports:**
- Named exports preferred: `export const emitter = mitt<EditorEvents>()`
- Default exports used for providers and components
- Combine related exports in single files

**Pattern: Store/Hook modules:**
- Create Zustand store with middleware: `const useEditor = create<EditorState>(persist(...))`
- Export typed hooks for state slices: `const useEditor = (s) => s.activeSidebarPanel`
- Separate concerns: state, actions, selectors in same file when cohesive

**Pattern: Context + Provider:**
- Create context in provider file
- Export useContext hook with error guard
- Example in `YjsCollaborationProvider.tsx`:
```typescript
const CollaborationContext = createContext<CollaborationContextType | null>(null)
export const useCollaboration = () => {
  const context = useContext(CollaborationContext)
  if (!context) {
    throw new Error('useCollaboration must be used within a YjsCollaborationProvider')
  }
  return context
}
```

**Pattern: Action files:**
- Utility functions exported as named exports
- Group related actions: `nodeActions.ts` contains wall merging, point comparison, etc.
- Type definitions at top of file

## React Patterns

**Component Structure:**
1. 'use client' directive (for Client Components)
2. Imports (organized as above)
3. Types/interfaces
4. Component function
5. Hooks (useState, useContext, useEffect, etc.)
6. Event handlers
7. JSX return
8. Export

**State Management:**
- useState for component-local UI state
- Zustand for cross-component state: `useEditor`, `useScene`, `useViewer`
- Context for dependency injection: `useCollaboration()`
- localStorage persistence via Zustand middleware: `persist()`

**Event Handling:**
- Prevent default: `e.preventDefault()` before custom logic
- Stop propagation: `e.stopPropagation()` in specific cases
- Synthetic events used throughout (React's event system)

---

*Convention analysis: 2026-04-28*
