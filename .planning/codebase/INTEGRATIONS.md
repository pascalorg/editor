# External Integrations

**Analysis Date:** 2026-04-28

## APIs & External Services

**File Storage:**
- Cloudflare R2 (S3-compatible object storage)
  - Used for project assets, models, images, and thumbnails
  - SDK/Client: `@aws-sdk/client-s3` 3.1038.0
  - Pre-signed URLs: `@aws-sdk/s3-request-presigner` 3.1038.0
  - Credentials:
    - `R2_ACCOUNT_ID` - Cloudflare account ID
    - `R2_ACCESS_KEY_ID` - API access key
    - `R2_SECRET_ACCESS_KEY` - API secret key
    - `R2_BUCKET_NAME` - Default bucket name
  - Upload endpoint: `POST /api/upload/presign` (`apps/editor/app/api/upload/presign/route.ts`)
  - Allowed file types: glTF (binary/JSON), JPEG, PNG, WebP, KTX2

**Analytics & Observability:**
- PostHog - Product analytics and feature flags
  - Client library: `posthog-js` 1.370.1 (browser)
  - Server library: `posthog-node` 5.29.5 (Node.js)
  - Configuration:
    - `NEXT_PUBLIC_POSTHOG_KEY` - Project API key
    - `NEXT_PUBLIC_POSTHOG_HOST` - PostHog instance URL (default: https://us.i.posthog.com)
  - Client initialization: `apps/editor/lib/posthog.tsx`
  - Server initialization: `apps/editor/lib/posthog-server.ts`

## Data Storage

**Databases:**

**PostgreSQL:**
- Provider: PostgreSQL 15-alpine (docker-compose)
- Connection: `DATABASE_URL` environment variable
- Client: Prisma ORM 5.10.0
- Configuration: `apps/editor/prisma/schema.prisma`
- Connection pooling: Handled by Prisma
- Schema contains:
  - User (authentication, profile)
  - Organization (RBAC, multi-tenancy)
  - Team (project grouping)
  - Project (3D building projects)
  - ProjectMember (RBAC for projects)
  - MarketplaceAsset (published projects)
  - ProjectClone (asset cloning tracking)
  - EarlyAccessApplication (waitlist)

**File Storage:**
- Cloudflare R2 (see APIs section above)

**Caching:**
- Redis 7-alpine (docker-compose)
- Connection: `REDIS_URL` environment variable
- Client: ioredis 5.10.1
- Usage:
  - Socket.io pub/sub adapter via `@socket.io/redis-adapter` 8.3.0
  - Real-time collaboration scaling across multiple server instances
  - Session store potential (though Next Auth handles JWT in this setup)
- Initialization: `apps/editor/lib/redis.ts`

## Authentication & Identity

**Auth Provider:**
- Next Auth 4.24.14 (Custom implementation)
- Implementation approach:
  - Credentials provider (email/password)
  - Password hashing: bcryptjs 3.0.3
  - JWT session strategy
  - Configuration: `apps/editor/lib/auth.ts`
  - Secret: `NEXTAUTH_SECRET` environment variable
- Auth URL: `NEXTAUTH_URL` environment variable
- API route: `apps/editor/app/api/auth/[...nextauth]/route.ts`
- Signup route: `apps/editor/app/api/auth/signup/route.ts` (custom signup handler)
- Session cookie handling managed by Next Auth

## Monitoring & Observability

**Error Tracking:**
- Not detected in primary dependencies, errors likely logged to stdout

**Logs:**
- Prisma logs (development): Query logs, errors, warnings
- Socket.io logs: Connection events, project joins, sync operations
- Server-side: Node.js console output to Docker stdout
- Configuration: `apps/editor/lib/prisma.ts` - verbose logging in development mode

**Metrics & Analytics:**
- PostHog (see APIs section above)

## CI/CD & Deployment

**Hosting:**
- Docker containerization (Dockerfile at `apps/editor/Dockerfile`)
- Docker Compose orchestration (see `docker-compose.yml`)
- Caddy reverse proxy for SSL/TLS termination and routing
- Environment: Self-hosted or cloud with Docker support

**CI Pipeline:**
- GitHub Actions workflow: `gh workflow run release.yml`
- Release scripts for version bumping (patch, minor, major)
- Separate release workflows for viewer, core, and both packages

## Environment Configuration

**Required env vars:**

**Core Infrastructure:**
- `DOMAIN` - Domain for Caddy reverse proxy
- `EMAIL` - Email for Caddy SSL certificates
- `NODE_ENV` - development or production

**Database:**
- `DATABASE_URL` - PostgreSQL connection string (format: `postgresql://user:password@host:port/dbname`)

**Authentication:**
- `NEXTAUTH_URL` - Application URL for NextAuth redirect (e.g., https://archly.cloud)
- `NEXTAUTH_SECRET` - JWT signing secret (generate with: `openssl rand -base64 32`)

**Real-time:**
- `REDIS_URL` - Redis connection string (default: redis://localhost:6379)
- `NEXT_PUBLIC_SOCKET_URL` - Socket.io server URL (e.g., https://archly.cloud)

**File Storage:**
- `R2_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - Cloudflare R2 API access key
- `R2_SECRET_ACCESS_KEY` - Cloudflare R2 API secret key
- `R2_BUCKET_NAME` - R2 bucket name for assets
- `R2_PUBLIC_URL` - Optional public CDN URL for R2 bucket

**Analytics:**
- `NEXT_PUBLIC_POSTHOG_KEY` - PostHog project API key
- `NEXT_PUBLIC_POSTHOG_HOST` - PostHog instance URL

**Secrets location:**
- Development: `.env.local` file (not committed)
- Production: `.env.production` file with sensitive values provided at runtime
- Docker: Environment variables in docker-compose.yml or .env file for docker-compose

## Webhooks & Callbacks

**Incoming:**
- Not detected in primary routes

**Outgoing:**
- Not detected in dependency analysis

**Real-time Events via Socket.io:**
- `join-project` - Client joins project collaboration
- `yjs-sync-step-1` - Server sends state vector to client
- `yjs-sync-step-1` - Client sends state vector to server (step 1 response)
- `yjs-sync-step-2` - Server sends state updates to client
- `yjs-update` - Collaborative document updates from clients
- `awareness-update` - User presence/awareness updates
- Broadcast pattern: Updates sent to `project:{projectId}` room

## API Endpoints

**Authentication:**
- `POST /api/auth/signup` - User registration
- `POST /api/auth/[...nextauth]` - Next Auth callback endpoints

**Projects & Files:**
- `POST /api/upload/presign` - Generate pre-signed URL for R2 uploads
  - Requires project edit access
  - Returns: `{ uploadUrl, key, publicUrl }`
- `POST /api/projects/[projectId]/members` - Project member management
- `POST /api/marketplace/clone` - Clone asset from marketplace

**System:**
- `GET /api/health` - Health check endpoint

---

*Integration audit: 2026-04-28*
