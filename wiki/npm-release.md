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

[`server.json`](../server.json) publishes as `app.pascal/editor` with the `@pascal-app/mcp` npm package and the hosted remote. Its version is never edited by hand: `bun scripts/sync-agent-versions.ts` rewrites it from `packages/mcp/package.json`.

A `release.yml` run whose released `@pascal-app/mcp` version is stable (no `-`) ends with the `mcp-registry` job, which calls [`mcp-registry.yml`](../.github/workflows/mcp-registry.yml) with that version. A beta, or a `bump=none` rerun of one, skips it: server.json stays on the last stable version. The job passes `MCP_REGISTRY_PRIVATE_KEY` through the called workflow's declared `workflow_call.secrets`, which GitHub requires even though the secret is set only on the `mcp-registry` environment.

The version must be a stable `X.Y.Z`, checked before anything is checked out. `validate` checks out the `@pascal-app/mcp@<version>` tag, resolves it to its commit and reports that commit. `publish` checks out that exact commit, not the tag, and fails if the tag no longer points at it. Before logging in it repeats the full check: `server.json` must be `app.pascal/editor` at the version, with exactly one package entry (`npm`, `https://registry.npmjs.org`, `@pascal-app/mcp` at the version, `npx`, `stdio`) and exactly the remote `https://editor.pascal.app/api/mcp`, and `packages/mcp/package.json` must be `@pascal-app/mcp` at the version with that `mcpName`. It then waits until `npm view --registry https://registry.npmjs.org @pascal-app/mcp@<version> mcpName`, run outside the checkout, reports `app.pascal/editor` (the registry verifies npm ownership through that field). It publishes, deletes the registry token (`~/.config/mcp-publisher/token.json`), and fails unless `https://registry.modelcontextprotocol.io/v0/servers/app.pascal%2Feditor/versions` then lists the version. A version that is already listed is skipped, so reruns are safe.

Publish runs share one concurrency group and never cancel each other. GitHub keeps one running and one waiting run per group, so a third queued run replaces the waiting one. That is accepted: the replaced run can be dispatched again, and an already listed version is skipped.

### The CI signing key

The `app.pascal` namespace is verified by DNS: a `pascal.app` TXT record `v=MCPv1; k=ed25519; p=<public key>` whose private key signs the login. `pascal.app` already carries two such records; neither is CI's. CI uses its own keypair, generated only for CI, with its own TXT record, so it can be revoked without touching anyone else's key. When the record is added, write its `p=` value here so the record CI owns is on file (the public key only):

- CI public key: _not set up yet_

The GitHub environment `mcp-registry` exists, with a deployment branch rule that allows only `main` and no required reviewer. Adding the key is a repository admin's job:

1. Generate the keypair: `openssl genpkey -algorithm Ed25519 -out ci-key.pem`. The public key for the TXT record is `openssl pkey -in ci-key.pem -pubout -outform DER | tail -c 32 | base64`, and the hex private key for the secret is `openssl pkey -in ci-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'`.
2. Add the TXT record `v=MCPv1; k=ed25519; p=<public key>` to `pascal.app`, and record the public key above.
3. Store the hex private key as the `MCP_REGISTRY_PRIVATE_KEY` secret of the `mcp-registry` environment, then delete `ci-key.pem`.

`MCP_REGISTRY_PRIVATE_KEY` lives only in the `mcp-registry` environment. It is never a repository secret or a secret of any other environment. Until it exists the `publish` job fails and says so.

### Rotating the CI key

1. Remove CI's TXT record from `pascal.app` (the one whose `p=` value is listed above).
2. Generate a new keypair and publish its TXT record, as in the setup steps above, and update the public key listed here.
3. Replace `MCP_REGISTRY_PRIVATE_KEY` in the `mcp-registry` environment with the new private key.
4. Check what the registry lists: `https://registry.modelcontextprotocol.io/v0/servers?search=app.pascal` and `https://registry.modelcontextprotocol.io/v0/servers/app.pascal%2Feditor/versions`. Every entry should match a release in this repository.
5. Mark any entry that does not with `mcp-publisher status --status deleted app.pascal/editor <version>`, logged in with a `pascal.app` key.
6. If the workflow itself is in doubt, revert the change or disable `mcp-registry.yml` in the Actions settings until it is sorted out.

### Recovering a missed version

Dispatch the workflow from `main` with the version, which is required: `gh workflow run mcp-registry.yml -f version=<version> -f publish=true`. With `check-hosted` (on by default) the `hosted-matches-manifest` job also checks that the live API catalog and `/.well-known/mcp/server-card.json` report this version; those are served by the hosted deployment, so that job only passes once it runs the same `@pascal-app/mcp`, and it does not gate the publish.

By hand, from the release tag: `mcp-publisher login dns --domain pascal.app --private-key <hex key>`, then `mcp-publisher publish`.

GitHub release notes follow the house style: emoji sections, every line linked to its PR, a 📦 package table, individual contributor attributions, and the compare link last. Verify the table against npm before publishing — an earlier release claimed versions that were never published.
