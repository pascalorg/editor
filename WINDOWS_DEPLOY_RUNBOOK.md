# Windows Deploy Runbook

This document describes how to deploy and run this project on another Windows machine without Docker.

## 1. Install Prerequisites

Install these tools on the target Windows machine:

- Git
- Bun 1.3.x
- .NET SDK/Runtime for `net10.0`
- Node.js LTS, optional but recommended for toolchain compatibility

Verify:

```powershell
git --version
bun --version
dotnet --version
node --version
```

## 2. Clone The Project

```powershell
git clone <your-repository-url>
cd pascalorg-editor0-9-1
```

Install root workspace dependencies:

```powershell
bun install
```

Install AI MCP dependencies:

```powershell
cd pascal-ai-mcp
bun install
cd ..
```

## 3. Prepare Data Files

Create a data directory on the target machine:

```powershell
mkdir C:\pascal-data
```

Copy these files from the source machine:

```text
C:\Users\lytec\.pascal\data\pascal.db
C:\Users\lytec\.pascal\data\pascal-reverse-proxy.db
```

Place them on the target machine:

```text
C:\pascal-data\pascal.db
C:\pascal-data\pascal-reverse-proxy.db
```

The target Windows user must have read and write access to `C:\pascal-data`.

## 4. Create `.env.local`

Create `.env.local` in the project root:

```env
PASCAL_DB_PATH=C:/pascal-data/pascal.db
PASCAL_PROXY_DB_PATH=C:/pascal-data/pascal-reverse-proxy.db

MADORI_API_URL=https://cad.madori-navi.jp/analyze-dxf
MADORI_API_KEY=<your-madori-api-key>

NEXT_ALLOWED_DEV_ORIGINS=<target-machine-ip>:8000
PASCAL_ALLOW_CATALOG_SOURCE_WRITE=true
NEXT_PUBLIC_ALLOW_CATALOG_SOURCE_WRITE=true

OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_MODEL=<your-openrouter-model>
NEXT_PUBLIC_AI_ASSISTANT_URL=http://<target-machine-ip>:5900/
```

Example:

```env
NEXT_ALLOWED_DEV_ORIGINS=192.168.100.230:8000
```

If the target machine IP changes, update `.env.local`, rebuild the editor, and restart the editor service.

## 5. Build The Editor

```powershell
cd apps\editor
bun run build
```

The build may print Next.js NFT trace warnings. They are warnings only if the command exits successfully.

## 6. Start The Editor

Open a PowerShell window:

```powershell
cd apps\editor
bun run start
```

The editor listens on:

```text
http://0.0.0.0:3002
```

## 7. Start The Reverse Proxy

Open another PowerShell window:

```powershell
cd pascal-reverse-proxy
dotnet run
```

The reverse proxy listens on:

```text
http://0.0.0.0:8000
```

Users should access the project through the proxy:

```text
http://<target-machine-ip>:8000
```

Example:

```text
http://192.168.100.230:8000
```

## 8. Start AI MCP

Open another PowerShell window if AI chat is needed:

```powershell
cd pascal-ai-mcp
bun run start
```

The AI MCP service listens on:

```text
http://0.0.0.0:8788
```

The AI assistant iframe currently expects the AI front/chat page on port `5900` unless `NEXT_PUBLIC_AI_ASSISTANT_URL` is configured.
Use the root URL, not a fixed `/#/thread/...` URL. A fixed thread URL may point to a conversation that only exists on the source machine.

## 9. Windows Firewall

Allow inbound access for these ports as needed:

```text
8000  Reverse proxy entry point. This is the main port users should access.
3002  Editor service. Usually only the proxy needs this, but local testing may use it.
8788  AI MCP service, if AI chat is used.
5900  AI front/chat page, if used.
```

At minimum, expose port `8000` to other users on the LAN.

## 10. Common Checks

Check proxy health:

```text
http://<target-machine-ip>:8000/proxy/health
```

Check scene API:

```text
http://<target-machine-ip>:8000/api/scenes/<scene-id>
```

Check catalog API:

```text
http://<target-machine-ip>:8000/api/catalog-items
```

## 11. Restart After Config Changes

After changing `.env.local`:

1. Stop the editor process.
2. Rebuild:

```powershell
cd apps\editor
bun run build
```

3. Start again:

```powershell
bun run start
```

Restart the reverse proxy if proxy configuration or database path configuration changed.
