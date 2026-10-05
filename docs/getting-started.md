# Getting started

Inkway helps you give coding work to an AI agent and review what it did.

## Your first issue

1. **Connect** a local coding tool such as Claude Code, Codex, or OpenCode, or connect an API provider. Local tools use their own sign-in; an API key is optional.
2. **Create an agent.** Give it a name, choose its tool or provider, and add instructions if needed.
3. **Create an issue.** Add a title, describe the work, and choose the repository.
4. **Assign the agent.** Start the work from the issue.
5. **Follow progress** on the issue.
6. **Review the result.** Check the summary, changed files, and tests, then accept or reopen it.

## Development checkout

Use macOS or Linux with Docker Compose, Go matching `server/go.mod`, Node.js 22 or newer, and pnpm 10.28.2. Run `make setup`, then `make dev`. Start the desktop app with `pnpm dev:desktop`.

`make test` runs the Go integration tests against a disposable database. Frontend checks are `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
