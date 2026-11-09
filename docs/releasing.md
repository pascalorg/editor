# Releasing and distribution

Maintainer notes for publishing Pascal's npm packages, container, MCP Registry entry, and
agent plugins. Users do not need any of this to run Pascal.

## npm packages

Releases run from `.github/workflows/release.yml` (`workflow_dispatch`, with
`bump` and `dry-run` inputs). Every package shares one version: the workflow
bumps all eight, rewrites the internal `@pascal-app/*` ranges, checks that each
one already exists on npm (a package never published fails the run before
anything is built), builds, publishes in dependency order (`core` →
`geometry-script` → `viewer` → `editor` → `nodes` → `mcp` → `ifc-converter` →
`cli`), then commits the release and pushes one tag per package with the release
deploy key, which the `main` ruleset lets through. A dry run validates the builds
without touching the registry. [Releasing to npm](../wiki/npm-release.md) covers
authentication, adding a package, the deploy key, recovering a partial run,
publishing by hand and the follow-ups.

The container `ghcr.io/pascalorg/pascal-editor` is tagged with the same version as the
npm packages; `latest` follows stable releases.

## MCP Registry (`server.json`)

[`server.json`](../server.json) is Pascal's manifest for the
[official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/app.pascal%2Feditor/versions/latest),
named `app.pascal/editor`. It lists the `@pascal-app/mcp` npm package and the hosted
Streamable HTTP endpoint. Its version is the `@pascal-app/mcp` package version:
`bun scripts/sync-agent-versions.ts` rewrites it, and the Cursor plugin's CLI pin, from the
package versions, and CI fails when they drift. Each stable release publishes it to the registry
after npm has the package. The signing key is CI's own `pascal.app` DNS key, stored only as a
secret of the `mcp-registry` environment (limited to `main`), never as a repository secret; see
[wiki/npm-release.md](../wiki/npm-release.md#mcp-registry).

## Agent plugins and directories

The plugin manifests, per-host MCP configurations, and channel status are documented in
[skills/README.md](../skills/README.md). Run `bun run skills:validate` after changing any of them.

The skills require a connected Pascal MCP server for their tool-backed actions. An OpenAI
directory submission must therefore use **With MCP** and submit the production hosted MCP
endpoint together with the skills. The repository package does not prove that the endpoint,
OAuth flow, reviewer credentials, domain verification, or portal scan is ready for review.
