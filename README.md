# Kyrie

Kyrie is a multi-agent coding setup for the Pi CLI.

## How it works (30 seconds)

You talk to `kyrie`.
`kyrie` delegates work to specialist agents (`scout`, `planner`, `builder`, `reviewer`, etc.).
Those specialists do the actual codebase work and report back through `kyrie`.

## What this is

- User-level Pi configuration stored in `~/.pi`
- A tuned main agent (`kyrie`) plus specialist agents in `agent/agents/`
- Custom extensions in `agent/extensions/` for workflow, safety, and quality-of-life features

## Prerequisites

- Base Pi coding agent installed and working on your machine
- macOS/Linux shell access (examples use `bash`/`zsh`)
- At least one model provider API key

## 1) Install the base Pi coding agent

Kyrie builds on top of the Pi coding agent:

- Repo: `https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent`

Install globally:

```bash
npm install -g @mariozechner/pi-coding-agent
```

## 2) Install Kyrie config

If you are starting from scratch:

```bash
git clone https://github.com/ktappdev/.pi.git ~/.pi
```

If you already have a `~/.pi`, back it up first:

```bash
mv ~/.pi ~/.pi.backup.$(date +%Y%m%d-%H%M%S)
git clone https://github.com/ktappdev/.pi.git ~/.pi
```

## 3) Install extension dependencies

Kyrie extensions live in `~/.pi/agent/extensions` and use local npm packages.

```bash
cd ~/.pi/agent/extensions
npm install
```

## 4) Set environment variables

Add these to your shell profile (`~/.zshrc` or `~/.bashrc`), then restart your terminal.

Example (`~/.zshrc`):

```bash
# Kyrie / Pi keys
export QWEN_API_KEY="your_qwen_api_key"
export TAVILY_API_KEY="your_tavily_api_key"
```

Then apply changes in the current shell:

```bash
source ~/.zshrc
```

### Required (default setup)

```bash
export QWEN_API_KEY="your_qwen_api_key"
```

Kyrie defaults to the `QwenCodingPlan` provider (`agent/settings.json`).

### Highly recommended

```bash
export TAVILY_API_KEY="your_tavily_api_key"
```

Tavily powers external web research for docs, APIs, and current info.

### Optional provider keys

Set these only if you plan to use the corresponding providers in `agent/models.json`:

```bash
export BYTEDANCE_API_KEY="your_bytedance_key"
export INCEPTION_API_KEY="your_inception_key"
export DEEPSEEK_API_KEY="your_deepseek_key"
export QWEN_CLI_API_KEY="your_qwen_cli_key"
```

## 5) Start Pi (command is `pi`)

Run the CLI with `pi` (not `kyrie`).

Then work normally, for example:

```text
Refactor this service and run tests.
```

## Agent map (quick view)

- `kyrie`: main orchestrator
- `scout`: codebase discovery
- `planner`: implementation planning
- `builder`: coding changes
- `reviewer`: final verification
- `designer`: UI/UX specs
- `devops`: GitHub/GH CLI operations and Beads task triage
- `tavily`: external web research
- `sparky`: brainstorming
- `documenter`: docs writing

## Verify your setup

Quick checks:

- `echo $QWEN_API_KEY` returns a value
- `echo $TAVILY_API_KEY` returns a value (if using web research)
- Pi starts without provider/auth errors
- Kyrie can dispatch specialists in a normal coding task

## Security notes

- Never commit secrets to git (`agent/auth.json`, API keys, tokens)
- Keep credentials in environment variables or Pi login storage
- Rotate keys immediately if they are exposed

## Customize later

- Default provider/model: `agent/settings.json`
- Provider definitions and API key env names: `agent/models.json`
- Agent behavior prompts: `agent/agents/*.md`
- Team groupings: `agent/agents/teams.yaml`
