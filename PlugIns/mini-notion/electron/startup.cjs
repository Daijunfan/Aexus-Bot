const fs = require('node:fs');
const path = require('node:path');

/** A loading hint only: the backend still verifies and supplies all editable
 * content. Never parse the full legacy notebook just to choose a UI chunk. */
function startupContent(directory) {
  try {
    const manifestFile = path.join(directory, 'workspace-manifest.json');
    if (fs.statSync(manifestFile).size > 2 * 1024 * 1024) return;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.format !== 'mininotion.snapshot/v2' || !Array.isArray(manifest.pages)) return;
    const id = manifest.workspace?.activePageId;
    if (id === null) return 'home';
    if (typeof id !== 'string') return;
    const entry = manifest.pages.find(page => page.id === id);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.hash)) return;
    const file = path.join(directory, 'cache', 'pages', entry.hash + '.json');
    if (fs.statSync(file).size > 4 * 1024 * 1024) return;
    const page = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (page.id !== id || page.trashedAt) return;
    if (page.sourceFile && page.sourceFile.kind !== 'directory') return 'file';
    return page.database ? 'database' : 'page';
  } catch { /* A missing/stale cache must not affect authoritative loading. */ }
}
module.exports = { startupContent };
