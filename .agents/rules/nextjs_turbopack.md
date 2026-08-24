# Node builtins and the browser bundle

**Classification:** Rule

## Rationale

A build that fails with

```
the chunking context (unknown) does not support external modules (request: node:fs)
```

is telling you that something reachable from a **client** module imports a Node
builtin. The bundler is not misconfigured; the import graph is wrong.

## What actually happened here

`e2bd6351` added `apps/editor/components/mcp-relay-client.tsx`:

```tsx
'use client'
import { createPascalMcpServer } from '@pascal-app/mcp/server'
```

`'use client'` sends a module to the browser, and with it **every module it
imports, at any depth**. The chain ran:

```
mcp-relay-client.tsx  ('use client')
  └─ @pascal-app/mcp/server
       └─ registerTools()
            └─ tools/scene-lifecycle/metadata.ts
                 └─ import { createHash } from 'node:crypto'
```

Four commits then tried to fix it through configuration —
`transpilePackages`, removing plugins from the bundle, bumping Next — and all
four failed, because none of them touched the chain.

## Directives

1. **No module reachable from a `'use client'` file may import `node:*`,** at
   any import depth. Trace the chain from the client file to the builtin before
   changing any config; that is where the fix belongs.

2. **Do not use `'use server'` for this.** It does not mean "keep this on the
   server". It marks a file as a *Server Actions* module and requires every
   export in it to be an async function — adding it to a `page.tsx`, which
   default-exports a component, is a hard build error. `9720d493` tried exactly
   this and its deploy failed.

3. **The mechanisms that do work:** `import 'server-only'` (fails at build time
   if the module reaches the client), simply not writing `'use client'` (App
   Router modules are server modules by default), or `serverExternalPackages` in
   `next.config.ts` for a package that must stay on Node.

4. **A package needed on both sides needs a browser-safe entry point.** If the
   browser genuinely has to run something the server package provides, the
   package exports a second entry built without Node builtins — Web Crypto in
   place of `node:crypto`, and so on. There is no config that makes a Node
   builtin resolve in a browser bundle.

## Note on placement

Agent tooling in this repo reads `.agents/skills/`, not `.agents/rules/` —
`.claude/`, `.cursor/` and `.codex/` symlink only `skills`. Nothing loads this
file automatically today; it is kept as the written record of a four-day
outage, and it is correct if someone does read it.
