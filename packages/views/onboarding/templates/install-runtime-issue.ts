/**
 * Shown when a new user skips connecting an execution option during setup.
 * Keep this short and point back to the main Inkway flow.
 */
export const INSTALL_RUNTIME_ISSUE_TITLE = {
  en: "Connect a tool to get started",
  zh: "连接工具以开始使用",
  ko: "도구를 연결하고 시작하기",
  ja: "ツールを接続して始める",
} as const;

const en = `Welcome to Inkway.

Connect a local tool such as Claude Code, Codex, or OpenCode in Providers. Local tools do not need an API key. You can also connect OpenAI, Anthropic, or Groq.

Then create an agent, add an issue, and assign the agent to start work.`;

const zh = `欢迎使用 Inkway。

在 Providers 中连接 Claude Code、Codex 或 OpenCode 等本地工具。本地工具无需 API 密钥。你也可以连接 OpenAI、Anthropic 或 Groq。

接着创建 Agent、新建任务并分配给 Agent，即可开始工作。`;

const ko = `Inkway에 오신 것을 환영합니다.

Providers에서 Claude Code, Codex, OpenCode 같은 로컬 도구를 연결하세요. 로컬 도구에는 API 키가 필요하지 않습니다. OpenAI, Anthropic, Groq도 연결할 수 있습니다.

그런 다음 agent를 만들고 이슈를 추가해 agent에 할당하면 작업이 시작됩니다.`;

const ja = `Inkway へようこそ。

Providers で Claude Code、Codex、OpenCode などのローカルツールを接続してください。ローカルツールに API キーは不要です。OpenAI、Anthropic、Groq も接続できます。

次に agent を作成して issue を追加し、agent に割り当てると作業が始まります。`;

export const INSTALL_RUNTIME_ISSUE_BODY = { en, zh, ko, ja } as const;
