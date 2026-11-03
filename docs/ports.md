# Ports

Everything v2 listens on lives in 9950–9999 so it never collides with v1 (3200, 8766, 54329), the AI gateway (8300), the Paperclip lab (3100), Playwright MCP (8931) or the Airia stacks. The constants are in `packages/shared/src/ports.ts`; `pnpm mwc ports` prints them.

## 3. Port map (9950–9999)

| Port      | Use                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 9950      | API server (WS for runners, SSE for the UI; serves the built UI in prod)                                                                     |
| 9951      | Web dev server (Vite, proxies `/api`)                                                                                                        |
| 9952      | Postgres (dev compose)                                                                                                                       |
| 9953      | Local runner health (`/healthz`)                                                                                                             |
| 9954      | ngrok inspect UI (webhook tunnel forwards to 9950; dev only)                                                                                 |
| 9955      | Web preview for e2e                                                                                                                          |
| 9956      | Drizzle Studio                                                                                                                               |
| 9957–9959 | spare                                                                                                                                        |
| 9960–9989 | Worktree triplets, slot k = 0..9: API `9960+3k`, web `9961+3k`, PG `9962+3k` (`MWC_PORT_SLOT`, or derived from the worktree path and probed) |
| 9990–9992 | Compose "prod-like" stack (server, web static, PG)                                                                                           |
| 9993–9999 | spare / Playwright reports                                                                                                                   |


## Worktree slots

An ephemeral instance (a task worktree, an e2e run) takes slot k in 0..9: API `9960+3k`, web `9961+3k`, Postgres `9962+3k`. Pick a slot with `MWC_PORT_SLOT=k`, or let `pnpm mwc ports --path <worktree>` derive a stable one from the path (FNV-1a hash mod 10); if that slot is busy, take the next free one.
