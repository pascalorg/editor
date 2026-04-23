# Product Requirements Document (PRD): Pascal Teams & Collaboration

## 1. Vision
Transform Pascal from a personal 3D editor into an enterprise-grade collaborative spatial design platform. Enable organizations to manage teams, projects, and work together in a shared 3D environment with real-time feedback.

## 2. Target Audience
- Architecture and Design Firms
- Real Estate Developers
- Construction Management Teams
- Collaborative 3D Content Creators

## 3. Key Features

### 3.1 Organization & Team Management
- **Organization Onboarding**: Landing page for organizations to apply for early beta access.
- **Organization Profile**: Management of organization name, logo, and members.
- **Team Creation**: Ability to group members into specific teams within an organization.
- **Role-Based Access Control (RBAC)**: Roles like Admin, Editor, and Viewer at both Organization and Project levels.

### 3.2 Collaborative Project Workspace
- **Project Repository**: Centralized storage for 3D projects.
- **Real-time Multiplayer**: See other team members' cursors, selections, and edits in real-time.
- **Project History**: Versioning and audit logs of who changed what and when.
- **Comments & Annotations**: Ability to leave spatial comments on 3D nodes for team feedback.

### 3.3 Beta Access & Admin Dashboard
- **Application Workflow**: Public form for organizations to submit their interest.
- **Admin Approval Queue**: Dashboard for Pascal admins to review and approve applications.
- **User Analytics**: Visibility into organization activity, project growth, and system performance via PostHog.

### 3.4 Assets & Storage
- **Cloud Persistence**: Move beyond IndexedDB to server-side storage for projects.
- **Asset Library**: Shared organization-level asset library (textures, 3D models) stored on Cloudflare R2.

## 4. User Experience (UX) Goals
- **Seamless Real-time**: Edits should reflect across all clients in <100ms.
- **Pro-level Interface**: Retain the high-performance feel of the WebGPU editor while adding collaborative UI elements.
- **Low Friction Onboarding**: Simple application and approval process to drive beta adoption.

## 5. Success Metrics
- Number of organizations applied/approved.
- Active monthly teams.
- Number of concurrent users in a single project.
- Project retention rate.
## 6. Current Status
- **Beta Access**: [Implemented] Public application form and Admin Dashboard are live.
- **Real-time Engine**: [Implemented] Node sync and presence system operational.
- **Persistence**: [Implemented] R2 and PostgreSQL integration active.
- **Team/Org Management**: [In Progress] NextAuth integration and RBAC setup.
