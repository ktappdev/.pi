# Update piii Extensions

`piii` is a shell function that uses a separate `PI_CODING_AGENT_DIR` (`~/.pi/piii/`) with its own extensions, distinct from the main `~/.pi/agent/`.

## Update Command

```bash
PI_CODING_AGENT_DIR="$HOME/.pi/piii" pi update
```

## Optional: Add Alias to ~/.zshrc

```bash
piii-update() {
  PI_CODING_AGENT_DIR="$HOME/.pi/piii" pi update "$@"
}
```

Then use:
```bash
piii-update              # Update all extensions
piii-update <source>     # Update specific extension
```

## piii Configuration

Located in `~/.pi/piii/settings.json`:
- **Packages:** pi-web-access, pi-telegram, kilo-pi-provider, pi-caveman, pi-qwen-oauth
- **Provider:** opencode-go
- **Model:** mimo-v2-pro
- **Thinking:** medium

## Shell Function (from ~/.zshrc)

```bash
piii() {
  PI_CODING_AGENT_DIR="$HOME/.pi/piii" \
  pi -np \
    --thinking medium \
    --model QwenCodingPlan/qwen3.5-plus \
    "$@"
}
```
