# Pascal listing viewer

A small, deployable web page that shows a published [Pascal](https://editor.pascal.app) project in 3D,
straight from Pascal's public scene read API. Floors you can isolate, room names and areas on
hover, doors and windows that open on click.

It is a template: a standalone Vite, React and three.js project with no Pascal packages, meant to
be forked and restyled.

```bash
npm install
npm run dev
# open http://localhost:5173/?project=<project id>
```

The project must be public and published. Set `VITE_PASCAL_BASE_URL` to read from another Pascal
instance (see `.env.example`).

| Script | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Static site in `dist/`, ready for Vercel, Cloudflare Pages or any static host. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test:e2e` | Builds, then runs the Playwright smoke against a mocked API. |
| `npm run fixture` | Regenerates the test fixtures. |

[`AGENTS.md`](AGENTS.md) covers the API contract, what the 3D file contains, deployment,
customisation and the rules to keep (start with: never put a Pascal API key in the browser).

MIT licensed, like the rest of this repository.
