import { createExtension } from '@blocknote/core';
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { selectedBlocks, normalizeBlocks } from '../core/blocks';

let lastColor: { field: 'textColor' | 'backgroundColor'; color: string } | undefined;
export function rememberColor(field: 'textColor' | 'backgroundColor', color: string) {
  lastColor = { field, color };
}

export const NotionShortcuts = createExtension(({ editor }) => {
  const selected = () =>
    selectedBlocks(
      editor.document,
      (editor.getSelection()?.blocks || [editor.getTextCursorPosition().block]).map((block) => block.id),
    );
  const transform = (type: string, props = {}) => {
    if (!editor.isEditable) return false;
    const blocks = selected();
    if (blocks.some((block) => !['inline', 'plain'].includes(editor.schema.blockSchema[block.type]?.content))) return false;
    editor.transact(() => {
      for (const block of blocks) editor.updateBlock(block as any, { type, props });
    });
    return true;
  };
  return {
    key: 'notion-local-shortcuts',
    runsBefore: [
      'quote-block-shortcuts',
      'heading-shortcuts',
      'bullet-list-item-shortcuts',
      'numbered-list-item-shortcuts',
      'check-list-item-shortcuts',
      'toggle-list-item-shortcuts',
    ],
    inputRules: [{ find: /^>\s$/, replace: () => ({ type: 'toggleListItem' }) }],
    mount({ dom, signal }) {
      let selectionClick: { x: number; y: number } | undefined;
      const synchronizeSelection = () => {
        const view = editor.prosemirrorView;
        const current = view.state.selection;
        const native = dom.ownerDocument.getSelection();
        if (view.composing || !(current instanceof AllSelection || current instanceof TextSelection) || !native || !dom.contains(native.anchorNode) || !dom.contains(native.focusNode)) return;
        if (current instanceof AllSelection && !native.isCollapsed) return;
        // Native pointer and key defaults can precede selectionchange and the delayed focus callback.
        const anchor = view.state.doc.resolve(view.posAtDOM(native.anchorNode!, native.anchorOffset));
        const head = view.state.doc.resolve(view.posAtDOM(native.focusNode!, native.focusOffset));
        const selection = TextSelection.between(anchor, head);
        if (!selection.eq(current)) view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
      };
      dom.addEventListener('mousedown', event => {
        selectionClick = undefined;
        if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
        const view = editor.prosemirrorView;
        const selection = view.state.selection;
        if (!(selection instanceof AllSelection || selection instanceof TextSelection) || selection.empty) return;
        const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!point) return;
        if (point.pos > selection.from && point.pos < selection.to) {
          selectionClick = { x: event.clientX, y: event.clientY };
          return;
        }
        // Commit a new drag anchor early, while leaving drags inside selected text to the browser.
        view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(point.pos))).setMeta('addToHistory', false));
      }, { signal, capture: true });
      dom.ownerDocument.addEventListener('mousemove', event => {
        if (selectionClick && (Math.abs(event.clientX - selectionClick.x) > 4 || Math.abs(event.clientY - selectionClick.y) > 4)) selectionClick = undefined;
      }, { signal, capture: true });
      dom.ownerDocument.addEventListener('dragstart', () => { selectionClick = undefined; }, { signal, capture: true });
      dom.ownerDocument.addEventListener('mouseup', event => {
        const click = selectionClick;
        selectionClick = undefined;
        if (click && event.button === 0 && Math.abs(event.clientX - click.x) <= 4 && Math.abs(event.clientY - click.y) <= 4 && dom.contains(event.target as Node)) {
          const view = editor.prosemirrorView;
          const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
          // Chromium can defer this click's collapse past mouseup, leaving a focus timer free to restore the old range.
          if (point && !view.composing) view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(point.pos))).setMeta('addToHistory', false));
        } else synchronizeSelection();
      }, { signal });
      dom.addEventListener('keydown', synchronizeSelection, { signal, capture: true });
      dom.addEventListener('keyup', synchronizeSelection, { signal, capture: true });
    },
    keyboardShortcuts: {
      'Ctrl-k': () => {
        if (!/Mac|iPhone|iPad|iPod/.test(navigator.platform) || !editor.isEditable) return false;
        const selection = editor.prosemirrorState.selection;
        if (selection.empty || editor.prosemirrorView.dom.ownerDocument.getSelection()?.isCollapsed !== false) return false;
        let plainContent = false;
        selection.content().content.descendants(node => {
          if (node.type.spec.content === 'text*') plainContent = true;
          return !plainContent;
        });
        if (!plainContent) return false;
        // Native line deletion of plain-content selections can be misread as Enter by ProseMirror.
        editor.transact(tr => tr.deleteSelection().scrollIntoView());
        return true;
      },
      'Mod-Shift-h': () => {
        if (!editor.isEditable || !lastColor) return false;
        const { field, color } = lastColor;
        if (editor.getSelectedText()) editor.addStyles({ [field]: color });
        else
          editor.transact(() => {
            for (const block of selected()) editor.updateBlock(block as any, { props: { [field]: color } });
          });
        return true;
      },
      'Mod-d': () => {
        if (!editor.isEditable) return false;
        const blocks = selected(),
          copies = normalizeBlocks(structuredClone(blocks), true);
        editor.insertBlocks(copies as any, blocks.at(-1)!.id!, 'after');
        editor.setTextCursorPosition(copies[0].id!, 'end');
        return true;
      },
      'Mod-Alt-0': () => transform('paragraph'),
      'Mod-Alt-1': () => transform('heading', { level: 1 }),
      'Mod-Alt-2': () => transform('heading', { level: 2 }),
      'Mod-Alt-3': () => transform('heading', { level: 3 }),
      'Mod-Alt-4': () => transform('checkListItem', { checked: false }),
      'Mod-Alt-5': () => transform('bulletListItem'),
      'Mod-Alt-6': () => transform('numberedListItem'),
      'Mod-Alt-7': () => transform('toggleListItem'),
      'Mod-Alt-8': () => transform('codeBlock'),
      'Mod-Alt-9': () => transform('quote'),
      'Mod-Enter': () => {
        if (!editor.isEditable) return false;
        const block = editor.getTextCursorPosition().block;
        if (block.type === 'checkListItem') {
          editor.updateBlock(block, { props: { checked: !block.props.checked } });
          return true;
        }
        return false;
      },
    },
  };
});
