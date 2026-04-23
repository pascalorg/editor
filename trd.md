# Technical Requirements Document (TRD): Pascal Collaborative Backend

## 1. System Architecture
The system will follow a distributed architecture to support real-time synchronization and organizational management.

### 1.1 Backend Services
- **API Server (Next.js)**: Handles HTTP requests for organization management, auth, and analytics.
- **WebSocket Server**: Dedicated Node.js or Next.js custom server for real-time state synchronization using Socket.io.
- **Worker Service**: Background tasks for processing 3D exports, image optimizations, and analytics aggregation.

### 1.2 Data Infrastructure
- **PostgreSQL**: Primary relational database for persistence.
- **Redis**: 
  - Socket.io Adapter for horizontal scaling.
  - Caching layer for project state.
  - Pub/Sub for inter-service communication.
- **Cloudflare R2**: S3-compatible object storage for 3D assets (.glb, .obj, .json), textures, and user uploads.

## 2. Database Schema (Draft)

### 2.1 Core Entities
- **User**: `id, email, password_hash, name, avatar_url`
- **Organization**: `id, name, slug, logo_url, status (PENDING, APPROVED, REJECTED)`
- **OrganizationMember**: `id, organization_id, user_id, role (OWNER, ADMIN, MEMBER)`
- **Team**: `id, organization_id, name, description`
- **TeamMember**: `id, team_id, user_id`
- **Project**: `id, team_id, name, description, thumbnail_url, current_state_url (R2)`
- **ProjectSession**: `id, project_id, active_users (array)`

## 3. Real-time Collaboration Protocol

### 3.1 State Synchronization
- **Optimistic Updates**: Clients apply changes locally first.
- **Operational Transformation (OT) or CRDT**: To resolve conflicts in the node tree. Given the current Zustand `useScene` structure, we will implement a simplified CRDT-like approach where nodes are identified by UUIDs and last-writer-wins (LWW) is applied to individual properties.
- **Messages**:
  - `SYNC_STATE`: Sent when joining a project.
  - `NODE_UPDATE`: Broadcasted when a node property changes.
  - `NODE_CREATE`: Broadcasted when a new node is added.
  - `NODE_DELETE`: Broadcasted when a node is removed.
  - `PRESENCE_UPDATE`: Cursor positions and selections.

### 3.2 Redis Backed Pub/Sub
- Use Redis to sync WebSocket events across multiple server instances.

## 4. Analytics & Monitoring
- **PostHog Integration**: 
  - Frontend: Tracking user interactions and editor tool usage.
  - Backend: Tracking API performance and organization growth.
- **Admin Dashboard**: 
  - Built within the Pascal app (protected route `/admin`).
  - Fetches organization applications from PostgreSQL.
  - Displays usage metrics from PostHog API.

## 5. Security
- **Authentication**: JWT-based auth (possibly using NextAuth.js or custom Clerk/Auth.js integration).
- **Authorization**: Middleware to verify organization and project membership before allowing WebSocket connections or R2 access.
- **R2 Security**: Use Presigned URLs for temporary access to private assets.

## 6. Infrastructure & Deployment
- **Docker**: Multistage Dockerfile for the Next.js application.
- **Docker Compose**: Orchestrating Next.js, PostgreSQL, Redis, and a reverse proxy (Nginx/Caddy).
- **KVM Deployment**: Github Actions for CI/CD, deploying the Docker containers to the target KVM server.

## 7. Implementation Progress
1. **Phase 1 [COMPLETED]**: Organization application form & Admin approval dashboard.
2. **Phase 2 [IN PROGRESS]**: Auth & Organization/Team management.
3. **Phase 3 [COMPLETED]**: R2 Integration for project saving/loading.
4. **Phase 4 [COMPLETED]**: Real-time WebSockets with Redis sync.
5. **Phase 5 [COMPLETED]**: PostHog analytics and SaaS Landing Page.
6. **Phase 6 [COMPLETED]**: Docker Orchestration & Caddy SSL setup.
