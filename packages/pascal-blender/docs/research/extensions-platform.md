# Blender Extensions Platform pipeline (2025–2026) — practical guide for pascal-blender

Researched 2026-08-02/03 against live docs. All claims cite the source URL. Where behavior was
unclear from docs, it was verified against the extensions-website Django source
(https://projects.blender.org/infrastructure/extensions-website).

Context: `pascal_blender` is already Extensions-format (`pascal_blender/blender_manifest.toml`,
schema 1.0.0, `blender_version_min = "4.2.0"`, MIT, `[permissions] network + files`), and already
checks `bpy.app.online_access` (`pascal_blender/preferences.py:34`).

---

## TL;DR verdict for pascal-blender

extensions.blender.org has **two policy blockers** for us:

1. **License**: "For add-ons, the required license is GNU General Public License v3.0 or later"
   (https://docs.blender.org/manual/en/latest/advanced/extensions/licenses.html). ToS (1): add-ons
   "must be wholly compliant with the GNU General Public License, version 3 or later"
   (https://extensions.blender.org/terms-of-service/). MIT-only listings exist but are rare
   outliers (5 of 991 in the v1 API listing; e.g. `livery_helper`); the common pattern is
   dual-licensing, e.g. the `vrm` add-on ships `["SPDX:MIT", "SPDX:GPL-3.0-or-later"]`.
2. **ToS (4.3) "mixed product" rule**: extensions connecting to services outside blender.org
   "should offer access to these sites without additional restrictions (such as login or
   registration)... If the offering is a mixed product (for example with optional commercial
   extras), it will not be accepted." Pascal scenes/assets live behind the Pascal product; that is
   exactly the case moderators reject. Their own canned response for this says: *"If you can't (or
   don't want) to change your extension to adapt to it, you can self-host it without this
   restriction"* (https://developer.blender.org/docs/features/extensions/moderation/canned_responses/).

**So: self-hosted third-party repository is the sanctioned primary channel for us.** Everything
Blender's update UI offers (listing, one-click drag install, update notifications) works with a
static `index.json` on GitHub Pages/Releases. Official listing remains possible later if we
dual-license and make asset access account-free.

---

## 1. extensions.blender.org submission

Docs: https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html
ToS: https://extensions.blender.org/terms-of-service/ (last updated 18 Dec 2024)
About/how-to-publish: https://extensions.blender.org/about/
Moderation queue: **https://extensions.blender.org/approval-queue/** (public; anyone can test and
comment to speed reviews; ~1855 entries listed as of 2026-08, most in "awaiting changes").

### Submission flow
1. `blender --command extension build` → zip; `blender --command extension validate <zip>`.
2. Test via Preferences → Get Extensions → Install from Disk (moderators explicitly check this).
3. Upload the zip at extensions.blender.org (requires Blender ID). Extension starts as **Draft**,
   goes to **Awaiting Review**, is published when a moderator sets **Approved**
   (status machine in `extensions-website/constants/base.py`).

### Manifest requirements (schema 1.0.0)
Required: `schema_version`, `id`, `version` (**semantic versioning enforced**), `name`, `tagline`
(**≤64 chars, must not end with punctuation**), `maintainer`, `type`, `license` (SPDX list),
`blender_version_min` (≥4.2.0).
Optional: `website`, `copyright` ("Year Name" / "Year-Year Name"), `tags`
(only from https://docs.blender.org/manual/en/latest/advanced/extensions/tags.html),
`platforms`, `wheels`, `[permissions]`, `blender_version_max`, `[build]` paths/excludes.
Rules: no empty values — omit unused optional keys entirely; `[build.generated]` is reserved.
Permissions: only `files`, `network`, `clipboard`, `camera`, `microphone`; each value is the
**reason string, single short sentence, ≤64 chars, no trailing period** — our current two reasons
comply.

Our manifest gotchas:
- `name = "Pascal Scene Importer"` is fine; ToS (2.1) forbids "Blender" in the extension **name**.
  Our `id = "pascal_blender"` contains "blender" — ids like `blender_magicavoxel` are live on the
  platform, so tolerated, but the site slug/module name would carry it forever.
- `license = ["SPDX:MIT"]` → would need `["SPDX:MIT", "SPDX:GPL-3.0-or-later"]` (or plain GPL) for
  the platform. Assets *bundled inside* the add-on must be CC0 (licenses page).

### No-network-by-default rules
- ToS (4.1): network permission must be declared with a clear reason (we do).
- ToS (4.2): must respect `bpy.app.online_access` and only connect when enabled (we do;
  `preferences.py:34`). For better errors also check `bpy.app.online_access_override`
  (https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html#internet-access).
- ToS (4.4): buttons that just open a browser (docs, report-a-bug) need **no** permission if
  labeled clearly.
- ToS (4.5): never send data anywhere without explicit user action.
- Moderators grep submissions for `requests`/`urllib` imports and `http` literals and verify every
  call path checks `online_access` (moderation guidelines, below).

### Review turnaround
No SLA. Moderator statements on devtalk (thread "Extensions Platform",
https://devtalk.blender.org/t/extensions-platform/34663, Dec 2024): *"The usual time it takes to
approve them is surprisingly fast. We are talking about days"* — but items sit for a month+ when a
policy question is unresolved. After a decline you resubmit and set the state back to
**Awaiting Review** (there's a dedicated action; just commenting doesn't re-queue you). Reviewers
expect you to actually address the written points before re-flagging
(example: https://devtalk.blender.org/t/45368).

### Common rejection reasons (from the official moderation docs)
Guidelines: https://developer.blender.org/docs/features/extensions/moderation/guidelines/
Canned responses: https://developer.blender.org/docs/features/extensions/moderation/canned_responses/
- Add-on simply broken / never tested via Install from Disk after conversion to extension.
- Wrong/missing permissions (`files` expected for any I/O add-on).
- **Bundled self-updater — hard no** ("updating... is handled by Blender directly now").
- pip dependencies not bundled as wheels/vendorized; `sys.path` manipulation via `__file__`.
- Network use without `bpy.app.online_access` checks.
- Not self-contained: "should not depend on external servers (localhost is fine)"; must not
  require external functional components (ToS 5.1/5.2) — the rule that pushes us to self-host.
- Writing into the add-on directory instead of `bpy.utils.extension_path_user(__package__, ...)`.
- `__name__` instead of `__package__` for preferences; hardcoded `bl_ext`/repo module names.
- `__pycache__`/byte-code in the zip (use `extension build`, never hand-zip).
- Backslash path separators; hardcoded data-block names (`bpy.data.worlds["World"]`);
  `threading` (crash-prone — use `multiprocessing`/`subprocess`); insecure `eval`/`exec`.
- Listing-page issues: heavy GIFs, unclear description ("no surprises" ToS 3.1), ads in UI
  (ToS 6.1), Blender logo in images (ToS 2.2).

### How updates work after approval
Verified in extensions-website source (`extensions/models.py`):
- `Version.add_file()`: *"auto approving our file if extension is already listed (i.e. have been
  approved)"* → **new versions of an approved extension go live immediately, no human re-review**;
  an "Uploaded New Version" activity is logged for moderators (post-hoc oversight), plus an
  automatic clamav scan and wheel validation (`files/tasks.py`).
- CI/CD upload API (https://developer.blender.org/docs/features/extensions/ci_cd/):
  ```
  curl -X POST https://extensions.blender.org/api/v1/extensions/$EXTENSION/versions/upload/ \
    -H "Authorization:bearer $TOKEN" -F "version_file=@$ZIP" -F "release_notes=$NOTES"
  ```
  Tokens come from your profile page on the platform.

---

## 2. Third-party (self-hosted) remote repositories

Docs: https://docs.blender.org/manual/en/latest/advanced/extensions/creating_repository/static_repository.html
(linked from "Third party extension sites" on the getting-started page).

### Generating the index
```
blender --command extension server-generate --repo-dir=/path/to/zips [--html]
```
Scans all extension `.zip`s in the dir and writes `index.json` (`{"version":"v1","blocklist":[],
"data":[{...manifest fields..., "archive_url", "archive_size", "archive_hash":"sha256:..."}]}`).
`--html` additionally emits a ready-made `index.html` listing page whose links can be dragged into
Blender. `archive_url` is relative by default; when zips are hosted elsewhere (GitHub Releases),
rewrite it to the absolute asset URL (both real-world examples below do exactly this).

### How users add it
Preferences → Get Extensions → Repositories → `[+]` → **Add Remote Repository** → paste the URL of
`index.json` (https, or `file:///` for local testing). Per-repository options: **Check for Updates
on Startup** and an optional **Access Token** (sent as auth — works for private hosts)
(https://docs.blender.org/manual/en/latest/editors/preferences/extensions.html).

### How auto-update works
Same mechanism as the official repo: "The current available version of an extension on the
repository will always be considered the latest version." Updates are user-triggered ("Check for
Updates" / "Update All"), or Blender checks at launch and shows a status-bar notification if the
repo has "Check for Updates on Startup" enabled. There is no silent auto-install. So on our side,
shipping an update = publish new zip + regenerate/redeploy `index.json`. Nothing else.

### Real examples (patterns to copy)

**A. hlorus/CAD_Sketcher → separate Pages repo, two channels**
- Workflow: https://github.com/hlorus/CAD_Sketcher/blob/main/.github/workflows/release.yaml
- Tag push `v*` → check tag==manifest version → `moguri/setup-blender@v1` → `extension validate`
  → `extension build` → zip attached to GitHub Release → download all non-prerelease zips →
  `server-generate --repo-dir zips` → python step rewrites each `archive_url` to
  `https://github.com/hlorus/CAD_Sketcher/releases/download/<tag>/<zip>` → commits `stable/index.json`
  into a **separate repo** `hlorus/CAD_Sketcher-extensions` served by GitHub Pages
  (branch main, path /, `.nojekyll`).
- User-facing repo URL: `https://hlorus.github.io/CAD_Sketcher-extensions/stable/index.json`
  (verified live; entries carry sha256 + Releases archive_url). A `latest/` rolling channel is
  rebuilt on every push to main via a mutable "latest" prerelease.

**B. st-tech/ppf-contact-solver → index.json as a GitHub Release asset (no Pages at all)**
- Workflow: https://github.com/st-tech/ppf-contact-solver/blob/main/.github/workflows/release-extension.yml
- Downloads pinned Blender tarball from download.blender.org → stages source with `git archive` →
  fetches wheels from PyPI into `./wheels/` → `extension build` + `validate` →
  `server-generate --repo-dir packages --html` → rewrites `archive_url` to an **immutable dated
  release** asset → uploads `index.json` (with `--clobber`) to a **fixed mutable release tag**
  `addon-latest`, giving a permanent repo URL:
  `https://github.com/st-tech/ppf-contact-solver/releases/download/addon-latest/index.json`.

**C. Others**: Dragorn421/DragEx (`.github/workflows/extension-repositories.yml`) publishes
`ext_repo/latest/` + `ext_repo/nightly/` indexes to GitHub Pages from release assets;
Fxnarji/blender-extensions-hosting-template is a minimal template (checkout →
`bradyajohnston/setup-blender` → `server-generate --repo-dir=./` → commit `index.json` to main).

Recommended for us: pattern A/B hybrid — zips on pascal-blender GitHub Releases (immutable),
`index.json` on GitHub Pages of the same repo (e.g. `https://pascalorg.github.io/pascal-blender/extensions/index.json`),
regenerated by the release workflow. `dist/` already exists for build output.

---

## 3. Drag-and-drop / one-click install URLs

**There is no `blender://` protocol.** The mechanism is a dragged (or dropped) URL that ends in
`.zip`, with optional URL-encoded query params that Blender parses on drop
(static_repository.html → "Download Links"):

```
{URL}.zip?repository={index.json URL, relative ok}&blender_version_min={X.Y.Z}&blender_version_max={excl}&platforms={p1,p2}
```

- Only strict requirement: **download URL must end in `.zip`** (before the query string).
- `repository=` is the magic part: when present, Blender offers to **add the remote repository**,
  so the user gets future updates — this is how "one-click install + subscribe to updates" works.
- extensions.blender.org's Get button is exactly this: a `draggable` element with
  `data-install-url="https://extensions.blender.org/download/sha256:.../add-on-...zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=...&platforms=..."`.
- **Yes, third-party repos can offer identical links.** Official example given in the manual:
  `http://my-site.com/my-addon.zip?repository=.%2Findex.json&blender_version_min=4.2.0&platforms=windows-x64`.
  `server-generate --html` produces such a page for free.
- Users can also drag a plain `.zip` link or file into Blender (installs to a Local Repository,
  **no updates**) — so the `repository=` param is what we must not forget on the website/README.

For pascal-blender the install link would be (single universal zip, no `platforms` param needed):
```
https://github.com/pascalorg/pascal-blender/releases/download/v0.2.0/pascal_blender-0.2.0.zip?repository=https%3A%2F%2Fpascalorg.github.io%2Fpascal-blender%2Fextensions%2Findex.json&blender_version_min=4.2.0
```

## 4. Constraints to respect (both channels)

**Wheels** (https://docs.blender.org/manual/en/latest/advanced/extensions/python_wheels.html):
extensions must be self-contained; any pip dep ships as unmodified PyPI wheels under `./wheels/`,
listed in the manifest with forward slashes, including transitive deps; per-platform binary wheels
for every platform in `platforms`; `extension build --split-platforms` to keep zips small.
(pascal_blender currently has no third-party deps → nothing to do, but this is the rule the moment
we add one; the platform's scanner actively validates wheels.)

**Online access**: keep every socket behind `bpy.app.online_access` (done at
`preferences.py:34`); use `bpy.app.online_access_override` to distinguish "user can flip the pref"
from "forced offline via `--offline-mode`". Never phone home; asset downloads must remain
user-initiated (our import operator qualifies).

**Permissions**: declare only what's used, with ≤64-char reasons (current manifest OK). If we ever
touch clipboard/camera/mic, declare it.

**Storage**: cache must go to `bpy.utils.extension_path_user(__package__, path="cache",
create=True)` — the add-on dir may be read-only ("System" repos) and is wiped on upgrade
(https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html#local-storage).

**Packaging hygiene**: always ship the `extension build` output (excludes `__pycache__`, `.git`,
`*.zip` by default); semantic version; never rely on module name — `__package__` everywhere.

---

## Sources
- https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html
- https://docs.blender.org/manual/en/latest/advanced/extensions/licenses.html
- https://docs.blender.org/manual/en/latest/advanced/extensions/python_wheels.html
- https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html
- https://docs.blender.org/manual/en/latest/advanced/extensions/creating_repository/static_repository.html
- https://docs.blender.org/manual/en/latest/editors/preferences/extensions.html
- https://extensions.blender.org/terms-of-service/ · /about/ · /approval-queue/
- https://developer.blender.org/docs/features/extensions/moderation/guidelines/ · /canned_responses/ · /ci_cd/
- https://projects.blender.org/infrastructure/extensions-website (models: version auto-approval)
- https://devtalk.blender.org/t/extensions-platform/34663 (review turnaround, moderator answers)
- Live examples: hlorus/CAD_Sketcher(-extensions), st-tech/ppf-contact-solver, Dragorn421/DragEx,
  Fxnarji/blender-extensions-hosting-template
