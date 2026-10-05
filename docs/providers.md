# Providers

Connect a local coding tool or API provider for your agents.

## Local tools

Claude Code, Codex, and OpenCode use their installed CLI and existing sign-in. They do not need an API key. The selected runtime must be online and the tool must be installed and authenticated there.

## API providers

OpenAI, Anthropic, and Groq can run Native API agents. Connect a provider on the selected runtime, test it, and replace or disconnect its credential when needed.

Credentials are sent to the selected runtime and stored in its operating-system secure credential store. Inkway stores connection metadata, never provider keys. OpenAI and Anthropic live checks are optional; their adapters have deterministic mocked HTTP coverage. Groq has separate live transport validation.

A provider rate limit or outage can stop a run without deleting the issue. Review the failure on the issue, then retry when the provider is available.
