# Project Context: Pascal Collaborative Editor

## Project Overview
Pascal is a high-performance 3D building editor built with React Three Fiber and WebGPU. Originally a standalone client-side tool, it has been evolved into an enterprise-grade collaborative platform where organizational teams can design 3D spaces together in real-time.

## Current Technical Stack
- **Frontend Framework**: Next.js 15+ (App Router)
- **3D Engine**: Three.js (WebGPU), React Three Fiber, Drei
- **Real-time Sync**: Socket.io with Redis Adapter (horizontal scaling)
- **Persistence**: PostgreSQL (Prisma ORM) & Cloudflare R2 (Object Storage)
- **State Management**: Zustand, Zundo (Undo/Redo)
- **Monorepo Tooling**: Turborepo, Bun
- **Infrastructure**: Docker & Docker Compose with Caddy (Reverse Proxy/SSL)
- **Analytics**: PostHog (Client & Server-side tracking)
- **Styling**: Tailwind CSS, Framer Motion, Lucide React

## Core Modules & Packages
- `apps/editor`: The main Next.js application containing the editor, SaaS landing page, beta application, and admin dashboard.
- `packages/core`: Core schemas, business logic, and state management (Zustand).
- `packages/editor`: Reusable UI components and systems for the 3D editor.
- `packages/viewer`: Low-level 3D rendering components and interactive systems.

## Key Features (Implemented)
- **SaaS Landing Page**: Premium, high-conversion B2B landing page.
- **Beta Access System**: Public application form and internal Admin Dashboard for approvals.
- **Collaborative Layer**: Real-time node synchronization and 3D presence (cursors/names).
- **Project Persistence**: Server actions for saving/loading projects between DB and R2.
- **Enterprise Ready**: Full Docker orchestration with automated SSL via Caddy.

## Stakeholders
- **Organizations**: Enterprise entities working on spatial design.
- **Teams**: Collaborative groups within organizations with role-based permissions.
- **Admins**: Platform operators managing beta access and monitoring system health.

## Design Principles
- **Visual Excellence**: State-of-the-art dark mode design with glassmorphism and premium animations.
- **Real-time Performance**: Low-latency delta-based sync that preserves WebGPU rendering speed.
- **Scalable Architecture**: Containerized services designed for KVM server deployment.
