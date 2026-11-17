import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathValue({ expression, display = false }: { expression: string; display?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(expression, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: 'ignore',
        maxSize: 20,
      }),
    [expression, display],
  );
  return <span className="math-value" aria-label={expression} dangerouslySetInnerHTML={{ __html: html }} />;
}
