# The mwc MCP server for your own Claude Code

`@mwc/mcp` (`packages/mcp`, S2.6) is a small MCP server you add to your own Claude Code, so a session can ask about
your company without the web app. It talks to the API with your personal API key, the same key `mwc login` saves, and
it only reads: nothing is changed, started or sent. Later stages add the tools of the plan (send a message, read a
thread, task status, the inbox; `docs/architecture.md`, §5).

## Tools

| Tool          | Arguments                                          | Returns |
| ------------- | -------------------------------------------------- | ------- |
| `me`          | none                                               | who the key acts as: the server, your user, the key's prefix and where it came from, and the companies it reaches with your role and membership status |
| `org_chart`   | `company` (optional slug or id)                    | the chart as a readable tree (people `name · title · role`, agents `◆ name · role title · status · model/effort`, `[orphan]` for a manager off the chart), then the nodes as compact JSON (principal id, kind, manager, title, and the person's or agent's fields) |
| `agents_list` | `company` (optional), `status` (`active`, `paused`, `archived` or `all`; default active and paused) | the agents as a table (name, slug, role, status, model, effort, reports to), then compact JSON with each agent's setup, its manager's principal id and name |

Each answer is two text blocks: the readable text first, then the same as one line of JSON. A refusal (not logged in,
a key the server refuses, a company the key cannot reach, any error the server answers) comes back as an MCP tool
error carrying the message, the server's own when it refused, never as a crash of the server. The text is the one the
CLI prints: `mwc org tree` and `mwc agents list` share the API calls, the company choice and the rendering
(`@mwc/cli/api/client`, `/api/org`, `/api/session`, `/org/render`).

The company: a personal API key belongs to one company, so the tools act in it unless `company` names another; with a
login that reaches several companies and none named, the tool answers with their slugs.

## Add it to your Claude Code

This is your step; nothing in the repository changes your Claude Code configuration.

1. Make a personal API key on the web app's API keys page (`/c/<slug>/api-keys`) and save it with `mwc login`, from the
   repository root:

   ```sh
   pbpaste | pnpm mwc login --server http://localhost:9950 --company <slug>
   pnpm mwc whoami
   ```

2. Add the server (Node 24, which runs the TypeScript sources directly; no build step):

   ```sh
   claude mcp add mwc -- node /Users/abibas/PERSONAL/Most_Wanted_corp_v2/packages/mcp/src/main.ts
   ```

   `claude mcp add` adds it to the project you run it in; add `--scope user` (before `mwc`) to have it in every
   project. If `node` on Claude Code's PATH is older than 24, give the full path of Node 24 instead
   (`$HOME/.nvm/versions/node/v24.21.0/bin/node`).

3. In Claude Code, `/mcp` lists `mwc` with its three tools; ask "who am I in Most Wanted Corp?" or "show me our org
   chart".

## Where the key comes from

Read again on every tool call, so a new `mwc login` needs no restart:

1. `MWC_API_KEY` with `MWC_SERVER_URL` (or the CLI's `MWC_SERVER`), when the server's environment sets them
   (`claude mcp add mwc -e MWC_SERVER_URL=... -e MWC_API_KEY=... -- node ...`). Then the credentials file is not read
   at all. Prefer `mwc login`: a key typed into a command stays in your shell history and in Claude Code's
   configuration file.
2. `MWC_API_KEY` alone uses the server of your current `mwc login`.
3. Otherwise the saved login of `mwc login`: `~/.config/mwc/credentials.json` (0600; `MWC_CONFIG_DIR`, else
   `$XDG_CONFIG_HOME/mwc`, moves the folder), the server you logged in to last, and the company you logged in to.

The key is only ever sent to that server as `Authorization: Bearer`; answers show its prefix (`mwc_pk_AbCd...`), never
the key. `mwc logout` removes the saved login; revoke the key on the API keys page if it may have leaked.

## How it is built

- `src/main.ts`: the entry, `serveStdio({ env: process.env, fetch })`; stdout carries only the protocol.
- `src/server.ts`: `createMcpServer(deps)` registers the tools with `McpServer.registerTool` of
  `@modelcontextprotocol/sdk` 1.32.1 (zod input schemas, read-only annotations, the server's instructions);
  `serveStdio` connects it to `StdioServerTransport`.
- `src/auth.ts`: which login to use (above). `src/tools/`: one file per tool, and `result.ts` (the two-block answer,
  tool errors, the path from the login to the company).
- Tests (`packages/mcp/test/`): an SDK client connected through the SDK's in-memory transport lists the tools and calls
  each one against the real API (`createTestApp()` on PGlite, reached in-process); the stdio transport over in-memory
  streams; the environment against the credentials file with temporary config folders, never `~/.config`.
