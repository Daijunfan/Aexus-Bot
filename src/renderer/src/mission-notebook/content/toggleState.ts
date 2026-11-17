import type {createToggleWrapper} from '@blocknote/core/blocks';

// Expansion is UI state only. Opaque-origin hosts deny Storage; document data
// continues through the same authorized Core APIs in either case.
const transient = new Map<string, boolean>();
export const toggleState: NonNullable<Parameters<typeof createToggleWrapper>[3]> = {
  get(block) {
    try { return window.localStorage.getItem(`toggle-${block.id}`) === 'true'; }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
      return transient.get(block.id) ?? false;
    }
  },
  set(block, expanded) {
    try { window.localStorage.setItem(`toggle-${block.id}`, String(expanded)); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
      transient.set(block.id, expanded);
    }
  },
};
