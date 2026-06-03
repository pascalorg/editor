# Proxy Database Path Change

## Background

The reverse proxy uses two different SQLite databases:

- `PascalDatabase`: reads Pascal editor scene data.
- `ProxyDatabase`: writes proxy-only data such as project metadata overrides and cover records.

The Pascal scene database was already aligned through root `.env.local`:

```text
PASCAL_DB_PATH=C:/Users/lytec/.pascal/data/pascal.db
```

However, the proxy-only database still defaulted to:

```text
pascal-reverse-proxy/data/proxy.db
```

When the proxy was running from the build output or when project-local database/WAL files were in an awkward state, write requests could fail with:

```text
SQLite Error 8: 'attempt to write a readonly database'
```

## Change

`pascal-reverse-proxy/Program.cs` now resolves `ProxyDatabase` in this order:

1. `ProxyDatabase:Path` from `appsettings.json`
2. `PASCAL_PROXY_DB_PATH` environment variable
3. `PROXY_DB_PATH` environment variable
4. `PASCAL_PROXY_DB_PATH` from repository root `.env.local`
5. `PROXY_DB_PATH` from repository root `.env.local`
6. fallback: `pascal-reverse-proxy/data/proxy.db`

Root `.env.local` should contain:

```text
PASCAL_DB_PATH=C:/Users/lytec/.pascal/data/pascal.db
PASCAL_PROXY_DB_PATH=C:/Users/lytec/.pascal/data/pascal-reverse-proxy.db
```

This keeps both databases in a stable local user data directory:

- MCP/editor scenes: `C:/Users/lytec/.pascal/data/pascal.db`
- Reverse proxy metadata/covers: `C:/Users/lytec/.pascal/data/pascal-reverse-proxy.db`

## Notes

- `.env.local` is ignored by Git and must be recreated when using a fresh branch/worktree.
- Restart the reverse proxy after changing `.env.local` or `Program.cs`.
- If the proxy executable is already running, `dotnet build` may fail because `pascal-reverse-proxy.exe` is locked. Stop the process on port `8000`, rebuild, then restart.
- This change does not affect the Pascal scene database itself. It only changes where the proxy stores its own writable metadata.
