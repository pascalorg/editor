# Releasing `@pascal-app/*` to npm

Eight packages ship from this repository: `core`, `geometry-script`, `viewer`, `editor`, `nodes`, `mcp`, `ifc-converter`, `cli`. They publish in that order — each one depends on the ones before it — and **every package carries the same version**. A release bumps all eight together from the highest version in the tree, so a package that ran ahead (the cli-only 1.0.2 hotfix) pulls the others up to it on the next run, and every `@pascal-app/*` range in their manifests is rewritten to that one version. There is no per-package release.

The pipeline is [`.github/workflows/release.yml`](../.github/workflows/release.yml) (`workflow_dispatch`, inputs `bump` and `dry-run`; `bun run release`, `release:beta`, `release:minor` and `release:major` dispatch it). A stable bump on a prerelease graduates it to the base version, so `1.0.0-beta.5` + `bump=major` becomes `1.0.0`. `bump=none` republishes the current version: packages already on npm at it are skipped, missing ones are published, and only tags that do not exist yet are created, which is how a partial run is recovered. A dry run validates the builds but never touches the registry, so it cannot tell you whether authentication works.

## Authentication is the hard part

npm has deprecated 2FA-bypass granular tokens, so `NPM_TOKEN` in CI fails with `EOTP` no matter how fresh it is. The workflow therefore authenticates with GitHub OIDC (`id-token: write`, `environment: npm`, no `registry-url` on `actions/setup-node` — that flag writes a placeholder `_authToken` and the registry answers `E404` on the PUT). OIDC only works once **each package** has a trusted publisher on npmjs.com: organization `pascalorg`, repository `editor`, workflow `release.yml`, environment `npm`. Without that entry the publish ends in `ENEEDAUTH`, and with `NPM_CONFIG_LOGLEVEL: verbose` the registry says the package was not found for the exchange.

The publishing account is `two-factor auth: auth-and-writes`, so a local publish needs a browser approval per package. 1.0.0 shipped that way.

## Pushing the release commit

The `main` ruleset requires pull requests and the `quality` check, with a bypass only for repository admins and the release deploy key. `GITHUB_TOKEN` is neither, so the workflow checks out with `secrets.RELEASE_DEPLOY_KEY` (environment `npm`) and the commit-and-tags push goes over SSH with that key. Release #67 (2026-10-13) published every package and then died on that push with `GH013: Repository rule violations`; a rerun with the same bump recovers it, since published versions are skipped. Rotating the key: `ssh-keygen -t ed25519 -N "" -f release-deploy-key`, add the public half as a deploy key with write access, keep it in the ruleset's bypass list, store the private half in the `npm` environment as `RELEASE_DEPLOY_KEY`.

## Adding a package

Trusted publishing cannot create a package: the token exchange answers `package not found` for a name that has never been published, exactly as it does for a missing trusted publisher. So a package added to `PACKAGES` in the workflow needs, once, by a maintainer:

1. `cd packages/<pkg> && bun run build && npm publish --access public --tag latest --ignore-scripts` at the version currently in its `package.json` (build its workspace dependencies first).
2. On npmjs.com, the package's settings → Trusted publisher → GitHub Actions: organization `pascalorg`, repository `editor`, workflow `release.yml`, environment `npm`.

The workflow checks that every package exists on npm before it builds anything, so a forgotten first publish fails the run at the start rather than after some packages are already on the registry. Releases #65 (`nodes`, missing trusted publisher) and #66 (`geometry-script`, never published) both died that way mid-run; `bump=none` or the next bump recovers them because already-published versions are skipped.

## Publishing by hand

Do this from a fresh clone of `pascalorg/editor`, never from a working tree you develop in or one checked out as a submodule of another repository.

1. Bump the eight `package.json` versions to the same number and their internal `@pascal-app/*` ranges to it, refresh `bun.lock`, and build everything, including the CLI's portable runtime (`build/pascal-web-runtime-<version>.tar.gz` plus its `.sha256`, and `dist/runtime-source.json`, which records the release-asset URL and digest).
2. Check each tarball with `npm pack --dry-run --ignore-scripts --json`. `@pascal-app/editor` ships sources and has no `dist/`; every other package must show its `dist/` files.
3. Publish each package with `npm publish --access public --tag latest --ignore-scripts` in dependency order. `--ignore-scripts` matters: the CLI's `prepublishOnly` would rebuild the whole standalone runtime.
4. npm needs a terminal for the one-time-password flow. Without a pty it prints the approval URL and exits immediately, and its own log redacts the identifier, so the URL is unrecoverable. Run the publish under a pty, scrape `https://www.npmjs.com/auth/cli/<id>` from the output, and open it for the maintainer to approve.
5. **Exit code 0 means published**, even though `npm view` still returns the previous version. npm prints `+ @pascal-app/<pkg>@<version>` and warns that processing takes a few minutes. Retrying on the stale version check stages a second tarball and the registry then answers `E409 Cannot publish over previously staged version`, which locks that version for several minutes. Wait and poll instead.
6. Rebase the version bumps onto current `origin/main` (main moves while you publish), commit `release: @pascal-app/<pkg>@<version> …`, tag all eight `@pascal-app/<pkg>@<version>`, and `git push --atomic origin HEAD:main <tags>`.
7. Create the CLI runtime release: `gh release create "@pascal-app/cli@<version>"` and upload the archive and its `.sha256`. The published npm tarball points at that exact URL, so verify it resolves and that the digest matches before announcing.
8. Publish the repo-level release: `gh release edit v<version> --target <full release SHA> --notes-file … --draft=false --latest`. A shortened SHA is rejected with `422 target_commitish is invalid`.

## The container

The same `release.yml` run publishes `ghcr.io/pascalorg/pascal-editor` after the npm packages: one native build per architecture (amd64 and arm64 runners, a Next build under QEMU takes most of an hour), stitched into one manifest tagged `<version>` and `latest` (or `beta`). The Dockerfile stages the runtime exactly like `stage-runtime` does for the CLI asset, so a release's container and its CLI runtime are the same files. `docker.yml` builds and smoke-tests the image on PRs that touch what shapes it; a tag that failed the container job can be re-published by hand with `docker buildx build --platform linux/amd64,linux/arm64 --push -t ghcr.io/pascalorg/pascal-editor:<version> .` from the tagged commit.

## After a release

- A repository that pins this one as a git submodule bumps the pin to the release commit and runs `bun install`: its root lockfile records the workspace versions, so it changes with the pin.
- Plugins that declare `@pascal-app/*` peer ranges must widen them when a release leaves the range; `bun install` reports unmet peers until they do.
- The release commit already carries the Cursor plugin's `--package=@pascal-app/cli@<version>` pin and the [`server.json`](../server.json) version: the workflow runs `bun scripts/sync-agent-versions.ts` after the bump, and `bun run skills:validate` fails when either drifts from `packages/*/package.json`. A beta leaves both on the last stable release, so marketplace installs never pin a prerelease. A manual release runs the same script before committing.

## MCP Registry

[`server.json`](../server.json) publishes as `app.pascal/editor` with the `@pascal-app/mcp` npm package and the hosted remote. Nothing publishes it automatically. After a release lands on `main`:

1. The registry checks npm ownership by reading `mcpName` from the published `@pascal-app/mcp@<version>`, so publish only versions whose npm tarball carries `"mcpName": "app.pascal/editor"`.
2. Deploy the hosted editor at the same version, then run the **MCP Registry** workflow by hand (`gh workflow run mcp-registry.yml`). Its `hosted-matches-manifest` job checks that the live API catalog and `/.well-known/mcp/server-card.json` report this version and registry name.
3. Authenticate for the `app.pascal` namespace once per session: `mcp-publisher login dns --domain pascal.app --private-key <hex Ed25519 key>`, which needs the `pascal.app` TXT record `v=MCPv1; k=ed25519; p=<public key>`. HTTP verification (`mcp-publisher login http`, serving `https://pascal.app/.well-known/mcp-registry-auth`) is the alternative.
4. From the repository root, `mcp-publisher publish`, then confirm with `curl "https://registry.modelcontextprotocol.io/v0/servers?search=app.pascal/editor"`.

GitHub release notes follow the house style: emoji sections, every line linked to its PR, a 📦 package table, individual contributor attributions, and the compare link last. Verify the table against npm before publishing — an earlier release claimed versions that were never published.
