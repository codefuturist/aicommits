# AI Commits — VS Code Extension

Generate git commit messages using AI directly from VS Code's Source Control panel. Works standalone — no CLI required.

## Features

- **✨ One-Click Generate** — Button in the SCM title bar generates a commit message instantly
- **Keyboard Shortcuts** — `Cmd+K Cmd+G` to generate, `Cmd+K Cmd+C` to generate & commit
- **Multiple Formats** — Plain, Conventional Commits, or Gitmoji
- **Multi-Suggestion** — Generate up to 5 options and pick the best one
- **Shared Config** — Automatically reads your `~/.config/aicommits/config` (CLI config)
- **Secure** — API keys stored in your OS keychain via VS Code's SecretStorage
- **Any Provider** — OpenAI, GitHub Copilot, Anthropic, Ollama, or any OpenAI-compatible API

---

## Installation

### From VSIX

```bash
code --install-extension aicommits-1.0.0.vsix
# or for Cursor:
cursor --install-extension aicommits-1.0.0.vsix
```

### From Source

```bash
cd vscode-extension
pnpm install
pnpm run package          # builds aicommits-1.0.0.vsix
code --install-extension aicommits-1.0.0.vsix
```

---

## Setup

**First time only** — configure your AI provider:

1. Open the Command Palette: `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Linux/Windows)
2. Run **`AI Commits: Setup Provider`**
3. Enter your **API key** (stored securely in your OS keychain)
4. Enter the **base URL** (leave default for OpenAI, or change for other providers)
5. Enter the **model name**

### Provider Examples

| Provider | Base URL | Model |
|----------|----------|-------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| GitHub Copilot | `https://models.github.ai/inference` | `openai/gpt-4.1` |
| Anthropic (via proxy) | `https://api.anthropic.com/v1` | `claude-sonnet-4-5` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

> **Already using the CLI?** The extension automatically reads `~/.config/aicommits/config` — no setup needed if you've already run `aicommits setup`.

---

## How to Use

### 1. Stage your changes

Use the **Source Control panel** (`Cmd+Shift+G`) to stage the files you want to commit — same as always.

### 2. Generate a commit message

**Option A — Click the button:**
Click the **✨ sparkle icon** in the Source Control panel title bar.

**Option B — Keyboard shortcut:**
Press `Cmd+K Cmd+G` (macOS) / `Ctrl+K Ctrl+G` (Linux/Windows).

**Option C — Command Palette:**
`Cmd+Shift+P` → `AI Commits: Generate Commit Message`

### 3. Review and commit

The generated message appears in the commit input box. Edit it if needed, then press `Cmd+Enter` to commit as normal.

### Generate multiple suggestions

Set `aicommits.generateCount` to `2`–`5` in Settings. A picker will appear letting you choose the best option.

### Generate & commit in one step

Press `Cmd+K Cmd+C` (macOS) / `Ctrl+K Ctrl+C` (Linux/Windows), or run **`AI Commits: Generate & Commit`** — generates and commits immediately without a preview step.

### Switch commit format mid-session

Use the Command Palette to force a specific format for the next commit:
- **`AI Commits: Generate Conventional Commit`** — forces `feat:`, `fix:`, `chore:`, etc.
- **`AI Commits: Generate Gitmoji Commit`** — forces emoji prefix (🐛, ✨, 🔧, etc.)

### Change model quickly

Click the **model name in the status bar** (bottom-left) or run **`AI Commits: Select Model`** to switch models on the fly.

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Generate Commit Message** | `Cmd+K Cmd+G` | Generate and populate the SCM input box |
| **Generate & Commit** | `Cmd+K Cmd+C` | Generate and auto-commit without preview |
| **Generate Conventional Commit** | — | Force `feat:` / `fix:` / `chore:` format |
| **Generate Gitmoji Commit** | — | Force emoji prefix format |
| **Regenerate Message** | — | Generate a fresh message |
| **Setup Provider** | — | Configure API key, base URL, and model |
| **Select Model** | — | Quick model switch via input box |

---

## Settings

All settings are **optional** — the extension reads from `~/.config/aicommits/config` by default, so if you're already using the CLI you have nothing to configure.

Open Settings (`Cmd+,`) and search for **"AI Commits"** to see all options.

| Setting | Default | Description |
|---------|---------|-------------|
| `aicommits.apiKey` | — | API key (prefer **Setup** command — stored in keychain, not settings.json) |
| `aicommits.baseUrl` | — | API base URL (e.g. `https://models.github.ai/inference`) |
| `aicommits.model` | — | Model name (e.g. `gpt-4o-mini`, `openai/gpt-4.1`) |
| `aicommits.commitType` | — | Default format: `plain` / `conventional` / `gitmoji` |
| `aicommits.locale` | — | Commit message language (`en`, `de`, `fr`, `ja`, ...) |
| `aicommits.maxLength` | `72` | Max commit message character length |
| `aicommits.generateCount` | `1` | Suggestions to generate (1–5); >1 shows a picker |
| `aicommits.customPrompt` | — | Extra instructions appended to the AI prompt |
| `aicommits.autoCommit` | `false` | Skip preview — commit immediately after generating |

### Config Precedence

Settings are merged in this order (higher overrides lower):

1. **VS Code Settings** (`settings.json`)
2. **`$AICOMMITS_CONFIG`** environment variable
3. **`~/.config/aicommits/config`** (shared with the CLI)
4. **`~/.aicommits`** (legacy fallback)

---

## Development

```bash
cd vscode-extension
pnpm install
pnpm run watch          # TypeScript watch mode (auto-recompile on save)
```

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.

### Packaging & Publishing

```bash
pnpm run package        # Creates aicommits-1.0.0.vsix
pnpm run compile        # TypeScript compile only
pnpm run lint           # Type-check (no emit)
```

---

## License

MIT
