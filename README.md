# Inkway

Inkway is a simple workbench for coding agents:

```text
Connect a provider or coding tool
→ Create an agent
→ Create an issue
→ Assign the agent
→ Run
→ Review the result
```

Local tools such as Claude Code, Codex, and OpenCode use their own sign-in and do not need an API key. OpenAI, Anthropic, and Groq can be connected for Native API agents. Provider credentials stay on the selected runtime in its operating-system credential store.

Ink is built into Inkway. Inks are verified local decisions learned by the Ink engine; they serve only after the evidence supports a local decision.

## Develop Inkway

Requirements: macOS or Linux, Docker with Compose, Go (version in `server/go.mod`), Node.js 22+, and pnpm 10.28.2.

```sh
make setup
make dev
```

`make setup` installs workspace dependencies, prepares the environment, starts the managed PostgreSQL service, and applies migrations. `make dev` starts the API, daemon, and web application. Start the desktop app with `pnpm dev:desktop`.

Run Go integration tests with `make test`; frontend checks are `pnpm lint`, `pnpm typecheck`, and `pnpm test`. `make check` runs the combined repository checks.

## Product docs

- [Getting started](docs/getting-started.md)
- [Providers](docs/providers.md)
- [Agents](docs/agents.md)
- [FastPaths](docs/fastpaths.md)
- [Security](docs/security.md)

## Source and compatibility

This source repository retains historical package names, database identifiers, CLI/config paths, and protocol aliases where changing them could break existing installations. These are internal compatibility identifiers; the product is Inkway. The upstream project history and notices remain intact.
