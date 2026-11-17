import { installMissionNotebookBridge } from './bridge';
import './folder.css';
import ReactDOM from 'react-dom/client';
import '@blocknote/mantine/style.css';
import App, { ErrorBoundary } from './App';
import { WorkspaceProvider } from './store';
import './styles.css';
import './planning/planning.css';
import './appearance.css';
import './icons.css';
import './notion-local.css';
import './styles/events.css';
import './content/editor-tools.css';
import './styles/themes.css';
import './styles/media.css';
import { preloadNativePage } from './components/loadContent';

installMissionNotebookBridge();

performance.mark('mini:bundle-evaluated');
if (window.native?.startupContent === 'page') preloadNativePage();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </ErrorBoundary>,
);
