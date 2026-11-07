import type { CSSProperties } from 'react';
import type { AppearanceColor } from '../core/appearance';
import { appearanceColor, readableInk } from '../appearance';

export function conditionalColorStyle(
  color: AppearanceColor | undefined,
  theme: 'light' | 'dark',
): CSSProperties | undefined {
  const background = appearanceColor(color, theme);
  if (!background) return undefined;
  const ink = readableInk(background);
  return {
    backgroundColor: background,
    color: ink,
    '--view-card-bg': background,
    '--view-card-ink': ink,
    '--view-card-muted': ink,
    '--bg': background,
    '--text': ink,
    '--muted': ink,
    '--subtle': ink,
  } as CSSProperties;
}
