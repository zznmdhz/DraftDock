import { contextBridge, ipcRenderer } from 'electron'
// A renderer-initiated window.close() can begin unloading before BrowserWindow's
// close event is intercepted. Keep this page alive until its drafts are saved.
let allowUnload = false
ipcRenderer.on('app:allow-unload', () => { allowUnload = true })
window.addEventListener('beforeunload', event => {
  if (allowUnload) return
  event.preventDefault()
  event.returnValue = false as unknown as string
  ipcRenderer.send('app:request-close')
})
import type { ClipboardInput, DraftDockApi, ExportDocxInput, GenerateAssetInput, LibrarySnapshot, SaveDraftInput } from '../shared/types'

const api: DraftDockApi = {
  requestReload: () => ipcRenderer.send('app:request-reload'),
  exportBundle: (input) => ipcRenderer.invoke('delivery:export', input),
  restoreHistory: (folder, id) => ipcRenderer.invoke('history:restore', folder, id),
  selectSources: (folder, paths) => ipcRenderer.invoke('sources:select', folder, paths),
  openLogs: () => ipcRenderer.invoke('diagnostics:open'),
  report: (input) => ipcRenderer.send('diagnostics:report', input),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseRoot: (mode) => ipcRenderer.invoke('library:choose-root', mode),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
  loadImage: (path: string) => ipcRenderer.invoke('image:load', path),
  generateAsset: (input: GenerateAssetInput) => ipcRenderer.invoke('asset:generate', input),
  saveDraft: (input: SaveDraftInput) => ipcRenderer.invoke('draft:save', input),
  writeClipboard: (input: ClipboardInput) => ipcRenderer.invoke('clipboard:write', input),
  exportDocx: (input: ExportDocxInput) => ipcRenderer.invoke('docx:export', input),
  openPath: (path: string) => ipcRenderer.invoke('path:open', path),
  revealPath: (path: string) => ipcRenderer.invoke('path:reveal', path),
  startDrag: (path: string) => ipcRenderer.send('asset:start-drag', path),
  onLibraryChanged: (callback: (snapshot: LibrarySnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: LibrarySnapshot): void => callback(snapshot)
    ipcRenderer.on('library:changed', handler)
    return () => ipcRenderer.removeListener('library:changed', handler)
  },
  onBeforeClose: (callback) => {
    const handler = () => { void callback().then(() => ipcRenderer.send('app:close-ready')).catch(error => ipcRenderer.send('app:close-ready', String(error))) }
    ipcRenderer.on('app:before-close', handler)
    return () => ipcRenderer.removeListener('app:before-close', handler)
  }
}

contextBridge.exposeInMainWorld('draftdock', api)
