<div align="center">
  <div>
    <img src=".github/screenshot.png" alt="AI Commits"/>
    <h1 align="center">AI Commits</h1>
  </div>
  <p>A CLI that writes your git commit messages for you with AI. Never write a commit message again.</p>
  <a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/v/aicommits" alt="Current version"></a>
  <a href="https://www.npmjs.com/package/aicommits"><img src="https://img.shields.io/npm/dt/aicommits" alt="Downloads"></a>
</div>

---

## Setup

> The minimum supported version of Node.js is v20. Check your Node.js version with `node --version`.

1. Install _aicommits_:

   ```sh
   npm install -g aicommits
   ```

2. Run the setup command to choose your AI provider:

   ```sh
   aicommits setup
   ```

This will guide you through:

- Selecting your AI provider (sets the `provider` config)
- Configuring your API key
- **Automatically fetching and selecting from available models** (when supported)

  Supported providers include:

  - **TogetherAI** (recommended) - Get your API key from [TogetherAI](https://api.together.ai/)
  - **OpenAI** - Get your API key from [OpenAI API Keys page](https://platform.openai.com/account/api-keys)
  - **Ollama** (local) - Run AI models locally with [Ollama](https://ollama.ai)
  - **Custom OpenAI-compatible endpoint** - Use any service that implements the OpenAI API

  Alternatively, you can use environment variables (recommended for CI/CD):

  ```bash
  export OPENAI_API_KEY="your_api_key_here"
  export OPENAI_BASE_URL="your_api_endpoint"  # Optional, for custom endpoints
  export OPENAI_MODEL="your_model_choice"     # Optional, defaults to provider default
  ```

  > **Note:** When using environment variables, ensure all related variables (e.g., `OPENAI_API_KEY` and `OPENAI_BASE_URL`) are set consistently to avoid configuration mismatches with the config file.

  This will create a `.aicommits` file in your home directory.

### Upgrading

Check the installed version with:

```

aicommits --version

```

If it's not the [latest version](https://github.com/Nutlope/aicommits/releases/latest), run:

```sh
npm update -g aicommits
```

## Usage

### CLI mode

You can call `aicommits` directly to generate a commit message for your staged changes:

```sh
git add <files...>
aicommits
```

`aicommits` passes down unknown flags to `git commit`, so you can pass in [`commit` flags](https://git-scm.com/docs/git-commit).

For example, you can stage all changes in tracked files with as you commit:

```sh
aicommits --all # or -a
```

> 👉 **Tip:** Use the `aic` alias if `aicommits` is too long for you.

#### CLI Options

- `--generate` or `-g`: Number of messages to generate (default: **1**)
- `--exclude` or `-x`: Files to exclude from AI analysis
- `--all` or `-a`: Automatically stage changes in tracked files for the commit (default: **false**)
- `--type` or `-t`: Git commit message format (default: **conventional**). Supports `conventional` and `gitmoji`
- `--confirm` or `-y`: Skip confirmation when committing after message generation (default: **false**)
- `--clipboard` or `-c`: Copy the selected message to the clipboard instead of committing (default: **false**)

#### Generate multiple recommendations

Sometimes the recommended commit message isn't the best so you want it to generate a few to pick from. You can generate multiple commit messages at once by passing in the `--generate <i>` flag, where 'i' is the number of generated messages:

```sh
aicommits --generate <i> # or -g <i>
```

> Warning: this uses more tokens, meaning it costs more.

#### Generating Conventional Commits

If you'd like to generate [Conventional Commits](https://conventionalcommits.org/), you can use the `--type` flag followed by `conventional`. This will prompt `aicommits` to format the commit message according to the Conventional Commits specification:

```sh
aicommits --type conventional # or -t conventional
```

This feature can be useful if your project follows the Conventional Commits standard or if you're using tools that rely on this commit format.

### Git hook

You can also integrate _aicommits_ with Git via the [`prepare-commit-msg`](https://git-scm.com/docs/githooks#_prepare_commit_msg) hook. This lets you use Git like you normally would, and edit the commit message before committing.

#### Install

In the Git repository you want to install the hook in:

```sh
aicommits hook install
```

#### Uninstall

In the Git repository you want to uninstall the hook from:

```sh
aicommits hook uninstall
```

#### Usage

1. Stage your files and commit:

   ```sh
   git add <files...>
   git commit # Only generates a message when it's not passed in
   ```

   > If you ever want to write your own message instead of generating one, you can simply pass one in: `git commit -m "My message"`

2. Aicommits will generate the commit message for you and pass it back to Git. Git will open it with the [configured editor](https://docs.github.com/en/get-started/getting-started-with-git/associating-text-editors-with-git) for you to review/edit it.

3. Save and close the editor to commit!

### Environment Variables

You can also configure aicommits using environment variables instead of the config file.

**Example:**

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.example.com"
export OPENAI_MODEL="gpt-4"
aicommits  # Uses environment variables
```

Configuration settings are resolved in the following order of precedence:

1. Command-line arguments
2. Environment variables
3. Configuration file
4. Default values

## Configuration

### Viewing current configuration

To view all current configuration options that differ from defaults, run:

```sh
aicommits config
```

This will display only non-default configuration values with API keys masked for security. If no custom configuration is set, it will show "(using all default values)".

### Changing your model

To interactively select or change your AI model, run:

```sh
aicommits model
```

This will:

- Show your current provider and model
- Fetch available models from your provider's API
- Let you select from available models or enter a custom model name
- Update your configuration automatically

### Reading a configuration value

To retrieve a configuration option, use the command:

```sh
aicommits config get <key>
```

For example, to retrieve the API key, you can use:

```sh
aicommits config get OPENAI_API_KEY
```

You can also retrieve multiple configuration options at once by separating them with spaces:

```sh
aicommits config get OPENAI_API_KEY generate
```

### Setting a configuration value

To set a configuration option, use the command:

```sh
aicommits config set <key>=<value>
```

For example, to set the API key, you can use:

```sh
aicommits config set OPENAI_API_KEY=<your-api-key>
```

You can also set multiple configuration options at once by separating them with spaces, like

```sh
aicommits config set OPENAI_API_KEY=<your-api-key> generate=3 locale=en
```

### Config Options

#### OPENAI_API_KEY

Your OpenAI API key or custom provider API Key

#### OPENAI_BASE_URL

Custom OpenAI-compatible API endpoint URL.

#### OPENAI_MODEL

Model to use for OpenAI-compatible providers.

#### provider

The selected AI provider. Set automatically during `aicommits setup`. Valid values: `openai`, `togetherai`, `ollama`, `custom`.

#### locale

Default: `en`

The locale to use for the generated commit messages. Consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes.

#### generate

Default: `1`

The number of commit messages to generate to pick from.

Note, this will use more tokens as it generates more results.

#### timeout

The timeout for network requests to the OpenAI API in milliseconds.

Default: `10000` (10 seconds)

```sh
aicommits config set timeout=20000 # 20s
```

#### max-length

The maximum character length of the generated commit message.

Default: `72`

```sh
aicommits config set max-length=100
```

#### type

Default: `""` (Empty string)

The type of commit message to generate. Set this to "conventional" to generate commit messages that follow the Conventional Commits specification:

```sh
aicommits config set type=conventional
```

You can clear this option by setting it to an empty string:

```sh
aicommits config set type=
```

## How it works

This CLI tool runs `git diff` to grab all your latest code changes, sends them to the configured AI provider (TogetherAI by default), then returns the AI generated commit message.

Video coming soon where I rebuild it from scratch to show you how to easily build your own CLI tools powered by AI.

## Maintainers

- **Hassan El Mghari**: [@Nutlope](https://github.com/Nutlope) [<img src="https://img.shields.io/twitter/follow/nutlope?style=flat&label=nutlope&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/nutlope)

- **Hiroki Osame**: [@privatenumber](https://github.com/privatenumber) [<img src="https://img.shields.io/twitter/follow/privatenumbr?style=flat&label=privatenumbr&logo=twitter&color=0bf&logoColor=fff" align="center">](https://twitter.com/privatenumbr)

## Contributing

If you want to help fix a bug or implement a feature in [Issues](https://github.com/Nutlope/aicommits/issues), checkout the [Contribution Guide](CONTRIBUTING.md) to learn how to setup and test the project
