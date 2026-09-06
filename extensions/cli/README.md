# Continue CLI

The Continue CLI (`cn`) is a customizable command line coding agent.

![Continue CLI Demo](./media/demo.gif)

## Installation

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/continued-agent/continued/main/extensions/cli/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/continued-agent/continued/main/extensions/cli/scripts/install.ps1 | iex
```

Or install with npm if you have Node.js 20.20.1 or newer:

```bash
npm i -g @continuedev/cli
```

The curl and PowerShell installers download the latest prebuilt artifact from
this fork’s `cli-latest` GitHub release, verify its SHA-256 checksum, and
install it globally without compiling the monorepo on your machine. The npm
command installs the published package, which may not contain the fork changes.
To use a different release asset, set `CONTINUE_CLI_RELEASE_URL` before running
the installer. The checksum downloaded beside the asset protects against
transfer corruption; use an immutable asset URL if the mutable `cli-latest`
tag is not an acceptable trust boundary.

## Usage

```bash
cn
```

### First-run provider setup

On the first interactive launch, `cn` shows a scrollable provider picker instead
of requiring Anthropic. It includes OpenAI, Anthropic, Google Gemini, Meta Llama,
xAI, Mistral, DeepSeek, OpenRouter, Perplexity, LiteLLM, OpenCode Zen, Azure,
AWS Bedrock, NVIDIA, Hugging Face, and a generic OpenAI-compatible endpoint.

After you choose a provider, `cn` asks for its API key with masked input and
writes a model entry to `~/.continue/config.yaml` with `chat`, `edit`, and
`apply` roles. The key itself is stored in `~/.continue/.env` with restrictive
permissions and the YAML references it as `${{ secrets.VARIABLE_NAME }}`. You
can use an exported environment variable instead; do not commit `.env` files.
Existing valid configurations are kept and do not trigger the picker again.

Set `CONTINUE_USE_BEDROCK=1` for a one-shot Bedrock override. It uses the AWS
credential chain and respects `AWS_REGION`, `AWS_DEFAULT_REGION`, and
`AWS_PROFILE` without replacing the saved configuration.

### Startup artwork

The interactive startup screen displays a compact, color-gradient Continue mark
that fits comfortably in a standard 80-column terminal. On narrower terminals,
it falls back to the version number to avoid wrapping the artwork.

### TUI spacing

Interactive messages and tool output use a small, consistent horizontal inset
so bullets, responses, and wrapped text remain readable near the terminal edge.

### Headless Mode

Headless mode (`-p` flag) runs without an interactive terminal UI, making it perfect for:

- Scripts and automation
- CI/CD pipelines
- Docker containers
- VSCode/IntelliJ extension integration
- Environments without a TTY

```bash
# Basic usage
cn -p "Generate a conventional commit name for the current git changes."

# With piped input
echo "Review this code" | cn -p

# JSON output for scripting
cn -p "Analyze the code" --format json

# Silent mode (strips thinking tags)
cn -p "Write a README" --silent
```

**TTY-less Environments**: Headless mode is designed to work in environments without a terminal (TTY), such as when called from VSCode/IntelliJ extensions using terminal commands. The CLI will not attempt to read stdin or initialize the interactive UI when running in headless mode with a supplied prompt.

### ACP Agent Mode

`cn acp` runs Continue as an [Agent Client Protocol (ACP)](https://agentclientprotocol.com/)
Agent. An external editor or application acts as the ACP Client and sends
`session/new`, `session/prompt`, and `session/cancel` messages over stdin. The
transport is stdio with newline-delimited JSON (NDJSON): stdout contains only
ACP messages, while diagnostics are sent to stderr.

```json
{
  "agent_servers": {
    "Continued": {
      "command": "cn",
      "args": ["acp", "--config", "/path/to/config.yaml"]
    }
  }
}
```

ACP is distinct from MCP: ACP connects an external client to Continue, while
MCP connects Continue to tools and data sources. Continue currently accepts an
empty `mcpServers` list from ACP clients; configured Continue MCP servers can
still be supplied with the existing `--mcp` option. Remote network access is
not exposed by `cn acp`; use a runner, SSH, or an authenticated gateway.

ACP sessions require an existing absolute `cwd`. Each session has isolated
history, and turns are serialized because some Continue services are currently
process-wide singletons. `additionalDirectories` and client-provided MCP
servers are rejected explicitly until they can be supported without weakening
workspace and permission controls. Tool policies (`--allow`, `--ask`,
`--exclude`, `--readonly`, and `--auto`) remain active; tools in `ask` mode use
the ACP `session/request_permission` request.

### Session Management

The CLI automatically saves your chat history for each terminal session. You can resume where you left off:

```bash
# Resume the last session in this terminal
cn --resume

# List recent sessions and choose one to resume
cn ls

# List sessions in JSON format (for scripting)
cn ls --json
```

## Command Line Options

- `-p`: Run in headless mode (no TUI)
- `--config <path>`: Specify agent configuration path
- `--resume`: Resume the last session for this terminal
- `<prompt>`: Optional prompt to start with

## Environment Variables

- `CONTINUE_CLI_DISABLE_COMMIT_SIGNATURE`: Disable adding the Continue commit signature to generated commit messages
- `CONTINUE_USE_BEDROCK=1`: Use a one-shot AWS Bedrock configuration without replacing the saved config
- `FORCE_NO_TTY`: Force TTY-less mode, prevents stdin reading (useful for testing and automation)

## Commands

- `cn`: Start an interactive chat session
- `cn ls`: List recent sessions with TUI selector to choose one to resume
- `cn login`: Authenticate with Continue
- `cn logout`: Sign out of current session
- `cn remote`: Launch a remote instance
- `cn serve`: Start HTTP server mode
- `cn acp`: Run Continue as an ACP Agent over stdio

### Session Listing (`cn ls`)

Shows recent sessions, limited by screen height to ensure it fits on your terminal.

- `--json`: Output in JSON format for scripting (always shows 10 sessions)

## TTY-less Support

The CLI fully supports running in environments without a TTY (terminal):

```bash
# From Docker without TTY allocation
docker run --rm my-image cn -p "Generate docs"

# From CI/CD pipeline
cn -p "Review changes" --format json

# From VSCode/IntelliJ extension terminal tool
cn -p "Analyze code" --silent
```

The CLI automatically detects TTY-less environments and adjusts its behavior:

- Skips stdin reading when a prompt is supplied
- Disables interactive UI components
- Ensures clean stdout/stderr output

For more details, see [`spec/tty-less-support.md`](./spec/tty-less-support.md).
