<h1 align="center">Continued</h1>

<p align="center">Pioneering open-source coding agent</p>

<div align="center">

<a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" /></a>
<a href="https://docs.continue.dev"><img src="https://img.shields.io/badge/Docs-docs.continue.dev-blue" /></a>
</div>

<p align="center">
  <img src="media/github-readme.png" alt="Banner" />
</p>

## What is Continued?

Continued is a coding agent available as a [CLI](#cli), [VS Code extension](#vs-code).

## Documentation

To learn how to configure Continued, how it works, and how to customize it, check out the [Continue Docs](https://docs.continue.dev).

### VS Code

[![VS Code Marketplace](https://img.shields.io/badge/VS_Code_Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=Continue.continue) [![OpenVSX Registry](https://img.shields.io/badge/OpenVSX_Registry-C160EF?logo=eclipseide&logoColor=white)](https://open-vsx.org/extension/Continue/continue) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](extensions/vscode)

### CLI

Install the latest prebuilt CLI from this fork on macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/continued-agent/continued/main/extensions/cli/scripts/install.sh | bash
```

The CLI TUI keeps chat bullets, responses, and tool output slightly inset with
consistent horizontal spacing, including when long messages wrap.

On first launch, the CLI offers a scrollable model-provider picker and stores
credentials outside `config.yaml` using `~/.continue/.env` secret references.

The CLI startup screen uses a compact color-gradient mark designed to remain
readable in a standard terminal.

## Contributors

<a href="https://github.com/continuedev/continue/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=continuedev/continue&max=500" />
</a>

## License

Apache 2.0 © 2023-2026 Continue Dev, Inc.
