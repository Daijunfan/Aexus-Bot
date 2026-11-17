import { translate as uiText, useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

type HostListing = { path: string; entries: { name: string; path: string; directory?: boolean; symlink?: boolean }[] }

/** Cloud directory browsing uses `host.directories` on the selected host. */
export function EmployeeFolderPicker({
  hostId,
  initialPath,
  windows,
  selected,
  onSelect,
  onClose,
}: {
  hostId: string
  initialPath?: string
  windows: boolean
  selected: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  useI18n()

  const [listing, setListing] = useState<HostListing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const container = useRef<HTMLDivElement>(null)

  const join = (base: string, name: string) =>
    base.replace(/[\\/]+$/, '') + (windows ? '\\' : '/') + name.replace(/^[\\/]+/, '')

  const parent = (value: string) => {
    const clean = value.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
    return windows ? (clean.length <= 2 ? clean + '\\' : clean) : clean || '/'
  }

  const browse = async (targetPath?: string) => {
    setBusy(true)
    setError('')
    try {
      const data = await api.call<HostListing>('host.directories', {
        id: hostId,
        ...(targetPath ? { path: targetPath } : {}),
      })
      setListing(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void browse(initialPath || undefined)
  }, [hostId, initialPath])

  useEffect(() => {
    container.current?.scrollIntoView({ block: 'center' })
  }, [])

  const folders = listing?.entries.filter((entry) => !entry.symlink) ?? []
  const currentPath = listing?.path ?? ''

  return (
    <div ref={container} className="employee-directory-picker" aria-label={uiText('Cloud host folders')}>
      <header>
        <strong>
          {uiText('Cloud')} {uiText('Folder')}
        </strong>
        <button type="button" onClick={onClose}>
          {uiText('Done')}
        </button>
      </header>
      <nav>
        <button
          type="button"
          disabled={busy || !currentPath || currentPath === '/' || parent(currentPath) === currentPath}
          onClick={() => void browse(parent(currentPath))}
        >
          {uiText('↑ Parent folder')}
        </button>
        <code title={currentPath}>{currentPath || uiText('Reading…')}</code>
      </nav>
      <div className="employee-directory-list" role="listbox" aria-label={uiText('Choose employee working folder')}>
        {listing && (
          <button
            type="button"
            role="option"
            aria-selected={selected === currentPath}
            className="directory-current"
            onClick={() => onSelect(currentPath)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSelect(currentPath)
                onClose()
              }
            }}
          >
            {uiText('Use current folder')}
          </button>
        )}
        {folders.map((entry) => {
          const full = join(currentPath, entry.name)
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected === full}
              key={entry.path || entry.name}
              onClick={() => onSelect(full)}
              onDoubleClick={() => {
                onSelect(full)
                void browse(full)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSelect(full)
                  onClose()
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  void browse(full)
                }
              }}
            >
              ▱ {entry.name}
            </button>
          )
        })}
        {listing && !folders.length && (
          <small>
            {uiText('No subfolders here.')}
            {uiText('You can choose the current folder.')}
          </small>
        )}
      </div>
      <small>{uiText('Click to select; double-click to enter a subfolder; press Enter to confirm.')}</small>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
