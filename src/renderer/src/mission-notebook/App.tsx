import { LoadingSurface } from './components/LoadingSurface';
import { Bell } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, Component, lazy, Suspense, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronsRight,
  CircleAlert,
  Expand,
  FileOutput,
  House,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  MessageSquare,
  PanelLeft,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useWorkspace } from './store';
import { ancestors } from '../../../shared/mission-notebook/model';
import { IconButton, PageIcon } from './ui';
import { PageTabs } from './components/PageTabs';
import { Sidebar } from './components/Sidebar';
import { loadPageView, loadedContent, preloadNativePage } from './components/loadContent';
import type { Page } from '../../../shared/mission-notebook/types';
const DeferredPageView = lazy(loadPageView);
function PageView(props: { page: Page; theme: 'light' | 'dark'; peek?: boolean }) {
  // A fulfilled import must render synchronously, without flashing a Suspense
  // fallback. Keep the chosen component stable throughout this page's lifetime.
  const [Surface] = useState(() => loadedContent.PageView || DeferredPageView);
  return <Surface {...props} />;
}
const Home = lazy(() => import('./components/Home').then(module => ({ default: module.Home })));
const FolderDocument = lazy(() => import('./components/FolderDocument').then(module => ({ default: module.FolderDocument })));
import { PageMenu } from './components/PageMenu';
import { AppearanceTheme, appAppearanceStyle } from './appearance';
import { FindBar } from './components/FindBar';
import { useAgentTaskLiveSync } from './planning/TaskRecordControlBar';
// Off-screen dialogs, automation editors and Agent tooling are not part of the
// startup path. Load them when opened without delaying the document or sidebar.
const Automations = lazy(() => import('./actions/Automations').then(m => ({ default: m.Automations })));
const ButtonEditor = lazy(() => import('./actions/Buttons').then(m => ({ default: m.ButtonEditor })));
const ActionHistory = lazy(() => import('./actions/Buttons').then(m => ({ default: m.ActionHistory })));
const Inbox = lazy(() => import('./scheduling/Inbox').then(m => ({ default: m.Inbox })));
const SchedulerDialog = lazy(() => import('./scheduling/SchedulerDialog').then(m => ({ default: m.SchedulerDialog })));
const RepeatDialog = lazy(() => import('./scheduling/RepeatDialog').then(m => ({ default: m.RepeatDialog })));
const ReminderDialog = lazy(() => import('./scheduling/Reminders').then(m => ({ default: m.ReminderDialog })));
const Search = lazy(() => import('./components/Search').then(m => ({ default: m.Search })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const PageAppearanceDialog = lazy(() => import('./components/AppearanceControls').then(m => ({ default: m.PageAppearanceDialog })));
const Templates = lazy(() => import('./components/Dialogs').then(m => ({ default: m.Templates })));
const Trash = lazy(() => import('./components/Dialogs').then(m => ({ default: m.Trash })));
const HelpDialog = lazy(() => import('./components/Dialogs').then(m => ({ default: m.HelpDialog })));
const ImportDialog = lazy(() => import('./components/Dialogs').then(m => ({ default: m.ImportDialog })));
const ExportDialog = lazy(() => import('./components/Dialogs').then(m => ({ default: m.ExportDialog })));
const MoveDialog = lazy(() => import('./components/Dialogs').then(m => ({ default: m.MoveDialog })));
const HistoryDialog = lazy(() => import('./components/Dialogs').then(m => ({ default: m.HistoryDialog })));
const Conflicts = lazy(() => import('./components/Conflicts').then(m => ({ default: m.Conflicts })));
const Operations = lazy(() => import('./components/Operations').then(m => ({ default: m.Operations })));
const Comments = lazy(() => import('./components/Comments').then(m => ({ default: m.Comments })));
const NotebookAccessDialog = lazy(() => import('./components/NotebookAccessDialog').then(m => ({ default: m.NotebookAccessDialog })));
const AgentTasksHubModal = lazy(() => import('./planning/AgentTasksHubModal').then(m => ({ default: m.AgentTasksHubModal })));
const AgentTaskComposerModal = lazy(() => import('./planning/AgentTaskComposerModal').then(m => ({ default: m.AgentTaskComposerModal })));

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="startup-state">
        <CircleAlert size={32} />
        <h2>页面暂时无法显示</h2>
        <p>{this.state.error}</p>
        <button className="primary-button" onClick={() => location.reload()}>
          重新打开
        </button>
        <button className="text-button" onClick={() => void window.native?.revealData()}>
          打开本地数据文件夹
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  useAgentTaskLiveSync();
  const store = useWorkspace();
  const {
    workspace: ws,
    loadError,
    load,
    saving,
    saveError,
    retrySave,
    create,
    patch,
    navigate,
    go,
    navigation,
    setting,
    setModal,
    modal,
    toast,
    notify,
    setPageMenu,
    pageMenu,
    peekId,
    peekMode,
    setPeekId,
  } = store;
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const [find, setFind] = useState(false);
  const theme =
    ws?.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : ws?.settings.theme || 'light';
  const appearanceSignature = JSON.stringify(ws?.settings.appearance || {});
  const page = ws?.pages.find((p) => p.id === ws.activePageId && !p.trashedAt);
  const peekPage = ws?.pages.find((p) => p.id === peekId && !p.trashedAt);
  useEffect(() => {
    if (!ws) return;
    if (page && !page.database && (!page.sourceFile || page.sourceFile.kind === 'directory')) {
      preloadNativePage();
      return;
    }
    const timer = window.setTimeout(() => preloadNativePage(), 80);
    return () => window.clearTimeout(timer);
  }, [!!ws, page?.id]);
  useLayoutEffect(() => {
    if (ws && !performance.getEntriesByName('mini:shell-committed').length)
      performance.mark('mini:shell-committed');
  }, [!!ws]);

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const root = document.documentElement, values = appAppearanceStyle(ws?.settings.appearance, theme);
    for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
    root.dataset.palette = ws?.settings.appearance?.palette || 'classic';
    root.dataset.wallpaper = ws?.settings.appearance?.wallpaper || 'none';
    root.dataset.motion = ws?.settings.appearance?.motion || 'system';
    root.dataset.density = ws?.settings.appearance?.density || 'comfortable';
    root.dataset.agentMessages = ws?.settings.appearance?.agentMessages || 'bubble';
    return () => { for (const name of Object.keys(values)) root.style.removeProperty(name); };
  }, [theme, appearanceSignature]);
  useEffect(() => {
    if (ws) window.native?.setTheme(window.native.folderMode ? theme : ws.settings.theme);
  }, [ws?.settings.theme, theme]);
  useEffect(() => {
    document.title = page ? `${page.title || '无标题'} — Mission` : 'Mission 笔记本';
    setFind(false);
  }, [page?.id]);
  useEffect(() => {
    const command = (name: string) => {
      if (!ws) return;
      if (name.startsWith('open-page:')) {
        navigate(name.slice('open-page:'.length));
        return;
      }
      if (name.startsWith('host-theme:')) {
        const [, rawTheme] = name.split(':');
        const nextTheme = rawTheme === 'dark' ? 'dark' : 'light';
        if (ws.settings.theme !== nextTheme) setting({ theme: nextTheme });
        return;
      }
      switch (name) {
        case 'new-tab':
          navigate(null, undefined, 'new');
          break;
        case 'new-page':
          create();
          break;
        case 'search':
          setModal({ type: 'search' });
          break;
        case 'inbox':
        case 'scheduler':
          setModal({ type: name as 'inbox' | 'scheduler' });
          break;
        case 'space':
        case 'agent':
          setModal({ type: 'agent-tasks', pageId: ws.activePageId || undefined });
          break;
        case 'notification-error':
          notify('系统通知未成功投递，提醒已保存在收件箱');
          break;
        case 'settings':
          setModal({ type: 'settings' });
          break;
        case 'import':
          setModal({ type: 'import' });
          break;
        case 'export':
          setModal({ type: 'export', pageId: peekId || page?.id });
          break;
        case 'help':
          setModal({ type: 'help' });
          break;
        case 'find':
          setFind(true);
          break;
        case 'select-all': {
          const active = document.activeElement;
          if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.select();
          else window.dispatchEvent(new Event('mini:select-all'));
          break;
        }
        case 'comment-selection':
          window.dispatchEvent(new Event('mini:comment-selection'));
          break;
        case 'selection-agent':
          window.dispatchEvent(new Event('mini:selection-agent'));
          break;
        case 'sidebar':
          setting({ sidebarHidden: !ws.settings.sidebarHidden });
          break;
        case 'theme':
          setting({ theme: theme === 'dark' ? 'light' : 'dark' });
          break;
        case 'back':
          go(-1);
          break;
        case 'forward':
          go(1);
          break;
        case 'home':
          navigate(null);
          break;
        case 'save':
          void retrySave().then((saved) =>
            notify(saved ? '修改已自动保存在本机' : '保存失败，请检查数据文件夹后重试'),
          );
          break;
      }
    };
    const off = window.native?.onCommand(command);
    const offUI = window.native?.onUI((event) => {
      const params = event.params || {};
      if (event.command === 'open-page') {
        if (params.mode === 'side' || params.mode === 'center') {
          store.setPeekMode(params.mode);
          setPeekId(params.pageId);
        } else navigate(params.pageId, params.blockId, params.mode === 'tab' ? 'new' : undefined);
        if (params.blockId && (params.mode === 'side' || params.mode === 'center')) store.setBlockTarget({ pageId: params.pageId, blockId: params.blockId, request: Date.now() });
      } else if (['button', 'automations', 'action-history'].includes(event.command))
        setModal({
          type: event.command as 'button' | 'automations' | 'action-history',
          pageId: params.pageId || page?.id,
          blockId: params.blockId,
          propertyId: params.propertyId,
          ownerId: params.ownerId,
        });
      else if (event.command === 'comments')
        store.setCommentPanel({
          pageId: params.pageId || peekId || page?.id,
          blockId: params.blockId,
          quote: params.quote,
        });
      else if (event.command === 'calendar-day') window.dispatchEvent(new CustomEvent('mini:calendar-day', { detail: params }));
      else if (event.command === 'appearance') setModal({ type: 'appearance', pageId: params.pageId });
      else if (event.command === 'view-settings') window.dispatchEvent(new CustomEvent('mini:view-settings', { detail: params }));
      else if (event.command === 'settings') setModal({ type: 'settings', tab: params.tab });
      else if (event.command === 'search') setModal({ type: 'search', query: params.query || '' });
      else if (
        [
          'trash',
          'templates',
          'conflicts',
          'history',
          'operations',
          'inbox',
          'scheduler',
          'repeat',
          'reminder',
        ].includes(event.command)
      )
        setModal({
          type: event.command as
            | 'trash'
            | 'templates'
            | 'conflicts'
            | 'history'
            | 'operations'
            | 'inbox'
            | 'scheduler'
            | 'repeat'
            | 'reminder',
          pageId: params.pageId || page?.id,
          query: params.query,
        });
      else if (event.command === 'close-dialog') {
        window.dispatchEvent(new CustomEvent('mini:calendar-day', { detail: { visible: false } }));
        window.dispatchEvent(new CustomEvent('mini:view-settings', { detail: { visible: false } }));
        setModal(null);
        setPeekId(null);
        setFind(false);
      } else command(event.command);
    });
    const keydown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        if (find) setFind(false);
        else setPeekId(null);
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault();
        command('search');
        return;
      }
      // The hosted bridge has no native MiniNotion menu to dispatch shortcuts.
      if (window.native && !new URLSearchParams(location.search).has('hosted')) return;
      const commands: Record<string, string> = {
        n: 'new-page',
        t: 'new-tab',
        k: 'search',
        ',': 'settings',
        f: 'find',
        '\\': 'sidebar',
        '[': 'back',
        ']': 'forward',
        '1': 'home',
        s: 'save',
      };
      const name = e.shiftKey
        ? ({ l: 'theme', e: 'export', i: 'import', m: 'comment-selection', j: 'selection-agent' } as Record<string, string>)[
            e.key.toLowerCase()
          ]
        : commands[e.key.toLowerCase()];
      if (name) {
        e.preventDefault();
        command(name);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      off?.();
      offUI?.();
      window.removeEventListener('keydown', keydown);
    };
  }, [ws, theme, page?.id, peekId, find, navigation]);

  if (loadError)
    return (
      <div className="startup-state">
        <CircleAlert size={32} />
        <h2>无法读取工作空间</h2>
        <p>{loadError}</p>
        <button className="primary-button" onClick={() => void load()}>
          重试
        </button>
        <button className="text-button" onClick={() => void window.native?.revealData()}>
          打开数据文件夹
        </button>
      </div>
    );
  if (!ws)
    return (
      <div className="startup-state">
        <LoaderCircle className="spin" size={26} />
        <p>正在打开你的空间…</p>
      </div>
    );
  const breadcrumbs = page ? ancestors(ws.pages, page.id) : [];
  const openMenu = (id: string, element: HTMLElement) => {
    const r = element.getBoundingClientRect();
    setPageMenu({ id, x: r.right - 282, y: r.bottom + 5 });
  };

  return (
    <AppearanceTheme.Provider value={theme}><div className={`app-shell ${ws.settings.sidebarHidden ? 'sidebar-hidden' : ''} hosted-folder embedded-plugin`}>
      {!ws.settings.sidebarHidden && <Sidebar />}
      <main className="main-pane">
        <PageTabs />
        <header className="topbar">
          <div className="topbar-left">
            {ws.settings.sidebarHidden && (
              <IconButton label="展开侧边栏 ⌘\\" onClick={() => setting({ sidebarHidden: false })}>
                <PanelLeft size={18} />
              </IconButton>
            )}
            <div className="navigation-buttons">
              <IconButton label="后退 ⌘[" disabled={navigation.index === 0} onClick={() => go(-1)}>
                <ArrowLeft size={16} />
              </IconButton>
              <IconButton
                label="前进 ⌘]"
                disabled={navigation.index >= navigation.items.length - 1}
                onClick={() => go(1)}
              >
                <ArrowRight size={16} />
              </IconButton>
            </div>
            <div className="breadcrumbs">
              {page ? (
                <>
                  {breadcrumbs.slice(-2).map((p) => (
                    <span key={p.id}>
                      <button onClick={() => navigate(p.id)}>
                        <PageIcon icon={p.icon} size={14} />
                        <span>{p.title || '无标题'}</span>
                      </button>
                      <i>/</i>
                    </span>
                  ))}
                  <span className="breadcrumb-current">
                    <PageIcon icon={page.icon} size={15} />
                    <span>{page.title || '无标题'}</span>
                  </span>
                </>
              ) : (
                <span className="breadcrumb-current">
                  <House size={16} />
                  <span>主页</span>
                </span>
              )}
            </div>
          </div>
          <div className="topbar-right">
            <span
              className={`save-status ${saveError ? 'error' : ''}`}
              role="status"
              aria-live="polite"
              title={saveError || '所有修改自动保存在这台 Mac 上'}
            >
              {saveError ? (
                <button onClick={() => (store.conflictId ? setModal({ type: 'conflicts' }) : retrySave())}>
                  <CircleAlert size={14} />
                  {store.conflictId ? '有并发草稿，点击处理' : '保存失败，点击重试'}
                </button>
              ) : saving ? (
                <>
                  <LoaderCircle size={12} className="spin" />
                  保存中
                </>
              ) : (
                <>
                  <Check size={13} />
                  已保存到本机
                </>
              )}
            </span>
            <button
              className="topbar-export"
              data-topbar-tasks="true"
              title={page ? '在当前页面布置定时/重复/事件驱动/督办 Agent 任务' : 'Agent 任务与督办总览'}
              aria-label="任务规划"
              onClick={() =>
                setModal(
                  peekPage || page
                    ? { type: 'page-task-composer', pageId: (peekPage || page)!.id }
                    : { type: 'agent-tasks' },
                )
              }
            >
              <ListTodo size={14} />
              <span>任务规划</span>
            </button>
            <button
              className="topbar-export"
              data-topbar-access="true"
              title="管理 AI 员工页面读写授权"
              aria-label="页面授权"
              onClick={() => setModal({ type: 'access', pageId: (peekPage || page)?.id })}
            >
              <ShieldCheck size={14} />
              <span>授权</span>
            </button>
            {page && (
              <>
                <button
                  className="page-comments-button"
                  title="评论"
                  aria-label="打开页面评论"
                  onClick={() => store.setCommentPanel({ pageId: peekId || page.id })}
                >
                  <MessageSquare size={17} />
                  {(peekPage || page).comments?.filter((thread) => !thread.deletedAt && !thread.resolvedAt)
                    .length || ''}
                </button>
                <IconButton
                  label="设置页面提醒"
                  onClick={() => setModal({ type: 'reminder', pageId: peekId || page.id })}
                >
                  <Bell size={17} />
                </IconButton>
                {page.locked && (
                  <IconButton label="解锁页面" onClick={() => patch(page.id, { locked: false })}>
                    <LockKeyhole size={15} />
                  </IconButton>
                )}
                <button
                  className="topbar-export"
                  aria-label="导出页面"
                  onClick={() => setModal({ type: 'export', pageId: page.id })}
                >
                  <FileOutput size={14} />
                  <span>导出</span>
                </button>
                <IconButton
                  label={page.favorite ? '取消收藏' : '收藏页面'}
                  active={page.favorite}
                  onClick={() => patch(page.id, { favorite: !page.favorite })}
                >
                  <Star size={18} className={page.favorite ? 'favorite-star' : ''} />
                </IconButton>
                <IconButton label="页面更多操作" onClick={(e) => openMenu(page.id, e.currentTarget)}>
                  <MoreHorizontal size={21} />
                </IconButton>
              </>
            )}
          </div>
        </header>
        <Suspense fallback={<LoadingSurface />} key={page?.id || 'home'}>
          {page?.sourceFile && page.sourceFile.kind !== 'directory' ? <FolderDocument key={page.id} page={page} /> : page ? <PageView key={page.id} page={page} theme={theme} /> : <Home />}
        </Suspense>
      </main>
      {peekPage && (
        <div
          className={`peek-overlay ${peekMode === 'center' ? 'center-peek' : ''}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPeekId(null);
          }}
        >
          <div className="peek-panel" role="dialog" aria-label={peekPage.title || '新页面'}>
            <div className="peek-toolbar">
              <IconButton label="关闭预览" onClick={() => setPeekId(null)}>
                <ChevronsRight size={18} />
              </IconButton>
              <IconButton label="以完整页面打开" onClick={() => navigate(peekPage.id)}>
                <Expand size={15} />
              </IconButton>
              <span>{ws.pages.find((p) => p.id === peekPage.parentId)?.title}</span>
              <IconButton label="预览页面更多操作" onClick={(e) => openMenu(peekPage.id, e.currentTarget)}>
                <MoreHorizontal size={20} />
              </IconButton>
            </div>
            <Suspense fallback={<LoadingSurface />}><PageView key={peekPage.id} page={peekPage} theme={theme} peek /></Suspense>
          </div>
        </div>
      )}
      {find && <FindBar pageId={peekId || page?.id} onClose={() => setFind(false)} />}
      {pageMenu && <PageMenu />}
      <Suspense fallback={null}>
      {modal?.type === 'automations' && <Automations />}
      {modal?.type === 'button' && <ButtonEditor />}
      {modal?.type === 'action-history' && <ActionHistory />}
      {modal?.type === 'inbox' && <Inbox />}
      {modal?.type === 'scheduler' && <SchedulerDialog />}
      {modal?.type === 'repeat' && <RepeatDialog />}
      {modal?.type === 'reminder' && <ReminderDialog />}
      {modal?.type === 'search' && <Search />}
      {modal?.type === 'settings' && <Settings />}
      {modal?.type === 'appearance' && <PageAppearanceDialog />}
      {modal?.type === 'templates' && <Templates />}
      {modal?.type === 'trash' && <Trash />}
      {modal?.type === 'help' && <HelpDialog />}
      {modal?.type === 'import' && <ImportDialog />}
      {modal?.type === 'export' && <ExportDialog />}
      {modal?.type === 'move' && <MoveDialog />}
      {modal?.type === 'history' && <HistoryDialog />}
      {modal?.type === 'conflicts' && <Conflicts />}
      {modal?.type === 'operations' && <Operations />}
      {store.commentPanel && <Comments />}
      {modal?.type === 'access' && <NotebookAccessDialog initialPageId={modal.pageId || page?.id} onClose={() => setModal(null)} />}
      {modal?.type === 'agent-tasks' && <AgentTasksHubModal initialPageId={modal.pageId || page?.id} onClose={() => setModal(null)} />}
      {modal?.type === 'page-task-composer' && (
        <AgentTaskComposerModal
          pageId={modal.pageId || page?.id}
          databaseId={modal.databaseId}
          initialTab={modal.taskKind}
          jobId={modal.jobId}
          missionId={modal.missionId}
          initialOnceDate={modal.initialOnceDate}
          initialEnabled={modal.initialEnabled}
          onClose={() => setModal(null)}
        />
      )}
      </Suspense>
      {toast && (
        <div className={`toast${toast.kind === 'error' ? ' toast-error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.kind === 'error' ? <CircleAlert size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                notify('操作已撤销');
              }}
            >
              撤销
            </button>
          )}
        </div>
      )}
    </div></AppearanceTheme.Provider>
  );
}
