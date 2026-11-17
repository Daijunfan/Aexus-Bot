import { createInlineContentSpec } from '@blocknote/core';

// A real atomic image node, shared by the desktop and headless HTML/Markdown converter.
// Store the image and name with the node so removing a library entry never breaks a document.
export const CustomEmojiSpec = createInlineContentSpec(
  {
    type: 'customEmoji',
    propSchema: { id: { default: '' }, name: { default: '' }, url: { default: '' } },
    content: 'none',
  },
  {
    render: ({ props }) => {
      const dom = document.createElement('span');
      const image = document.createElement('img');
      image.src = props.url;
      image.alt = `:${props.name}:`;
      image.title = props.name;
      image.className = 'inline-custom-emoji';
      image.width = 20;
      image.height = 20;
      image.draggable = false;
      dom.contentEditable = 'false';
      dom.dataset.miniEmoji = props.id;
      dom.dataset.miniEmojiName = props.name;
      dom.append(image);
      return { dom };
    },
    parse: (element) =>
      element.matches('span[data-mini-emoji]')
        ? {
            id: element.getAttribute('data-mini-emoji') || '',
            name: element.getAttribute('data-mini-emoji-name') || '',
            url: element.querySelector('img')?.getAttribute('src') || '',
          }
        : undefined,
  },
);
