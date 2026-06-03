# Proxy Project Metadata And Cover Change

Date: 2026-06-01

## Summary

Added proxy-owned persistence for project display metadata and cover images. This keeps Pascal scene data untouched while allowing the custom proxy front page to manage extra project-facing fields.

## Files Changed

Total changed files: 3

- `pascal-reverse-proxy/Program.cs`
  - Added proxy-owned SQLite initialization at `pascal-reverse-proxy/data/proxy.db`.
  - Added `project_covers` table for uploaded cover image metadata.
  - Added `project_overrides` table for display name, description, cover type, and cover value.
  - Added `POST /proxy/scenes/{id}/cover` for local image upload.
  - Added `GET /proxy/covers/{fileName}` for serving uploaded covers.
  - Added `PUT /proxy/scenes/{id}/metadata` for persisting custom project metadata.
  - Updated `/proxy/scenes` to merge Pascal SQLite scene data with proxy-owned metadata.

- `pascal-reverse-proxy/appsettings.json`
  - Added `ProxyDatabase` configuration.

- `pascal-reverse-front/index.html`
  - New project creation now creates a real Pascal scene through `/api/scenes`.
  - Uploaded cover images are sent to `/proxy/scenes/{id}/cover`.
  - Project edits are persisted through `/proxy/scenes/{id}/metadata`.
  - Project list mapping now supports proxy metadata fields: `description`, `coverType`, and `coverValue`.

## Data Storage

Pascal scene data remains in the Pascal SQLite database:

```text
C:\Users\lytec\.pascal\data\pascal.db
```

Proxy-only project metadata is stored in:

```text
pascal-reverse-proxy\data\proxy.db
```

Uploaded cover files are stored in:

```text
pascal-reverse-proxy\data\covers\
```

## Verification

- Built successfully:

```powershell
dotnet build pascal-reverse-proxy\pascal-reverse-proxy.csproj --no-restore
```

- Restarted the proxy and verified:
  - `http://localhost:8000/proxy/health` returns `ok`.
  - `http://localhost:8000/proxy/scenes` returns scene data with proxy metadata fields.
  - `pascal-reverse-proxy/data/proxy.db` is created.

## Notes

- Pascal editor code was not modified for this change.
- Pascal scene editing, saving, MCP mutation, and SSE live updates remain on the original Pascal routes.
- The proxy database is for sidecar/front-page metadata only.
