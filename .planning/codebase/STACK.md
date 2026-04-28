# Technology Stack

**Analysis Date:** 2026-04-28

## Languages

**Primary:**
- TypeScript 5.9.3 - All application code, configurations, and packages
- JavaScript - Client-side runtime execution

**Secondary:**
- JSX/TSX - React component definitions

## Runtime

**Environment:**
- Node.js >= 18 (as per `package.json` engines requirement)

**Package Manager:**
- Bun 1.3.0 - Primary package manager and task runner
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**
- Next.js 16.2.1 - Full-stack React application in `apps/editor`
- React 19.2.4 - UI component library and development
- React DOM 19.2.4 - DOM rendering

**3D Rendering:**
- Three.js 0.184.0 - 3D graphics rendering engine
- @react-three/fiber 9.5.0 - React abstraction for Three.js
- @react-three/drei 10.7.7 - Useful Three.js helpers and utilities
- @react-three/uikit-lucide 1.0.62 - UI components for 3D scenes

**Real-time Collaboration:**
- Yjs 13.6.30 - CRDT library for collaborative editing
- y-protocols 1.0.7 - Yjs protocol implementations
- Socket.io 4.8.3 - WebSocket server for real-time communication
- Socket.io-client 4.8.3 - WebSocket client library

**UI Components & Styling:**
- Radix UI (@radix-ui/*) - Headless UI component library
- TailwindCSS 4.2.1 - Utility-first CSS framework
- @tailwindcss/postcss 4.2.1 - PostCSS plugin for Tailwind
- Lucide React 1.8.0, 0.562.0 - Icon library
- @iconify/react 6.0.2 - Icon provider library
- Framer Motion 11 - Animation library
- Geist 1.7.0 - Design system
- Motion 12.34.3 - Lightweight animation alternative

**Data & State Management:**
- Zustand 5.0.11 - Lightweight state management
- Zundo 2.3.0 - Undo/redo middleware for Zustand
- Zod 4.3.5, 4.3.6 - Runtime schema validation

**Animation & Interaction:**
- @number-flow/react 0.5.14 - Number animation component
- Howler 2.2.4 - Audio library
- React Grab - Drag functionality component
- React Scan 0.5.3 - Component debugging tool

**Testing/Development:**
- Biome 2.4.6 - Linting, formatting, and bundling
- TypeScript 5.9.3 - Type checking

**Build & Bundling:**
- Turbo 2.8.15 - Monorepo task orchestration
- PostCSS 8.5.6 - CSS transformation tool
- ESLint 9.39.1 - JavaScript linting

## Key Dependencies

**Critical:**
- @prisma/client 5.10.0 - ORM for database access - Essential for all data operations
- @aws-sdk/client-s3 3.1038.0 - AWS S3 client - File upload/storage
- @aws-sdk/s3-request-presigner 3.1038.0 - Pre-signed URL generation
- next-auth 4.24.14 - Authentication framework - User session management
- bcryptjs 3.0.3 - Password hashing

**Real-time & Collaboration:**
- @socket.io/redis-adapter 8.3.0 - Redis adapter for Socket.io scaling
- ioredis 5.10.1 - Redis client - Session store and pub/sub

**Infrastructure:**
- PostHog 1.370.1 (JS), 5.29.5 (Node) - Product analytics
- Clsx 2.1.1 - Class name utility
- Tailwind Merge 3.5.0 - Tailwind utility merge
- CVA (class-variance-authority) 0.7.1 - CSS component patterns

## Configuration

**Environment:**
- Configuration via `.env` files (`.env.example` and `.env.production` provided)
- Required variables:
  - `NEXTAUTH_URL` - Next Auth redirect URL
  - `NEXTAUTH_SECRET` - Session encryption secret
  - `DATABASE_URL` - PostgreSQL connection string
  - `REDIS_URL` - Redis connection URL
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` - Cloudflare R2 credentials
  - `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` - PostHog analytics keys
  - `NEXT_PUBLIC_SOCKET_URL` - Socket.io server URL

**Build:**
- `next.config.ts` - Next.js configuration at `apps/editor/next.config.ts`
- `biome.jsonc` - Biome linting/formatting configuration
- `tsconfig.json` files per package with shared configs in `packages/typescript-config/`
- `turbo.json` - Turbo monorepo configuration

**Code Organization:**
- Monorepo structure with Turbo workspaces:
  - `apps/editor` - Main Next.js application
  - `packages/core` - Core 3D editor library
  - `packages/editor` - Editor React components
  - `packages/viewer` - 3D viewer component
  - `packages/ui` - Shared UI components
  - `tooling/typescript` - TypeScript configuration sharing

## Platform Requirements

**Development:**
- Node.js >= 18
- Bun 1.3.0 (preferred package manager)
- PostgreSQL 15+ (for local development, see docker-compose.yml)
- Redis 7+ (for real-time features, see docker-compose.yml)
- Git

**Production:**
- Node.js >= 18 runtime
- PostgreSQL 15+ database (matches docker-compose setup)
- Redis 7+ for caching and Socket.io adapter
- Cloudflare R2 account (S3-compatible object storage)
- PostHog cloud account (optional, for analytics)
- Domain with SSL/TLS (Caddy reverse proxy in docker-compose.yml)

---

*Stack analysis: 2026-04-28*
