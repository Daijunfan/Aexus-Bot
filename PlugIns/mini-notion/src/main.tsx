import { installPluginBridge } from './plugin/bridge';
import './plugin/folder.css';
import ReactDOM from 'react-dom/client';
import '@blocknote/mantine/style.css';
import App, { ErrorBoundary } from './App';
import { WorkspaceProvider } from './store';
import './styles.css';
import './appearance.css';
import './icons.css';
import './notion-local.css';
import './styles/events.css';
import './content/editor-tools.css';
import './styles/themes.css';
import './styles/media.css';
import { preloadNativePage } from './components/loadContent';

if(new URLSearchParams(location.search).get('hosted')==='1')installPluginBridge();

performance.mark('mini:bundle-evaluated');
// A cached selection hint overlaps editor loading with the verified backend
// snapshot. Home and file previews never pay for the native editor up front.
if (window.native?.startupContent === 'page') preloadNativePage();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </ErrorBoundary>,
);
