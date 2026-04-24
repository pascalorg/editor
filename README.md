# Archly.Cloud (Pascal Editor)

**Archly.Cloud** is a production-grade, real-time collaborative 3D architecture and building design platform. Built upon the powerful **Pascal Editor** system, it leverages high-performance web technologies to bring professional architectural tools to the browser.

![Archly.Cloud Header](https://github.com/user-attachments/assets/8b50e7cf-cebe-4579-9vc3-8786b35f7b6b)

## 🏗️ The Pascal Editor System

At its core, Archly.Cloud is powered by the Pascal Editor ecosystem—a modular, high-performance toolkit for 3D building modeling.

### Core Pillars
- **Real-Time Collaboration**: Powered by **Yjs** and **Socket.io** with a **Redis** backplane, enabling buttery-smooth multi-user editing with sub-millisecond latency.
- **High-Performance Rendering**: Built with **React Three Fiber** and **Three.js**, utilizing the **WebGPU** renderer for next-generation visual fidelity.
- **Procedural Geometry**: Custom systems in `@pascal-app/core` handle complex architectural operations like wall mitering, CSG cutouts for doors/windows, and procedural slab generation in real-time.
- **Robust Persistence**: Hybrid storage using **Cloudflare R2** for large scene graphs and **Prisma/PostgreSQL** for relational metadata.

---

## 📂 Repository Architecture

This is a **Turborepo** monorepo designed for maximum modularity and reuse.

```
pascal-editor/
├── apps/
│   └── editor/          # The Archly.Cloud Next.js Application
├── packages/
│   ├── core/            # The "Engine": Schemas, CRDT logic, & Procedural Systems
│   ├── viewer/          # The "Renderer": Three.js components & Camera systems
│   └── ui/              # Shared Design System & Component Library
```

### Component Breakdown
| Package | Responsibility |
|---------|---------------|
| **@pascal-app/core** | Scene state (Zustand), Yjs bindings, geometry systems, and spatial grid management. |
| **@pascal-app/viewer** | 3D rendering primitives, selection highlighting, and environment controls. |
| **apps/editor** | User interface, tools (Wall, Slab, Item), authentication, and project management. |

---

## 🚀 Technology Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server Actions)
- **3D Engine**: [Three.js](https://threejs.org/) + [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- **Collaboration**: [Yjs](https://yjs.dev/) + [Socket.io](https://socket.io/) + [Redis](https://redis.io/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/) + [Zundo](https://github.com/chandlerver5/zundo) (Undo/Redo)
- **Database**: [Prisma](https://www.prisma.io/) + [PostgreSQL](https://www.postgresql.org/)
- **Storage**: [Cloudflare R2](https://www.cloudflare.com/products/r2/) (S3-compatible)
- **Analytics**: [PostHog](https://posthog.com/)

---

## 🛠️ Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (Required for package management)
- [Docker](https://www.docker.com/) (For production-like local development)

### Development
To start the full development environment with hot-reloading for all packages:

```bash
bun install
bun dev
```
Open [http://localhost:3002](http://localhost:3002) to access the local editor.

### Production Deployment
Archly.Cloud is designed to run in a containerized environment.

1. **Configure Environment**:
   Copy `.env.production` to `.env` and fill in your Cloudflare R2 and Database credentials.

2. **Deploy with Docker Compose**:
   ```bash
   docker-compose up --build -d
   ```
   This will spin up:
   - **Next.js App**: Running on port 3002.
   - **PostgreSQL**: For user and project metadata.
   - **Redis**: For real-time sync scaling.
   - **Caddy**: Reverse proxy with automatic SSL (if configured).

---

## 🌐 Real-Time Presence
Archly.Cloud features a premium presence system that shows collaborators' cursors in real-time with:
- **LERP Interpolation**: Smooth, fluid movement regardless of network speed.
- **Glassmorphism UI**: High-fidelity name badges and status indicators.
- **Throttled Broadcasting**: Optimized for low bandwidth usage.

---

## ⚖️ License
Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
  Built with ❤️ for architects and designers.
</div>
