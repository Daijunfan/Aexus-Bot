import { lazy, Suspense, type ComponentProps } from 'react';
import { Popover } from '../ui';
import { LoadingSurface } from './LoadingSurface';

const Emoji = lazy(() => import('./Pickers').then(module => ({ default: module.EmojiPicker })));
const Cover = lazy(() => import('./Pickers').then(module => ({ default: module.CoverPicker })));
type EmojiProps = ComponentProps<typeof Emoji>;
type CoverProps = ComponentProps<typeof Cover>;
export function EmojiPicker(props: EmojiProps) {
  return <Suspense fallback={<Popover {...props} role="dialog" label="正在加载图标"><LoadingSurface compact label="正在加载图标…" /></Popover>}><Emoji {...props} /></Suspense>;
}
export function CoverPicker(props: CoverProps) {
  return <Suspense fallback={<Popover {...props} role="dialog" label="正在加载封面"><LoadingSurface compact label="正在加载封面…" /></Popover>}><Cover {...props} /></Suspense>;
}
