/** Reserve content space while optional UI code loads; navigation stays usable. */
export function LoadingSurface({ label = '正在打开页面…', compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`loading-surface ${compact ? 'compact' : ''}`} role="status" aria-live="polite" aria-busy="true">
    <span className="loading-surface-label">{label}</span>
    <div className="loading-surface-line" /><div className="loading-surface-line" /><div className="loading-surface-line short" />
  </div>;
}
