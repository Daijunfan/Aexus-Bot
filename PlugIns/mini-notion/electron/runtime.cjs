const fs = require('node:fs');
const path = require('node:path');

// Reuse an installed, pinned Electron from normal dependency lookup. A plugin
// checkout may share its host's runtime instead of downloading a second one.
function electronRuntime() {
  for (const base of require.resolve.paths('electron') || []) {
    const folder = path.join(base, 'electron');
    const marker = path.join(folder, 'path.txt');
    if (!fs.existsSync(marker)) continue;
    const distribution = path.join(folder, 'dist');
    const executable = path.join(distribution, fs.readFileSync(marker, 'utf8').trim());
    if (fs.existsSync(executable)) return { executable, distribution };
  }
  throw new Error('PDF export needs an installed Electron runtime. Run the host setup first.');
}
module.exports = { electronRuntime };
