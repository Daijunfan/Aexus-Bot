// Sidebar folders are disclosures, independent of the active document/surface.
// Both trees re-render their visible branch on change; preserve the operator's
// scroll position and keyboard focus across that replacement.
export function toggleSidebarBranch({ expanded, id, findRow, render, defaultFocus }) {
  const previous = findRow();
  const active = document.activeElement;
  const focus = previous?.contains(active)
    ? active === previous ? null
      : active.classList.contains('folder-toggle') ? '.folder-toggle'
      : active.classList.contains('folder-open') ? '.folder-open'
      : active.classList.contains('file-more') ? '.file-more' : defaultFocus
    : defaultFocus;
  const scroller = previous?.closest('#sidebar-navigation');
  const scrollTop = scroller?.scrollTop;

  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();

  if (scroller) scroller.scrollTop = Math.min(scrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  const next = findRow();
  const target = focus ? next?.querySelector(focus) : next;
  target?.focus({ preventScroll: true });
}
