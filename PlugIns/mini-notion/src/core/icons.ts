import iconNames from './iconNames.json' with { type: 'json' };
import { CommandError } from './errors.ts';
import type { CustomEmoji } from '../types.ts';

// Keep the existing string field: old emojis, copies and page references need no migration.
export const iconColors = {
  default: { name: '默认', light: '#37352f', dark: '#d4d4d4' },
  gray: { name: '灰色', light: '#787774', dark: '#9b9b9b' },
  brown: { name: '棕色', light: '#9f6b53', dark: '#ba856f' },
  orange: { name: '橙色', light: '#d9730d', dark: '#c77d48' },
  yellow: { name: '黄色', light: '#cb912f', dark: '#c49751' },
  green: { name: '绿色', light: '#448361', dark: '#529e72' },
  blue: { name: '蓝色', light: '#337ea9', dark: '#5e87c9' },
  purple: { name: '紫色', light: '#9065b0', dark: '#9d68d3' },
  pink: { name: '粉色', light: '#c14c8a', dark: '#d15796' },
  red: { name: '红色', light: '#d44c47', dark: '#df5452' },
} as const;
export type IconColor = keyof typeof iconColors;
export { iconNames };
const names = new Set(iconNames);
export const iconSchema = {
  field: 'icon',
  formats: ['Unicode emoji', 'icon:<name>:<color>', 'asset://local/<filename>', 'empty string to remove'],
  names: iconNames,
  colors: iconColors,
  example: 'icon:BookOpen:blue',
  calloutField: 'props.emoji',
  customEmojiLibrary: {
    field: 'settings.customEmojis',
    item: {
      id: 'unique ID',
      name: 'unique display name',
      url: 'asset://local/... or image URL',
      keywords: 'optional search aliases',
    },
    inlineType: 'customEmoji',
    inlineProps: ['id', 'name', 'url'],
  },
};
export function parseIcon(value?: string): { name: string; color: IconColor } | undefined {
  const match = /^icon:([A-Za-z0-9]+):([a-z]+)$/.exec(value || '');
  if (match && names.has(match[1]) && Object.hasOwn(iconColors, match[2]))
    return { name: match[1], color: match[2] as IconColor };
}
export function validateIcon(value: unknown) {
  if (typeof value !== 'string' || (value.startsWith('icon:') && !parseIcon(value)))
    throw new CommandError(
      'INVALID_ICON',
      '图标需要 emoji、本地图片或 icon:<name>:<color>；使用 schema 查看图标名称与颜色',
    );
}
export function validateCustomEmojis(value: unknown): asserts value is CustomEmoji[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new CommandError('INVALID_EMOJI_LIBRARY', '表情库需要数组');
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const item of value) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      typeof item.url !== 'string' ||
      !/^(asset:\/\/local\/|https?:\/\/|data:image\/)/i.test(item.url) ||
      (item.keywords !== undefined && typeof item.keywords !== 'string')
    )
      throw new CommandError('INVALID_EMOJI_LIBRARY', '自定义表情需要 ID、名称和图片地址');
    const name = item.name.normalize('NFKC').trim().toLowerCase();
    if (ids.has(item.id) || names.has(name))
      throw new CommandError('DUPLICATE_EMOJI', '表情名称或 ID 已存在');
    ids.add(item.id);
    names.add(name);
  }
}
