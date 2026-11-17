import type { JsonBlock } from '../../shared/mission-notebook/types';

let editorPromise: Promise<any> | null = null;

async function getEditor() {
  if (!editorPromise) {
    editorPromise = (async () => {
      const [{ ServerBlockNoteEditor }, { BlockNoteSchema, defaultInlineContentSpecs, createInlineContentSpec }, { withMultiColumn }] =
        await Promise.all([
          import('@blocknote/server-util'),
          import('@blocknote/core'),
          import('@blocknote/xl-multi-column'),
        ]);
      const CustomEmojiSpec = createInlineContentSpec(
        {
          type: 'customEmoji',
          propSchema: { id: { default: '' }, name: { default: '' }, url: { default: '' } },
          content: 'none',
        },
        {
          render: ({ props }) => {
            const doc = globalThis.document;
            if (!doc) return { dom: {} as any };
            const dom = doc.createElement('span');
            const image = doc.createElement('img');
            image.src = props.url;
            image.alt = `:${props.name}:`;
            image.title = props.name;
            image.className = 'inline-custom-emoji';
            image.width = 20;
            image.height = 20;
            dom.dataset.miniEmoji = props.id;
            dom.dataset.miniEmojiName = props.name;
            dom.append(image);
            return { dom };
          },
        },
      );
      return ServerBlockNoteEditor.create({
        schema: withMultiColumn(
          BlockNoteSchema.create({
            inlineContentSpecs: { ...defaultInlineContentSpecs, customEmoji: CustomEmojiSpec as any },
          }),
        ),
        links: { isValidLink: (href) => /^(https?:|mailto:|asset:|mission:|mininotion:|file:|#)/i.test(href) },
      });
    })();
  }
  return editorPromise;
}

export async function parseDocument(content: string, type: string): Promise<JsonBlock[]> {
  const editor = await getEditor();
  return type === 'html' || type === 'htm'
    ? editor.tryParseHTMLToBlocks(content)
    : editor.tryParseMarkdownToBlocks(content);
}

export async function serializeDocument(blocks: JsonBlock[], type: string): Promise<string> {
  const editor = await getEditor();
  return type === 'md' ? editor.blocksToMarkdownLossy(blocks as any) : editor.blocksToFullHTML(blocks as any);
}
