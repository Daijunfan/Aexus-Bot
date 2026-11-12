import { useEffect,useRef } from 'react'

/** Keep keyboard focus inside the current overlay and return it to its opener. */
export function useDialogFocus(selector: string, open: boolean, returnFocus?:()=>HTMLElement|null,initialFocus?:string) {
  const restore=useRef(returnFocus);restore.current=returnFocus
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>(selector)
    const activeDialog=()=>[...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(el=>!el.closest('[hidden],[inert],[aria-hidden="true"]')&&getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0).at(-1)
    const topmost=()=>activeDialog()===dialog
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, iframe, [tabindex="0"]') ?? [])]
      .filter((el) => !el.hasAttribute('disabled') && !el.closest('[aria-hidden="true"],[inert],[hidden]') && el.getBoundingClientRect().height > 0)
    // Locate only the initial focus target; avoid measuring every form control.
    const preferred=initialFocus?dialog?.querySelector<HTMLElement>(initialFocus):null
    const first=[...(preferred?[preferred]:[]),...(dialog?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, iframe, [tabindex="0"]')??[])].find(el=>!el.hasAttribute('disabled')&&!el.closest('[aria-hidden="true"],[inert],[hidden]')&&el.getBoundingClientRect().height>0)
    if(topmost())first?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Tab'||event.defaultPrevented||event.isComposing||!topmost()||(event.target as HTMLElement)?.closest('.xterm')) return
      const items = focusable()
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && (index === items.length - 1 || index === -1)) { event.preventDefault(); items[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      const target=restore.current?.()??opener,active=activeDialog()
      if(target?.isConnected&&(!active||active===dialog||active.contains(target)))target.focus({preventScroll:true})
      else if(active&&active!==dialog)active.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')?.focus({preventScroll:true})
    }
  }, [selector, open])
}
