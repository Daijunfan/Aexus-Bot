import { useState } from 'react';
import { ImageOff, RotateCcw } from 'lucide-react';

/** Native image decoding/lazy loading avoids eagerly decoding every gallery cover. */
export function CoverImage({ url, eager = false, retry = false }: { url?: string | null; eager?: boolean; retry?: boolean }) {
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  if (!url || !/^(asset:|https?:\/\/|data:image\/)/i.test(url)) return null;
  const error = failed === url;
  return <div className={`cover-media ${loaded !== url ? 'is-loading' : ''} ${error ? 'has-error' : ''}`}>
    {!error && <img key={`${url}:${attempt}`} src={url} alt="" draggable={false}
      loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : 'low'}
      onLoad={() => { setLoaded(url); setFailed(''); }} onError={() => setFailed(url)} />}
    {error && <span className="cover-media-error"><ImageOff size={18} aria-hidden="true" /><span>图片暂时无法显示</span>
      {retry && <button type="button" onClick={() => { setFailed(''); setLoaded(''); setAttempt(value => value + 1); }}><RotateCcw size={13} />重试</button>}
    </span>}
  </div>;
}
