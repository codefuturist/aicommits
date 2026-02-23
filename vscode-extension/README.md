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

## Quick Start

1. Install the extension
2. Run `AI Commits: Setup` from the Command Palette (`Cmd+Shift+P`)
3. Enter your API key, base URL, and model
4. Stage some files and click the **✨** button in the Source Control panel

### GitHub Copilot Users

Set the base URL to `https://models.github.ai/inference` and use your Copilot token (`gho_...`) as the API key.

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Generate Commit Message** | `Cmd+K Cmd+G` | Generate and populate the SCM input box |
| **Generate & Commit** | `Cmd+K Cmd+C` | Generate and auto-commit |
| **Generate Conventional Commit** | — | Force conventional format |
| **Generate Gitmoji Commit** | — | Force gitmoji format |
| **Regenerate Message** | — | Generate a new message |
| **Setup Provider** | — | Configure API key, URL, model |
| **Select Model** | — | Quick model switch |

## Settings

All settings are optional — the extension reads from `~/.config/aicommits/config` by default.

| Setting | Default | Description |
|---------|---------|-------------|
| `aicommits.apiKey` | — | API key (prefer Setup command for secure storage) |
| `aicommits.baseUrl` | — | API base URL |
| `aicommits.model` | — | Model name |
| `aicommits.commitType` | — | plain / conventional / gitmoji |
| `aicommits.locale` | — | Message language (en, de, fr...) |
| `aicommits.maxLength` | 72 | Max commit message length |
| `aicommits.generateCount` | 1 | Number of suggestions (1-5) |
| `aicommits.customPrompt` | — | Extra instructions for the AI |
| `aicommits.autoCommit` | false | Auto-commit after generation |

## Config Precedence

1. **VS Code Settings** (highest priority)
2. **`$AICOMMITS_CONFIG`** environment variable
3. **`~/.config/aicommits/config`** (shared with CLI)
4. **`~/.aicommits`** (legacy fallback)

## Development

```bash
pnpm install
pnpm run watch    # TypeScript watch mode
# Press F5 in VS Code to launch Extension Development Host
```

### Packaging

```bash
pnpm run package  # Creates .vsix file
```

## License

MIT
