import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function patchFile(path: string, patches: Array<[RegExp, string]>) {
  try {
    let content = fs.readFileSync(path, "utf8");
    let patched = content;
    for (const [regex, replacement] of patches) {
      patched = patched.replace(regex, replacement);
    }
    if (content !== patched) {
      fs.writeFileSync(path, patched);
    }
  } catch {
    // File might not exist or be readable — skip silently
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const base = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist";
    const home = homedir();

    // Patch core model selector: show friendly names instead of IDs
    patchFile(`${base}/modes/interactive/components/model-selector.js`, [
      [/const modelText = `\$\{item\.id\}`;/g, "const modelText = `${item.model.name || item.id}`;"],
      [/const modelText = `  \$\{item\.id\}`;/g, "const modelText = `  ${item.model.name || item.id}`;"],
    ]);

    // Patch core footer: show friendly name instead of ID
    patchFile(`${base}/modes/interactive/components/footer.js`, [
      [/const modelName = state\.model\?\.id \|\| "no-model";/g, 'const modelName = state.model?.name || state.model?.id || "no-model";'],
    ]);

    // Patch pi --list-models: show provider-prefixed friendly names with IDs
    patchFile(`${base}/cli/list-models.js`, [
      [/model: m\.id,/g, "model: (m.name && m.name !== m.id) ? `${m.provider}: ${m.name} (${m.id})` : `${m.provider}: ${m.id}`,"],
    ]);

    // Patch custom footer extension in both .pi/agent and .pi/piii
    patchFile(join(home, ".pi", "agent", "extensions", "custom-footer.ts"), [
      [/const model = ctx\.model\?\.id \|\| "no-model";/g, 'const model = ctx.model?.name || ctx.model?.id || "no-model";'],
    ]);
    patchFile(join(home, ".pi", "piii", "extensions", "custom-footer.ts"), [
      [/const model = ctx\.model\?\.id \|\| "no-model";/g, 'const model = ctx.model?.name || ctx.model?.id || "no-model";'],
    ]);
  });
}
