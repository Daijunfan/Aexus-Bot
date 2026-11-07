import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Page } from '../types';
import { useWorkspace } from '../store';
import { parseCSV } from '../transfer';
import { CoalescedWriter } from '../core/coalescedWriter';
import { FileImage } from './FileImage';
import { LoadingSurface } from './LoadingSurface';

type Document = { content: string; hash: string };
type Draft = { content: string; base: Document } | null;
export function FolderDocument({ page }: { page: Page }) {
  const { api, navigate, workspace, notifyError } = useWorkspace(), source = page.sourceFile!;
  const apiRef = useRef(api); apiRef.current = api;
  const [document, setDocument] = useState<Document | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [visibleRows, setVisibleRows] = useState(200);
  const checkpoint = useMemo(() => new CoalescedWriter<Draft>(
    value => apiRef.current('fs.draft-write', { key: source.path, draft: value }),
    error => setError(`草稿保存失败：${String((error as Error).message || error)}`),
  ), [source.path]);
  useEffect(() => () => { void checkpoint.flush().catch(error => notifyError(`草稿保存失败：${error.message}`)); }, [checkpoint]);
  useEffect(() => {
    let gone = false;
    if (editing) {
      if (document && source.hash !== document.hash) setError('文件已在外部修改；你的草稿已保留，保存时会校验冲突。');
      return;
    }
    setDocument(null); setError('');
    if (['text', 'markdown', 'csv'].includes(source.kind))
      void Promise.all([apiRef.current('fs.read', { path: source.path }), apiRef.current('fs.draft-read', { key: source.path })])
        .then(([value, saved]) => {
          if (gone) return;
          setDocument(saved?.base || value); setDraft(saved?.content ?? value.content);
          if (saved?.base) setEditing(true);
        }).catch(error => !gone && setError(String(error.message)));
    return () => { gone = true; };
  }, [source.path, source.hash, editing]);
  const csv = useMemo(() => {
    if (source.kind !== 'csv' || !document) return { rows: [], error: '' };
    try { return { rows: parseCSV(document.content), error: '' }; }
    catch (error) { return { rows: [], error: String((error as Error).message) }; }
  }, [source.kind, document]);
  const url = (window.native?.workspaceURL?.(source.path) || '') + `?v=${source.hash}`;
  const save = async () => {
    if (!document) return;
    setSaving(true);
    try {
      await checkpoint.flush();
      const value = await apiRef.current('fs.write', { path: source.path, content: draft, hash: document.hash });
      checkpoint.set(null); await checkpoint.flush();
      setDocument(value); setEditing(false); setError('');
    } catch (error) { setError(String((error as Error).message)); throw error; }
    finally { setSaving(false); }
  };
  useEffect(() => window.native?.onFlush(async () => { if (editing && document) await save(); else await checkpoint.flush(); }), [editing, draft, document, checkpoint]);
  const cancel = async () => { checkpoint.set(null); await checkpoint.flush(); setEditing(false); };
  const link = (href: string) => {
    if (/^(https?:|mailto:|data:)/i.test(href)) return href;
    const dir = source.path.split('/').slice(0, -1).join('/');
    return window.native?.workspaceURL?.((dir ? dir + '/' : '') + href) || href;
  };
  return <article className="folder-document">
    <header><div><small>WORKSPACE FILE</small><h1>{page.title}</h1><code>{source.path}</code></div>
      {document && <button className="secondary-button" disabled={saving} onClick={() => editing ? void cancel().catch(error => setError(error.message)) : setEditing(true)}>{editing ? '取消编辑' : '编辑文件'}</button>}
    </header>
    {error && <div className="folder-file-error" role="alert">{error}</div>}
    {source.kind === 'directory' ? <div className="folder-directory">{workspace?.pages.filter(p => p.parentId === page.id && !p.trashedAt).map(p => <button key={p.id} onClick={() => navigate(p.id)}>{p.sourceFile?.kind === 'directory' ? '▸' : '↗'} {p.title}</button>)}</div> :
      editing ? <><textarea className="folder-source-editor" aria-label="文件内容" value={draft} readOnly={saving}
        onChange={event => { const content = event.target.value; setDraft(content); if (document) checkpoint.set({ content, base: document }); }}
        onBlur={() => void checkpoint.flush().catch(error => setError(error.message))}
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 's' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!saving) void save().catch(() => {}); } }} />
        <button className="primary-button" disabled={saving} onClick={() => void save().catch(() => {})}>{saving ? '保存中…' : '保存文件'}</button></> :
      source.kind === 'markdown' && document ? <div className="folder-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={link} components={{ img: props => <img {...props} loading="lazy" decoding="async" /> }}>{document.content}</ReactMarkdown></div> :
      source.kind === 'csv' && document ? <div className="folder-csv">{csv.error && <p role="alert">{csv.error}</p>}<p className="folder-csv-summary">{Math.max(0, csv.rows.length - 1).toLocaleString()} 行 · {csv.rows[0]?.length || 0} 列</p><table><tbody>{csv.rows.slice(0, window.native?.printMode ? undefined : visibleRows + 1).map((row, i) => <tr key={i}>{row.map((value, j) => i === 0 ? <th key={j}>{value}</th> : <td key={j}>{value}</td>)}</tr>)}</tbody></table>{!window.native?.printMode && csv.rows.length > visibleRows + 1 && <button className="secondary-button" onClick={() => setVisibleRows(value => value + 200)}>显示更多行（还有 {csv.rows.length - visibleRows - 1} 行）</button>}</div> :
      source.kind === 'image' ? <FileImage key={url} url={url} title={page.title} /> :
      source.kind === 'pdf' ? <object className="folder-pdf" data={url} type="application/pdf"><a href={url} download>下载 PDF</a></object> :
      document ? <pre className="folder-plain">{document.content}</pre> : source.kind === 'binary' ? <p>此文件保留在工作文件夹中。<a href={url} download>下载原文件</a></p> : !error ? <LoadingSurface compact label="正在读取文件…" /> : null}
  </article>;
}
