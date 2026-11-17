import type { Page } from './types.ts';

const indexedPages = new WeakMap<Page[], Map<string, Page>>();

/** Workspace updates replace the pages array, so each immutable snapshot shares one index. */
export function pageIndex(pages: Page[]): Map<string, Page> {
  let index = indexedPages.get(pages);
  if (!index) {
    index = new Map(pages.map((page) => [page.id, page]));
    indexedPages.set(pages, index);
  }
  return index;
}
