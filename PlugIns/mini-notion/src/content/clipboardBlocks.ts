import type { JsonBlock } from '../types';

/** True for a complete BlockNote document selection (Cmd+A).
 * Normal inline and list selections use open clipboard slices. */
export function isFullDocumentClipboard(html: string): boolean {
  if (!html) return false;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const root = body.firstElementChild;
  return !!root && root.getAttribute('data-node-type') === 'blockGroup' &&
    /^0 0(?:\s|$)/.test(root.getAttribute('data-pm-slice') || '');
}

/** Pasting a whole document into an empty paragraph used to make that blank
 * paragraph the parent of every pasted block. Repeating it added one invisible
 * parent per paste, rendered as vertical indentation guides. Strip only chains
 * of contentless paragraph parents; preserve meaningful list/toggle/column
 * nesting and non-empty parent blocks. */
export function unwrapEmptyPasteParents(blocks: JsonBlock[]): JsonBlock[] {
  let result = blocks;
  while (
    result.length === 1 &&
    result[0].type === 'paragraph' &&
    (result[0].content === '' || (Array.isArray(result[0].content) && result[0].content.length === 0)) &&
    result[0].children?.length
  ) result = result[0].children!;
  return result;
}

export function isEmptyRootParagraph(block: JsonBlock): boolean {
  return block.type === 'paragraph' &&
    (block.content === '' || (Array.isArray(block.content) && block.content.length === 0)) &&
    (!block.children || block.children.length === 0);
}
