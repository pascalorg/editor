# Pascal Reverse Proxy

Small .NET reverse proxy for the Pascal editor. It is intended to be the single browser-facing entry point while the Pascal Next.js editor stays bound to localhost.

## Topology

```text
Browser
  -> http://localhost:8000
    -> this .NET proxy
      -> pascal-reverse-front/index.html for the home page
      -> http://127.0.0.1:3002 for Pascal editor / API / SSE
```

The proxy serves the custom front page and keeps Pascal as the internal editor:

- `/` -> `../pascal-reverse-front/index.html`
- `/scenes` -> `../pascal-reverse-front/index.html`
- `/proxy/scenes` -> read-only scene list from Pascal's SQLite database
- `/_pascal/**` -> Pascal editor site with the `/_pascal` prefix removed
- `/_next/**`
- `/api/scenes/**`
- `/api/scenes/{id}/events`

YARP handles streaming responses, so the Pascal scene-events SSE endpoint can continue to drive live editor updates.

## Run

For the complete three-layer local stack, see [`../SETUP.md`](../SETUP.md). The daily fast path is:

Start the Pascal editor from the repository root:

```bash
bun run dev --filter=editor
```

Start the AI service in a second terminal (it starts MCP automatically):

```bash
cd pascal-ai-mcp
bun run dev
```

Then start the proxy without repeating package restore:

```bash
dotnet run --project pascal-reverse-proxy --no-restore
```

Open:

```text
http://localhost:8000/
```

The custom home page loads project cards from `/proxy/scenes`. Clicking a card opens the original Pascal editor at `/_pascal/scene/{id}`.

The Pascal editor target defaults to:

```text
http://127.0.0.1:3002/
```

Change it in `appsettings.json` at:

```json
"ReverseProxy": {
  "Clusters": {
    "pascal": {
      "Destinations": {
        "editor": {
          "Address": "http://127.0.0.1:3002/"
        }
      }
    }
  }
}
```

## SQLite Scene List

`/proxy/scenes` reads the existing Pascal SQLite database directly and only selects scene metadata, not `graph_json`.

Path resolution matches Pascal's storage defaults:

1. `PascalDatabase:Path` from `appsettings.json`
2. `PASCAL_DB_PATH`
3. `PASCAL_DATA_DIR/pascal.db`
4. `%APPDATA%/Pascal/data/pascal.db` on Windows
5. `$XDG_DATA_HOME/pascal/data/pascal.db`
6. `$HOME/.pascal/data/pascal.db`

To force a database path:

```json
"PascalDatabase": {
  "Path": "C:\\Users\\you\\AppData\\Roaming\\Pascal\\data\\pascal.db",
  "ListLimit": 100
}
```

## Auth Guard

Auth is disabled by default:

```json
"ProxyAuth": {
  "Enabled": false
}
```

When enabled, these paths are protected by default:

- `/api/scenes`
- `/_pascal/scene`
- `/scenes`
- `/proxy/scenes`

Accepted credentials:

- Cookie: `PascalProxyAuth`
- Header: `X-Pascal-Proxy-Key`
- Header: `Authorization: Bearer <key>`

For local testing:

```json
"ProxyAuth": {
  "Enabled": true,
  "ApiKey": "your-local-secret"
}
```

Then visit:

```text
http://localhost:8000/proxy/login?key=your-local-secret
```

Logout:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/proxy/logout
```

Replace this simple API-key guard with your real auth/session logic before exposing it beyond local development.

## Health

```text
http://localhost:8000/proxy/health
```
