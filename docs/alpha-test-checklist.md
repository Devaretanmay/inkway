# Inkway alpha: second-Mac checklist

Use an Apple Silicon Mac running macOS 26 or later. Install from the [official GitHub Release](https://github.com/Devaretanmay/inkway/releases), following [Install Inkway on macOS](install-macos.md). No developer tools are required for installation. A coding provider may require its own tool installation or sign-in.

Record the Inkway version, macOS version, Mac model, and provider/model used. Do not include credentials or private project contents in reports.

- [ ] Download succeeds.
- [ ] Optional: downloaded checksum matches `SHA256SUMS`.
- [ ] DMG opens and Inkway copies to Applications.
- [ ] First-launch Gatekeeper instructions are understandable; Open Anyway works when needed.
- [ ] Inkway opens without an Inkway account, signup, or login.
- [ ] A provider connects.
- [ ] An agent can be created.
- [ ] An issue can be created and assigned to that agent in a disposable project.
- [ ] A real run completes and its requested file/change exists.
- [ ] Review shows the change; Accept completes successfully.
- [ ] A second, longer run can be stopped; the tool stops working afterward.
- [ ] Quit and relaunch preserves the agent, issue, and accepted result.

Report the first failing step, exact error text, and a screenshot if helpful. A clean-machine result supplements the automated release proof; it must not be reported as passed before someone performs it.
