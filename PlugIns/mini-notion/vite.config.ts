import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Audit the transitive static graph, not just the entry file: chunking must not
 * silently pull optional editors and catalogs back into the cold-start path. */
function startupGraph(): Plugin {
  return {
    name: 'mini-notion-startup-graph',
    generateBundle(_, bundle) {
      const initial = new Set<string>();
      const visit = (name: string) => {
        if (initial.has(name)) return;
        const chunk = bundle[name];
        if (!chunk || chunk.type !== 'chunk') return;
        initial.add(name);
        chunk.imports.forEach(visit);
      };
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName);
      const modules = [...initial].flatMap(name => {
        const chunk = bundle[name];
        return chunk.type === 'chunk' ? Object.keys(chunk.modules) : [];
      });
      const optional = ['components/Editor.tsx', 'components/AgentPanel.tsx', 'components/Pickers.tsx', 'components/SymbolIcon.tsx'];
      const eagerOptionalModules = optional.filter(name => modules.some(id => id.replaceAll('\\', '/').endsWith('/' + name)));
      const report = {
        initialJavaScriptBytes: [...initial].reduce((sum, name) => {
          const chunk = bundle[name];
          return sum + (chunk.type === 'chunk' ? Buffer.byteLength(chunk.code) : 0);
        }, 0),
        initialChunks: [...initial].sort(),
        initialModuleCount: modules.length,
        eagerOptionalModules,
        deferredSurfaces: optional.filter(name => !eagerOptionalModules.includes(name)),
      };
      this.emitFile({ type: 'asset', fileName: 'startup-report.json', source: JSON.stringify(report, null, 2) + '\n' });
      if (eagerOptionalModules.length) this.error(`Optional UI leaked into startup: ${eagerOptionalModules.join(', ')}`);
    },
  };
}
export default defineConfig({
  plugins: [react(), startupGraph()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1800, manifest: true },
});
