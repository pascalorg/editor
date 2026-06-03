# Reverse Proxy Front Scene List Change

Date: 2026-05-29

## Summary

Added a .NET reverse proxy entry point that serves the custom `pascal-reverse-front` home page, reads Pascal scene metadata directly from the existing SQLite database, and opens the original Pascal editor when a project card is clicked.

## Files Changed

Total changed files: 5

- `pascal-reverse-proxy/Program.cs`
  - Added `/proxy/scenes`, a read-only endpoint that queries the Pascal SQLite `scenes` table.
  - Added Pascal database path resolution using `PascalDatabase:Path`, `PASCAL_DB_PATH`, `PASCAL_DATA_DIR`, and repository `.env.local`.
  - Changed `/` and `/scenes` to serve `pascal-reverse-front/index.html`.
  - Added `/logo.svg` static serving.
  - Kept Pascal editor behind `/_pascal/**` through YARP path-prefix removal.

- `pascal-reverse-proxy/appsettings.json`
  - Added `PascalDatabase` configuration.
  - Split proxy routes for `/api/scenes/**`, `/_next/**`, `/_pascal/**`, `/favicon.ico`, and `/fonts/**`.
  - Updated protected auth path prefixes to include `/_pascal/scene` and `/proxy/scenes`.

- `pascal-reverse-proxy/pascal-reverse-proxy.csproj`
  - Added `Microsoft.Data.Sqlite` for read-only SQLite scene list queries.
  - Kept `Yarp.ReverseProxy` for proxying Pascal editor/API/SSE routes.

- `pascal-reverse-proxy/README.md`
  - Documented the new topology: custom front page plus internal Pascal editor proxy.
  - Documented `/proxy/scenes` and SQLite path resolution.
  - Updated auth guard path notes.

- `pascal-reverse-front/index.html`
  - Changed project loading from local-only startup data to `/proxy/scenes`.
  - Added fallback to the existing localStorage/default projects if backend loading fails.
  - Mapped SQLite scene metadata into project cards.
  - Added project-card click navigation to `/_pascal/scene/{id}`.

## Verification

- Built successfully:

```powershell
dotnet build pascal-reverse-proxy\pascal-reverse-proxy.csproj --no-restore
```

- Started the proxy and verified:
  - `http://localhost:8000/proxy/health` returns `ok`.
  - `http://localhost:8000/` returns the custom front page.
  - `http://localhost:8000/proxy/scenes` reads `C:\Users\lytec\.pascal\data\pascal.db`.
  - `/proxy/scenes` returns 17 scenes after loading `PASCAL_DB_PATH` from `.env.local`.

## Notes

- The original Pascal editor is not modified for this stage.
- Scene editing, saving, MCP mutation, and SSE live updates continue to run through Pascal routes.
- The .NET proxy should stay as the browser-facing entry point; Pascal remains available internally at `http://127.0.0.1:3002`.
