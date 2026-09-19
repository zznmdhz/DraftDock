import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardInput, DraftDockApi, ExportDocxInput, GenerateAssetInput, LibrarySnapshot, SaveDraftInput } from '../shared/types'

const api: DraftDockApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseRoot: () => ipcRenderer.invoke('library:choose-root'),
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
  }
}

contextBridge.exposeInMainWorld('draftdock', api)
