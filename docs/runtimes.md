# Local tools

Inkway checks this computer for installed coding tools and lists tools that are ready to use. Claude Code, Codex, and OpenCode use their existing sign-in and do not need a separate API key.

If a tool is missing, install it and sign in on the computer that will run the agent, then choose **Check again** in Inkway. An unavailable local tool cannot start new work; issues and their history remain available so you can retry later.

## Technical details

Inkway runs its local execution service in the background. API provider credentials are stored in the computer's operating-system secure credential store and are not sent to or persisted by the Inkway server.

Inks are powered by Ink's Decision JIT. The supported bridge baseline is SDK 0.6.0rc1. If its optional bridge or model is unavailable, agent execution follows the normal runtime path. Missing model assets are not downloaded during an agent run; provision them explicitly with `ink model-install` before enabling local decision serving.
