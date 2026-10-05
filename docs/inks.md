# Inks

Inks are verified local decisions learned from agent work. A decision must be checked against real outcomes before Inkway can serve it locally; repeated observations alone are not enough.

- **Learning** collects decision and outcome evidence.
- **Shadow** evaluates a candidate without controlling the decision.
- **Active** allows a qualified decision to be served locally, with fallback when it no longer matches reality.

The Inks page shows lifecycle, observations, verified outcomes, local serves, coverage, runtime, and maintenance. These are real runtime measurements. Inks reduce remote decision calls only for qualified decisions; they do not cache general agent output or guarantee that a coding task will succeed.

Inks are powered by Ink's Decision JIT. Ink is the underlying decision technology, not a separate product the user needs to operate.
