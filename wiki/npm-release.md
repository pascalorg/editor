# Releasing `@pascal-app/*` to npm

Seven packages ship from this repository: `core`, `viewer`, `editor`, `nodes`, `mcp`, `ifc-converter`, `cli`. They publish in that order — each one depends on the ones before it — and **every package carries the same version**. A release bumps all seven together from the highest version in the tree, so a package that ran ahead (the cli-only 1.0.2 hotfix) pulls the others up to it on the next run, and every `@pascal-app/*` range in their manifests is rewritten to that one version. There is no per-package release.

The pipeline is [`.github/workflows/release.yml`](../.github/workflows/release.yml) (`workflow_dispatch`, inputs `bump` and `dry-run`; `bun run release`, `release:beta`, `release:minor` and `release:major` dispatch it). A stable bump on a prerelease graduates it to the base version, so `1.0.0-beta.5` + `bump=major` becomes `1.0.0`. `bump=none` republishes the current version: packages already on npm at it are skipped, missing ones are published, and only tags that do not exist yet are created, which is how a partial run is recovered. A dry run validates the builds but never touches the registry, so it cannot tell you whether authentication works.

## Authentication is the hard part

npm has deprecated 2FA-bypass granular tokens, so `NPM_TOKEN` in CI fails with `EOTP` no matter how fresh it is. The workflow therefore authenticates with GitHub OIDC (`id-token: write`, `environment: npm`, no `registry-url` on `actions/setup-node` — that flag writes a placeholder `_authToken` and the registry answers `E404` on the PUT). OIDC only works once **each package** has a trusted publisher on npmjs.com: organization `pascalorg`, repository `editor`, workflow `release.yml`, environment `npm`. Without that entry the publish ends in `ENEEDAUTH`, and with `NPM_CONFIG_LOGLEVEL: verbose` the registry says the package was not found for the exchange.

The publishing account is `two-factor auth: auth-and-writes`, so a local publish needs a browser approval per package. 1.0.0 shipped that way.

## Publishing by hand

Do this from a fresh clone of `pascalorg/editor`, never from a working tree you develop in or one checked out as a submodule of another repository.

1. Bump the seven `package.json` versions to the same number and their internal `@pascal-app/*` ranges to it, refresh `bun.lock`, and build everything, including the CLI's portable runtime (`build/pascal-web-runtime-<version>.tar.gz` plus its `.sha256`, and `dist/runtime-source.json`, which records the release-asset URL and digest).
2. Check each tarball with `npm pack --dry-run --ignore-scripts --json`. `@pascal-app/editor` ships sources and has no `dist/`; every other package must show its `dist/` files.
3. Publish each package with `npm publish --access public --tag latest --ignore-scripts` in dependency order. `--ignore-scripts` matters: the CLI's `prepublishOnly` would rebuild the whole standalone runtime.
4. npm needs a terminal for the one-time-password flow. Without a pty it prints the approval URL and exits immediately, and its own log redacts the identifier, so the URL is unrecoverable. Run the publish under a pty, scrape `https://www.npmjs.com/auth/cli/<id>` from the output, and open it for the maintainer to approve.
5. **Exit code 0 means published**, even though `npm view` still returns the previous version. npm prints `+ @pascal-app/<pkg>@<version>` and warns that processing takes a few minutes. Retrying on the stale version check stages a second tarball and the registry then answers `E409 Cannot publish over previously staged version`, which locks that version for several minutes. Wait and poll instead.
6. Rebase the version bumps onto current `origin/main` (main moves while you publish), commit `release: @pascal-app/<pkg>@<version> …`, tag all seven `@pascal-app/<pkg>@<version>`, and `git push --atomic origin HEAD:main <tags>`.
7. Create the CLI runtime release: `gh release create "@pascal-app/cli@<version>"` and upload the archive and its `.sha256`. The published npm tarball points at that exact URL, so verify it resolves and that the digest matches before announcing.
8. Publish the repo-level release: `gh release edit v<version> --target <full release SHA> --notes-file … --draft=false --latest`. A shortened SHA is rejected with `422 target_commitish is invalid`.

## After a release

- A repository that pins this one as a git submodule bumps the pin to the release commit and runs `bun install`: its root lockfile records the workspace versions, so it changes with the pin.
- Plugins that declare `@pascal-app/*` peer ranges must widen them when a release leaves the range; `bun install` reports unmet peers until they do.
- Update anything that quotes a published CLI version, such as the `--package=@pascal-app/cli@<version>` pin in `.cursor-plugin/mcp.json` (checked by `scripts/cursor-plugin-policy.ts`). [`server.json`](../server.json) versions the hosted MCP server, not the npm packages, and does not change.

GitHub release notes follow the house style: emoji sections, every line linked to its PR, a 📦 package table, individual contributor attributions, and the compare link last. Verify the table against npm before publishing — an earlier release claimed versions that were never published.
