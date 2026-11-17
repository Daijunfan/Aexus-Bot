import { useState } from 'react';
import { ImageOff, Minus, Plus, Scan, RotateCcw } from 'lucide-react';

export function FileImage({ url, title }: { url: string; title: string }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <section className="file-image-viewer" aria-label="图片预览">
    <div className="file-image-toolbar">
      <span>{dimensions ? `${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()}` : '原始图片'}</span>
      <div><button type="button" aria-label="缩小图片" disabled={!dimensions || zoom === 0.25} onClick={() => setZoom(value => Math.max(0.25, (value ?? 1) - 0.25))}><Minus size={15} /></button>
        <button type="button" aria-label="原始尺寸" disabled={!dimensions} onClick={() => setZoom(1)}>{zoom === null ? '适应窗口' : `${Math.round(zoom * 100)}%`}</button>
        <button type="button" aria-label="放大图片" disabled={!dimensions || zoom === 3} onClick={() => setZoom(value => Math.min(3, (value ?? 1) + 0.25))}><Plus size={15} /></button>
        <button type="button" aria-label="适应窗口" onClick={() => setZoom(null)}><Scan size={15} /></button></div>
    </div>
    <div className={`file-image-canvas ${zoom === null ? 'fit' : 'zoomed'}`}>
      {failed ? <div className="file-image-error" role="status"><ImageOff size={28} /><p>图片暂时无法显示</p><button className="secondary-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}><RotateCcw size={14} />重试</button></div>
        : <img key={attempt} src={url} alt={title} decoding="async" draggable={false}
            style={zoom !== null && dimensions ? { width: dimensions.width * zoom, maxWidth: 'none', maxHeight: 'none' } : undefined}
            onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)} />}
    </div>
  </section>;
}
