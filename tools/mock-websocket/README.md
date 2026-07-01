# Pascal Mock WebSocket 数据服务

启动：

```bash
bun run mock:ws
```

默认端口：

```txt
http://localhost:3102
ws://localhost:3102/ws
```

可覆盖端口：

```bash
MOCK_WS_PORT=3200 bun run mock:ws
```

接口：

- `GET /health`
- `GET /paths`
- `GET /snapshot`
- `WS /ws`

编辑器默认读取：

- `NEXT_PUBLIC_PASCAL_LIVE_DATA_HTTP`，默认 `http://localhost:3102`
- `NEXT_PUBLIC_PASCAL_LIVE_DATA_WS`，默认从 HTTP endpoint 推导为 `/ws`

