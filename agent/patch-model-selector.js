const fs = require('fs');

function patchFile(path, patches) {
  try {
    let content = fs.readFileSync(path, 'utf8');
    let patched = content;
    for (const [regex, replacement] of patches) {
      patched = patched.replace(regex, replacement);
    }
    if (content !== patched) {
      fs.writeFileSync(path, patched);
      console.log(`Patched: ${path}`);
    }
  } catch (e) {
    console.error(`Failed: ${path} - ${e.message}`);
  }
}

const base = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components';

patchFile(`${base}/model-selector.js`, [
  [/const modelText = `\$\{item\.id\}`;/g, 'const modelText = `${item.model.name || item.id}`;'],
  [/const modelText = `  \$\{item\.id\}`;/g, 'const modelText = `  ${item.model.name || item.id}`;'],
]);

patchFile(`${base}/footer.js`, [
  [/const modelName = state\.model\?\.id \|\| "no-model";/g, 'const modelName = state.model?.name || state.model?.id || "no-model";'],
]);

console.log('Done.');
