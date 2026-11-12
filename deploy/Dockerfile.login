# The sign-in helper's image (docs/subscriptions.md, "The sign-in helper"): the official Claude Code and Codex CLIs and
# the GitHub CLI at exact versions, each published at least 14 days before it was pinned, for one login in a throwaway
# container. The server builds it on first use (MWC_LOGIN_HELPER=docker, the development default) from this file
# alone, with no build context, and tags it mwc-login:<the first 12 hex digits of this file's SHA-256>, so any change
# here builds a new image. A sign-in runs it with no mounts, no capabilities, a read-only root, a tmpfs home and the
# non-root `node` user (apps/server/src/platform/processes/login-helper/docker.ts); `script` (util-linux, in the base
# image) gives the AI CLIs the terminal they need.
#
#   claude-code 2.1.308 (published 2026-10-22), codex 0.163.0 (published 2026-10-15); pinned 2026-11-05.
#   gh 2.103.3 (published 2026-10-26), GitHub's release tarball checked against its SHA-256; pinned 2026-11-12.

FROM node:24.21.0-slim
# The system CA roots: Codex verifies TLS against them (the slim image has none).
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install --global --no-fund --no-audit --no-update-notifier \
      @anthropic-ai/claude-code@2.1.308 @openai/codex@0.163.0 \
 && npm cache clean --force \
 && command -v script timeout claude codex
# The GitHub CLI for Sign in with GitHub (its device sign-in): the release for this machine's architecture, downloaded
# with Node (the slim image has no curl), checked against the SHA-256 GitHub published for it, unpacked to
# /usr/local/bin.
RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in \
      amd64) sum=4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d ;; \
      arm64) sum=ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63 ;; \
      *) echo "no GitHub CLI release for $arch" >&2; exit 1 ;; \
    esac \
 && node -e 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); require("node:fs").writeFileSync("/tmp/gh.tar.gz", Buffer.from(await r.arrayBuffer())); })' \
      "https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_linux_${arch}.tar.gz" \
 && echo "$sum  /tmp/gh.tar.gz" | sha256sum --check --strict \
 && tar -xzf /tmp/gh.tar.gz --strip-components=2 -C /usr/local/bin "gh_2.103.3_linux_${arch}/bin/gh" \
 && rm /tmp/gh.tar.gz \
 && gh --version
ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    NO_UPDATE_NOTIFIER=1 \
    GH_PROMPT_DISABLED=1 \
    GH_NO_UPDATE_NOTIFIER=1 \
    GH_TELEMETRY=false \
    GH_SPINNER_DISABLED=1 \
    TERM=xterm-256color
USER node
WORKDIR /home/node
