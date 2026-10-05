# Security model

## Provider credentials

Provider secrets are relayed to the selected authenticated runtime and stored in that runtime's operating-system secure credential store. The renderer receives connection status, not the saved secret. Inkway stores provider metadata but not API keys. Never put provider keys in issue text, logs, fixtures, or checked-in environment files.

## Native API tools

Native agent file operations are scoped to the selected repository and enforce path containment, including symlink resolution. Commands run on the selected runtime with bounded execution time and captured output. Review the runtime's local trust boundary before assigning work in an untrusted repository; command tools execute real programs on that machine.

## Network and failure handling

Provider requests use HTTPS by default, bounded timeouts, and provider-specific endpoints. Redirects must not forward authorization credentials to another origin. User-facing errors should be actionable and redact credentials and provider response bodies; detailed diagnostics belong behind an explicit disclosure.

Inks are powered by Ink's optional Decision JIT. When local Ink serving is unavailable, agents use the normal execution path; a decision-service failure does not delete an issue or its history.
