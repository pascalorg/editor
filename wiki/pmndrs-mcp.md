# pmndrs documentation MCP

This repository includes a project-local MCP configuration for the hosted
Poimandres documentation server:

```text
https://docs.pmnd.rs/api/mcp
```

MCP-compatible clients can use `.mcp.json` to discover the server as `pmndrs`.
It is separate from Pascal's local MCP service, which remains managed by
`pascal mcp connect`.

## Available capabilities

The server exposes:

- `docs://pmndrs/manifest` — the libraries currently served by the hub
- `docs://{lib}/index` — a page index for a served library
- `get_page_content` — fetch one documentation page as Markdown
- `examples://index` — the available pmndrs examples
- `get_example` — fetch one example and its dependency versions

The most relevant libraries for this project are React Three Fiber, Drei, and
the XR package. The XR website is available at
[`pmndrs.github.io/xr`](https://pmndrs.github.io/xr/docs/getting-started/introduction);
the pmndrs MCP homepage should be checked for the current `MCP` badge before
assuming the XR library is directly queryable through the hub.

## Client setup

Clients that do not automatically load project `.mcp.json` files can use the
same server manually:

```json
{
  "mcpServers": {
    "pmndrs": {
      "type": "http",
      "url": "https://docs.pmnd.rs/api/mcp"
    }
  }
}
```

The official MCP Inspector can also be used to inspect the resources and tools:

```bash
HOST=127.0.0.1 npx -y @modelcontextprotocol/inspector
```

See the [official pmndrs agent documentation](https://pmndrs.github.io/docs/agents/introduction)
for the current protocol and served-library list.
