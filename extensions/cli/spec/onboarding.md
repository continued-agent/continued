# Onboarding

When a user first runs `cn` in interactive mode, they are taken through
onboarding. After onboarding is complete, normal config loading is used.

## Onboarding flow

1. If `--config` is provided, load that file and do not modify the default
   configuration.
2. If `CONTINUE_USE_BEDROCK=1` is set, use a protected temporary Bedrock config
   and skip interactive prompts. The saved configuration is not replaced.
3. If a valid local `~/.continue/config.yaml` already contains an explicit
   chat-capable model, keep it and skip the provider picker.
4. Otherwise, present the provider picker. The selected provider's API key is
   stored in `~/.continue/.env` with restrictive permissions, while
   `config.yaml` contains only a `${{ secrets.VARIABLE_NAME }}` reference.

The provider picker includes OpenAI, Anthropic, Google Gemini, Meta Llama, xAI,
Mistral, DeepSeek, OpenRouter, Perplexity, LiteLLM, OpenCode Zen, Azure, AWS
Bedrock, NVIDIA, Hugging Face, and a generic OpenAI-compatible endpoint.

When onboarding is performed automatically, the CLI displays a confirmation,
for example: `✓ Using AWS Bedrock (CONTINUE_USE_BEDROCK detected)`.

### AWS Bedrock environment variable

`CONTINUE_USE_BEDROCK=1` requires credentials from the standard AWS credential
chain (AWS environment variables, an AWS profile, or an attached IAM role). The
region is read from `AWS_REGION`, then `AWS_DEFAULT_REGION`, and otherwise
defaults to `us-east-1`; `AWS_PROFILE` is also respected.

```bash
export CONTINUE_USE_BEDROCK=1
cn -p "Review the current changes"
```

This override applies to the current process only and does not mark or rewrite
the user's saved configuration.

## Normal flow

1. If `--config` is provided, load that file.
2. If a local `config.yaml` exists, load it.
3. If no usable local config exists and `ANTHROPIC_API_KEY` is present, create a
   local config that references that environment variable.
4. If none of the above applies, use the normal provider picker in an
   interactive terminal or return without prompting in headless mode.
