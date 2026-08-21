# Next.js Server Components and Turbopack Bundling Rule

**Classification:** Rule

## Rationale
To prevent CI build failures, Next.js Server Components that rely on Node.js modules must be explicitly marked.

## Directives
1. **Explicit Server Directives:** When creating or modifying Next.js Server Components in the `app/` directory (like `page.tsx` or `layout.tsx`) that import Node.js-specific modules or server-only authentication/database utilities, you MUST prepend the file with the `'use server'` directive to explicitly instruct Turbopack not to bundle these modules for the browser.
2. **Turbopack Bundling Context:** If you encounter `the chunking context (unknown) does not support external modules (request: node:fs)` or similar module resolution errors in Next.js builds, immediately check for missing `'use server'` directives in the importing files.
