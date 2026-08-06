# `@pascal-app/cli`

Install, run, and manage a persistent local installation of the open-source Pascal
Editor without cloning its repository. Node.js 22.13 or newer is required.

```bash
npx @pascal-app/cli editor
```

pnpm and Bun package runners can launch the same executable. npm must remain available
because `pascal update` uses it to resolve published releases:

```bash
pnpm dlx @pascal-app/cli editor
bunx @pascal-app/cli editor
```

The first run copies the bundled editor into `~/.pascal/runtime/<version>`, starts it on
loopback, waits for its health endpoint, and opens `http://pascal.localhost:<port>`.
Projects remain in `~/.pascal/data/pascal.db` when the CLI or editor is updated.
Passing `--port` only affects a new process; an already healthy editor is reused at its
existing URL.

Install globally if you prefer the shorter command:

```bash
npm install --global @pascal-app/cli
pascal editor
```

```bash
pascal status
pascal logs --follow
pascal restart
pascal stop
# Guarded recovery when the recorded editor is alive but unhealthy:
pascal stop --force
pascal doctor
pascal info --json
pascal project list
pascal plugin list
```

Updates health-check a candidate runtime and restore the previous runtime if activation
fails. Installed versions are retained to support rollback, so `pascal doctor` warns when
more than three versions have accumulated. A later `pascal editor` run replaces a damaged
copy of its bundled runtime without touching project data. Detached logs rotate at 10 MiB.

Use `pascal editor --foreground --no-open` for attached logs and debugging. The initial
release supports macOS. It does not install a startup service, bind beyond loopback, or
install plugin code from GitHub or npm. Linux and Windows support is not verified yet.

See the full [CLI guide](https://editor.pascal.app/docs/developers/local-editor) for
commands, updates, storage paths, security behavior, current platform coverage, and
troubleshooting. Plugin publishers can use the separate
[plugin authoring guide](https://editor.pascal.app/docs/developers/plugins) for the
manifest, node, panel, host-integration, privacy, and testing contracts.
