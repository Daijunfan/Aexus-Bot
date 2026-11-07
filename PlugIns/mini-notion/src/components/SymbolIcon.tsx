import { icons, File } from 'lucide-react';
import { iconColors, type IconColor } from '../core/icons';
export function SymbolIcon({ name, color, theme, size }: { name: string; color: IconColor; theme: 'light' | 'dark'; size: number }) {
  const Glyph = icons[name as keyof typeof icons] || File;
  return <Glyph size={size} strokeWidth={1.8} className="page-symbol" style={{ color: iconColors[color][theme] }} aria-hidden="true" />;
}
