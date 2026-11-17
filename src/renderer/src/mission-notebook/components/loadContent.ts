export const loadedContent: {
  Editor?: typeof import('./Editor').Editor;
  PageView?: typeof import('./PageView').PageView;
} = {};
export const loadEditor = () => import('./Editor').then(module => {
  loadedContent.Editor = module.Editor;
  return { default: module.Editor };
});
export const loadPageView = () => import('./PageView').then(module => {
  loadedContent.PageView = module.PageView;
  return { default: module.PageView };
});

/** Start both requests together. React.lazy still owns loading/error display. */
export function preloadNativePage() {
  void loadPageView().catch(() => {});
  void loadEditor().catch(() => {});
}
