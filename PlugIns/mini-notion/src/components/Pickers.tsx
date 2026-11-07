import { useState, useRef, useContext, useMemo, useLayoutEffect } from 'react';
import { Upload, Shuffle, X, Search, Check } from 'lucide-react';
import { Popover, MenuItem, PageIcon } from '../ui';
import { saveImageAsset, probeImage } from '../content/assets';
import { CoverImage } from './CoverImage';
import { coverPresentation } from '../presentation';
import { useWorkspace } from '../store';
import { AppearanceTheme } from '../appearance';
import { iconColors, parseIcon, validateCustomEmojis, type IconColor } from '../core/icons';
import { emojiGroups, searchCustomEmojis, searchEmojis, searchSymbols } from '../core/iconSearch';
import type { CustomEmoji } from '../types';

const segmenter = new Intl.Segmenter();
const emptyCustomEmojis: CustomEmoji[] = [];
const columns = 9,
  rowHeight = 37,
  visibleRows = Math.ceil(306 / rowHeight) + 6;
type IconChoice = { value: string; name: string };
type PickerTab = 'emoji' | 'icon' | 'custom' | 'upload';
function IconGrid({
  choices,
  value,
  size,
  onChoose,
  onSearch,
}: {
  choices: IconChoice[];
  value: string;
  size: number;
  onChoose: (value: string) => void;
  onSearch: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [firstRow, setFirstRow] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    viewport.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${pendingFocus.current}"]`)
      ?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [firstRow, activeIndex]);
  const start = firstRow * columns;
  return (
    <div
      ref={viewport}
      className="icon-picker-results"
      onScroll={(event) =>
        setFirstRow(Math.max(0, Math.floor(event.currentTarget.scrollTop / rowHeight) - 3))
      }
    >
      {!choices.length && <p className="icon-picker-empty">没有找到匹配的图标</p>}
      <div
        className="icon-picker-grid"
        role="group"
        aria-label={`${choices.length} 个可选图标`}
        style={{ height: Math.ceil(choices.length / columns) * rowHeight }}
        onKeyDown={(event) => {
          const offset = {
            ArrowRight: 1,
            ArrowLeft: -1,
            ArrowDown: columns,
            ArrowUp: -columns,
            PageDown: columns * 8,
            PageUp: -columns * 8,
          }[event.key];
          if (!offset && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          const index = Number((event.target as HTMLButtonElement).dataset.index);
          if (event.key === 'ArrowUp' && index < columns) {
            onSearch();
            return;
          }
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : Math.max(0, Math.min(choices.length - 1, index + offset!));
          const element = viewport.current!;
          const top = Math.floor(next / columns) * rowHeight;
          if (top < element.scrollTop) element.scrollTop = top;
          else if (top + rowHeight > element.scrollTop + element.clientHeight)
            element.scrollTop = top + rowHeight - element.clientHeight;
          pendingFocus.current = next;
          setActiveIndex(next);
          setFirstRow(Math.max(0, Math.floor(element.scrollTop / rowHeight) - 3));
        }}
      >
        {choices.slice(start, start + visibleRows * columns).map((item, offset) => {
          const index = start + offset;
          return (
            <button
              key={`${item.value}:${item.name}`}
              data-index={index}
              aria-label={item.name}
              title={item.name}
              aria-pressed={value === item.value}
              tabIndex={
                index === activeIndex ||
                ((activeIndex < start || activeIndex >= start + visibleRows * columns) && offset === 0)
                  ? 0
                  : -1
              }
              style={{
                top: Math.floor(index / columns) * rowHeight,
                left: `${((index % columns) * 100) / columns}%`,
                width: `calc(100% / ${columns} - 1px)`,
              }}
              onFocus={() => setActiveIndex(index)}
              onClick={() => onChoose(item.value)}
            >
              <PageIcon icon={item.value} size={size} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ImageLink({
  onChoose,
  disabled,
  label,
}: {
  onChoose: (url: string) => void;
  disabled: boolean;
  label: string;
}) {
  const [url, setURL] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <form
      className="icon-picker-link"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || disabled || checking) return;
        setChecking(true); setError('');
        try { await probeImage(url.trim()); onChoose(url.trim()); }
        catch (error) { setError(error instanceof Error ? error.message : '图片无法打开'); }
        finally { setChecking(false); }
      }}
    >
      <input
        type="url"
        aria-label={label}
        placeholder="粘贴图片链接…"
        value={url}
        onChange={(event) => { setURL(event.target.value); setError(''); }}
        disabled={checking}
        required
      />
      <button className="secondary-button" disabled={disabled || checking || !valid}>
        {checking ? '正在检查…' : '使用链接'}
      </button>
      {error && <p className="image-upload-error" role="alert">{error}</p>}
    </form>
  );
}

function ImageUpload({ saving, onFile, hint }: { saving: boolean; onFile: (file: File) => Promise<void>; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className={`image-upload-zone ${dragging ? 'dragging' : ''}`} aria-busy={saving}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !saving) void onFile(file); }}
    onPaste={event => { const file = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile(); if (file && !saving) { event.preventDefault(); void onFile(file); } }}>
    <button type="button" className="secondary-button" disabled={saving} onClick={() => input.current?.click()}><Upload size={16} />{saving ? '正在保存…' : '上传图片'}</button>
    <p>{hint}</p><small>拖入图片，或聚焦此处后粘贴 · 保留原图</small>
    <input ref={input} type="file" accept="image/*" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file && !saving) void onFile(file); }} />
  </div>;
}

function CustomEmojiManager({
  items,
  onSave,
  onRemove,
  onBack,
}: {
  items: CustomEmoji[];
  onSave: (item: CustomEmoji) => void;
  onRemove: (item: CustomEmoji) => void;
  onBack: () => void;
}) {
  const [item, setItem] = useState(items[0]);
  return (
    <form
      className="icon-picker-upload"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...item, name: item.name.trim() });
      }}
    >
      <select
        aria-label="管理自定义表情"
        value={item.id}
        onChange={(event) => setItem(items.find((entry) => entry.id === event.target.value)!)}
      >
        {items.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <PageIcon icon={item.url} size={40} />
      <div className="icon-picker-link">
        <input
          aria-label="自定义表情名称"
          value={item.name}
          required
          onChange={(event) => setItem({ ...item, name: event.target.value })}
        />
        <input
          aria-label="自定义表情关键词"
          placeholder="搜索关键词或别名（可选）"
          value={item.keywords || ''}
          onChange={(event) => setItem({ ...item, keywords: event.target.value })}
        />
      </div>
      <div className="icon-picker-library-actions">
        <button className="secondary-button" disabled={!item.name.trim()}>
          保存
        </button>
        <button type="button" className="secondary-button" onClick={() => onRemove(item)}>
          从表情库移除
        </button>
        <button type="button" className="secondary-button" onClick={onBack}>
          返回
        </button>
      </div>
    </form>
  );
}

export function EmojiPicker({
  x,
  y,
  value,
  onChange,
  onClose,
  initialTab,
  emojiOnly = false,
}: {
  x: number;
  y: number;
  value: string;
  onChange: (icon: string, customEmoji?: CustomEmoji) => void;
  onClose: () => void;
  initialTab?: PickerTab;
  emojiOnly?: boolean;
}) {
  const current = parseIcon(value);
  const [tab, setTab] = useState<PickerTab>(
    initialTab ||
      (current && !emojiOnly ? 'icon' : /^(asset:|https?:|data:)/.test(value) ? 'upload' : 'emoji'),
  );
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [color, setColor] = useState<IconColor>(current?.color || 'default');
  const [saving, setSaving] = useState(false);
  const [addToLibrary, setAddToLibrary] = useState(emojiOnly);
  const [customName, setCustomName] = useState('');
  const [customKeywords, setCustomKeywords] = useState('');
  const [managing, setManaging] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const theme = useContext(AppearanceTheme);
  const { notify, notifyError, workspace, setting } = useWorkspace();
  const library = workspace?.settings.customEmojis || emptyCustomEmojis;
  const saveLibrary = (items: CustomEmoji[]) => {
    try {
      validateCustomEmojis(items);
      setting({ customEmojis: items });
      return true;
    } catch (error) {
      notifyError(error instanceof Error ? error.message : '表情保存失败');
      return false;
    }
  };
  const choose = (icon: string, customEmoji?: CustomEmoji) => {
    onChange(icon, customEmoji || library.find((item) => item.url === icon));
    onClose();
  };
  const chooseImage = (url: string, fallbackName: string) => {
    const item = {
      id: crypto.randomUUID(),
      name: customName.trim() || fallbackName,
      url,
      keywords: customKeywords.trim(),
    };
    if (addToLibrary && !saveLibrary([...library, item])) return false;
    choose(url, item);
    return true;
  };
  const uploadImage = async (file: File) => {
    setSaving(true);
    try { if (chooseImage(await saveImageAsset(file), file.name.replace(/\.[^.]+$/, ''))) notify('图标已更新'); }
    catch (error) { notifyError(error instanceof Error ? error.message : '图标保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const choices = useMemo(() => {
    if (tab === 'upload') return [];
    if (tab === 'custom')
      return searchCustomEmojis(library, query).map((item) => ({ value: item.url, name: item.name }));
    if (tab === 'icon')
      return searchSymbols(query).map((item) => ({ value: `icon:${item.name}:${color}`, name: item.name }));
    const result = searchEmojis(query, group).map((item) => ({ value: item.emoji, name: item.name }));
    const pasted = query.trim();
    if (
      pasted &&
      [...segmenter.segment(pasted)].length === 1 &&
      /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(pasted) &&
      !result.some((item) => item.value === pasted)
    )
      result.unshift({ value: pasted, name: pasted });
    return result;
  }, [tab, query, group, color, library]);
  return (
    <Popover x={x} y={y} onClose={onClose} width={360} className="icon-picker" role="dialog" label="选择图标">
      <div className="icon-picker-tabs" role="tablist" aria-label="图标类型">
        {(
          [
            ['emoji', '表情符号'],
            ['icon', '图标'],
            ['custom', '我的表情'],
            ['upload', '上传'],
          ] as const
        )
          .filter(([id]) => !emojiOnly || id !== 'icon')
          .map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setQuery('');
                setManaging(false);
                requestAnimationFrame(() => search.current?.focus());
              }}
            >
              {label}
            </button>
          ))}
        <button
          className="icon-picker-random"
          title="随机图标"
          aria-label="随机图标"
          disabled={!choices.length || saving}
          onClick={() => choose(choices[Math.floor(Math.random() * choices.length)].value)}
        >
          <Shuffle size={16} />
        </button>
      </div>
      {managing ? (
        <CustomEmojiManager
          items={library}
          onBack={() => setManaging(false)}
          onSave={(item) => {
            if (saveLibrary(library.map((old) => (old.id === item.id ? item : old)))) setManaging(false);
          }}
          onRemove={(item) => {
            if (saveLibrary(library.filter((old) => old.id !== item.id))) {
              setManaging(false);
              notify('已从表情库移除，已使用的图片保持不变', () => setting({ customEmojis: library }));
            }
          }}
        />
      ) : tab !== 'upload' ? (
        <>
          <label className="icon-picker-search">
            <Search size={15} />
            <input
              ref={search}
              autoFocus
              aria-label="搜索图标"
              placeholder="搜索或粘贴表情符号…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter' && choices[0]) {
                  event.preventDefault();
                  choose(choices[0].value);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.currentTarget
                    .closest('.icon-picker')
                    ?.querySelector<HTMLButtonElement>('.icon-picker-grid button')
                    ?.focus();
                }
              }}
            />
          </label>
          {tab === 'icon' ? (
            <div className="icon-picker-colors" aria-label="图标颜色">
              {Object.entries(iconColors).map(([id, tone]) => (
                <button
                  key={id}
                  title={tone.name}
                  aria-label={tone.name}
                  aria-pressed={color === id}
                  style={{ color: tone[theme] }}
                  onClick={() => {
                    setColor(id as IconColor);
                    if (current) onChange(`icon:${current.name}:${id}`);
                  }}
                >
                  <span style={{ background: tone[theme] }}>{color === id && <Check size={12} />}</span>
                </button>
              ))}
            </div>
          ) : tab === 'emoji' ? (
            <select
              className="icon-picker-category"
              aria-label="表情分类"
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
              }}
            >
              <option value="">全部表情</option>
              {Object.entries(emojiGroups).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <IconGrid
            key={`${tab}:${query}:${group}`}
            choices={choices}
            value={value}
            size={tab === 'icon' ? 22 : 25}
            onChoose={choose}
            onSearch={() => search.current?.focus()}
          />
          <div className="icon-picker-count" aria-live="polite">
            {choices.length} 个{tab === 'icon' ? '图标' : '表情'}
          </div>
          {tab === 'custom' && (
            <div className="icon-picker-library-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setAddToLibrary(true);
                  setTab('upload');
                }}
              >
                上传新表情
              </button>
              {!!library.length && (
                <button className="secondary-button" onClick={() => setManaging(true)}>
                  管理表情
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="icon-picker-upload">
          {value && <PageIcon icon={value} size={64} />}
          <ImageUpload saving={saving} onFile={uploadImage} hint="图标建议使用正方形图片。" />
          <label className="icon-picker-library-toggle">
            <input
              type="checkbox"
              checked={addToLibrary}
              onChange={(event) => setAddToLibrary(event.target.checked)}
            />
            添加到我的表情
          </label>
          {addToLibrary && (
            <div className="icon-picker-link">
              <input
                aria-label="自定义表情名称"
                placeholder="表情名称（默认使用文件名）"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
              <input
                aria-label="自定义表情关键词"
                placeholder="搜索关键词或别名（可选）"
                value={customKeywords}
                onChange={(event) => setCustomKeywords(event.target.value)}
              />
            </div>
          )}
          <ImageLink
            onChoose={(url) => chooseImage(url, new URL(url).hostname)}
            disabled={saving}
            label="图标图片链接"
          />
        </div>
      )}
      {!emojiOnly && (
        <>
          <div className="menu-divider" />
          <MenuItem icon={<X size={15} />} disabled={saving} onClick={() => choose('')}>
            移除图标
          </MenuItem>
        </>
      )}
    </Popover>
  );
}
export const covers = [
  { id: 'paper', name: '纸上山丘' },
  { id: 'sand', name: '暖沙' },
  { id: 'sage', name: '鼠尾草' },
  { id: 'dusk', name: '暮色' },
  { id: 'blue', name: '远山' },
  { id: 'pink', name: '浅樱' },
  { id: 'ink', name: '水墨' },
  { id: 'sunset', name: '日落' },
  ...Object.entries(iconColors)
    .filter(([id]) => id !== 'default')
    .map(([id, color]) => ({ id: `solid-${id}`, name: color.name })),
];
export function CoverPicker({
  x,
  y,
  value,
  onChange,
  onClose,
}: {
  x: number;
  y: number;
  value?: string | null;
  onChange: (cover: string | null) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'gallery' | 'upload'>('gallery');
  const { notify, notifyError } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const uploadImage = async (file: File) => {
    setSaving(true);
    try { onChange(await saveImageAsset(file)); notify('封面已更新'); onClose(); }
    catch (error) { notifyError(error instanceof Error ? error.message : '封面保存失败，请重试'); }
    finally { setSaving(false); }
  };
  return (
    <Popover
      x={x}
      y={y}
      width={380}
      onClose={onClose}
      className="cover-picker"
      role="dialog"
      label="选择封面"
    >
      <div className="icon-picker-tabs" role="tablist" aria-label="封面类型">
        <button role="tab" aria-selected={tab === 'gallery'} onClick={() => setTab('gallery')}>
          图库
        </button>
        <button role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>
          上传
        </button>
      </div>
      {tab === 'gallery' ? (
        <>
          <div className="picker-heading">颜色与渐变</div>
          <div className="cover-grid">
            {covers.map((cover) => (
              <button
                key={cover.id}
                className={`cover-${cover.id}`}
                title={cover.name}
                aria-label={cover.name}
                aria-pressed={value === cover.id}
                disabled={saving}
                onClick={() => {
                  onChange(cover.id);
                  onClose();
                }}
              >
                {value === cover.id && <Check size={18} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="icon-picker-upload">
          {value && <div className={`cover-upload-preview ${coverPresentation(value).className}`} style={coverPresentation(value, 50, true).style}><CoverImage url={value} eager /></div>}
          <ImageUpload saving={saving} onFile={uploadImage} hint="横向图片效果更好，建议宽度至少 1,500 像素。" />
          <ImageLink
            disabled={saving}
            label="封面图片链接"
            onChoose={(url) => {
              onChange(url);
              onClose();
            }}
          />
        </div>
      )}
      <div className="menu-divider" />
      <MenuItem
        icon={<X size={15} />}
        disabled={saving || !value}
        onClick={() => {
          onChange(null);
          onClose();
        }}
      >
        移除封面
      </MenuItem>
    </Popover>
  );
}
