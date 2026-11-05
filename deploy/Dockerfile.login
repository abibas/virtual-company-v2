# The sign-in helper's image (docs/subscriptions.md, "The sign-in helper"): the official Claude Code and Codex CLIs at
# exact versions, each published at least 14 days before it was pinned, for one login in a throwaway container. The
# server builds it on first use (MWC_LOGIN_HELPER=docker, the development default) from this file alone, with no build
# context, and tags it mwc-login:<the first 12 hex digits of this file's SHA-256>, so any change here builds a new
# image. A sign-in runs it with no mounts, no capabilities, a read-only root, a tmpfs home and the non-root `node`
# user (apps/server/src/platform/login-helper/docker.ts); `script` (util-linux, in the base image) gives the CLIs
# the terminal they need.
#
#   claude-code 2.1.308 (published 2026-10-22), codex 0.163.0 (published 2026-10-15); pinned 2026-11-05.

FROM node:24.21.0-slim
# The system CA roots: Codex verifies TLS against them (the slim image has none).
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install --global --no-fund --no-audit --no-update-notifier \
      @anthropic-ai/claude-code@2.1.308 @openai/codex@0.163.0 \
 && npm cache clean --force \
 && command -v script timeout claude codex
ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    NO_UPDATE_NOTIFIER=1 \
    TERM=xterm-256color
USER node
WORKDIR /home/node
