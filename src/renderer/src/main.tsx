import React from 'react'
import {installDesktopQuitNotice} from './desktopQuit'
import { createRoot } from 'react-dom/client'
import App from './App'
import {CollaborationProvider} from './components/ChatQuestions'
import {installTransientScrollbars} from './scrollbars'
import {api} from './api'
import {WebGate} from './web/Gate'
import './web/web.css'
import { installUiInspector } from './uiInspector'
import '@vscode/codicons/dist/codicon.css'
import './styles/base.css'
import './styles/session.css'
import './styles/chat.css'
import "./styles/office.css"
import "./styles/panels.css"
import './styles/canvas.css'
import './styles/pets.css'
import './styles/themes.css'
import './styles/workbench.css'
import './styles/team-views.css'
// Lets the CLI inspect what is on screen, so tests can assert rendering.
document.documentElement.dataset.clientMode=api.mode
installDesktopQuitNotice()
installTransientScrollbars()
installUiInspector((a) => (window as any).agents.answerUi(a))

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {api.mode==='web'?<WebGate><CollaborationProvider><App /></CollaborationProvider></WebGate>:<CollaborationProvider><App /></CollaborationProvider>}
  </React.StrictMode>
)

import './styles/shared.css'
import './styles/company-views.css'
import './styles/messages.css'

import './styles/group-chat.css'
import './styles/messenger.css'
import './styles/message-surface.css'

import './styles/plan.css'
import './styles/audio-playback.css'
import './styles/voice-recorder.css'
import './styles/emoji-picker.css'

import './styles/channels.css'
import './styles/employee-profile.css'
import './styles/message-categories.css'
import './styles/employee-workbench.css'

import './styles/creation-forms.css'
import './styles/message-management.css'

import './styles/plan-controls.css'

import './styles/product-density.css'

import './styles/agent-board.css'

import './styles/workspace-chrome.css'
import './styles/team-layout.css'

import './styles/team-surface.css'

import './styles/board-directory.css'
import './styles/task-composer.css'
import './styles/worker-conversations.css'
import './styles/scrollbars.css'

import './styles/shared-files.css'
import './styles/plan-editor.css'
import './styles/collaboration.css'
import './styles/workspace-design.css'
import './styles/avatar-surfaces.css'

import './styles/disclosure-navigation.css'

import './styles/application-launcher.css'
import './styles/message-navigation.css'
import './styles/mission-workspace.css'

import './styles/plan-view-options.css'
