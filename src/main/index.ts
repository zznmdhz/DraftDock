import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, Menu } from 'electron'
import { createLogger } from './logger'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import sharp from 'sharp'
import { generateDerivedAsset } from './outputs'
import { readImageAsDataUrl, saveDraft, scanLibrary, selectSources, restoreHistory } from './library'
import { exportDeliveryBundle } from './delivery'
import { buildDelivery } from '../shared/platforms'
import type { BundleInput, ClipboardInput, ExportDocxInput, GenerateAssetInput, LibraryMode, LibrarySnapshot, SaveDraftInput } from '../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = createLogger(path.join(app.getPath('userData'), 'logs'))
logger.write('info', 'app.start', { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, packaged: app.isPackaged })
process.on('uncaughtException', (error) => { logger.write('error', 'main.uncaughtException', error); dialog.showErrorBox('稿间运行异常', `${error.message}\n日志：${logger.file}`) })
process.on('unhandledRejection', (error) => logger.write('error', 'main.unhandledRejection', error))
let mainWindow: BrowserWindow | null = null
let contentRoot: string | null = null
let libraryMode: LibraryMode = 'auto'
let closing = false
let closeRequested = false
let closeAction: 'close' | 'reload' = 'close'
let closeTimer: NodeJS.Timeout | null = null
let rendererReady = false
let transitioning = false
let scanGeneration = 0
let requestWindowSave: ((action: 'close' | 'reload') => void) | null = null
let libraryWatcher: FSWatcher | null = null
let watcherTimer: NodeJS.Timeout | null = null

function settingsPath(): string { return path.join(app.getPath('userData'), 'settings.json') }

async function loadSettings(): Promise<void> {
  const developmentRoot = process.env.DRAFTDOCK_CONTENT_ROOT
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as { contentRoot?: string; mode?: LibraryMode }
    if (settings.mode && ['auto', 'package', 'library'].includes(settings.mode)) libraryMode = settings.mode
    if (settings.contentRoot && await fs.stat(settings.contentRoot).then((stat) => stat.isDirectory()).catch(() => false)) contentRoot = settings.contentRoot
  } catch (error) { contentRoot = null; logger.write('warn', 'settings.load', error) }
  if (developmentRoot && await fs.stat(developmentRoot).then((stat) => stat.isDirectory()).catch(() => false)) contentRoot = developmentRoot
}

async function saveSettings(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  const temp = `${settingsPath()}.tmp`
  await fs.writeFile(temp, JSON.stringify({ contentRoot, mode: libraryMode }, null, 2), 'utf8')
  await fs.rename(temp, settingsPath())
}

function assertInsideRoot(targetPath: string): string {
  if (!contentRoot) throw new Error('请先选择内容根目录')
  const resolvedRoot = path.resolve(contentRoot)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('目标路径不在当前内容目录内')
  return resolvedTarget
}

async function currentLibrary(): Promise<LibrarySnapshot> {
  const snapshot = await scanLibrary(contentRoot, libraryMode)
  logger.write('info', 'library.scanned', { articles: snapshot.articles.length, warnings: [...(snapshot.warnings ?? []), ...snapshot.articles.flatMap((article) => article.warnings)] })
  return snapshot
}

async function emitLibrary(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const generation = ++scanGeneration, root = contentRoot
  try {
    const snapshot = await currentLibrary()
    if (generation === scanGeneration && root === contentRoot && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('library:changed', snapshot)
  } catch (error) { logger.write('error', 'library.watch.scan-failed', error) }
}

function startWatcher(): void {
  libraryWatcher?.close(); libraryWatcher = null
  ++scanGeneration
  if (watcherTimer) { clearTimeout(watcherTimer); watcherTimer = null }
  if (!contentRoot) return
  try {
    libraryWatcher = watch(contentRoot, { recursive: true }, (_event, filename) => {
      if (!filename || filename.includes('.draftdock')) return
      if (watcherTimer) clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => void emitLibrary(), 450)
    })
    libraryWatcher.on('error', (error) => logger.write('error', 'watcher.error', error))
  } catch (error) { libraryWatcher = null; logger.write('error', 'watcher.start', error) }
}

function markdownParagraphs(markdown: string): Paragraph[] {
  return markdown.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    if (line.startsWith('# ')) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.TITLE })
    if (line.startsWith('## ')) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1 })
    if (line.startsWith('### ')) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_2 })
    const numbered = line.match(/^\d+\.\s+(.+)/)
    if (numbered) return new Paragraph({ text: numbered[1], numbering: { reference: 'draftdock-numbering', level: 0 } })
    const bullet = line.match(/^[-*]\s+(.+)/)
    if (bullet) return new Paragraph({ text: bullet[1], bullet: { level: 0 } })
    return new Paragraph({ children: [new TextRun(line.replace(/^>\s?/, '').replace(/\*\*/g, '').replace(/`/g, ''))] })
  })
}

async function exportDocx(input: ExportDocxInput): Promise<string | null> {
  assertInsideRoot(input.articleFolder)
  const children = markdownParagraphs(input.markdown)
  if (input.title.trim() && !input.markdown.trimStart().startsWith(`# ${input.title.trim()}`)) children.unshift(new Paragraph({ text: input.title.trim(), heading: HeadingLevel.TITLE }))
  for (const candidate of input.imagePaths) {
    const imagePath = assertInsideRoot(candidate)
    try {
      const image = sharp(imagePath, { animated: false }).rotate()
      const metadata = await image.metadata()
      const rotated = metadata.orientation && metadata.orientation >= 5
      const sourceWidth = (rotated ? metadata.height : metadata.width) ?? 600
      const sourceHeight = (rotated ? metadata.width : metadata.height) ?? 400
      const scale = Math.min(1, 600 / sourceWidth, 750 / sourceHeight)
      const width = Math.round(sourceWidth * scale), height = Math.round(sourceHeight * scale)
      const data = await image.png().toBuffer()
      children.push(new Paragraph({ children: [new ImageRun({ data, transformation: { width, height }, type: 'png' })] }))
    } catch (error) { logger.write('error', 'docx.image.failed', error); throw new Error(`图片读取失败，未导出文档：${path.basename(imagePath)}`) }
  }
  const document = new Document({
    numbering: { config: [{ reference: 'draftdock-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'start' }] }] },
    sections: [{ properties: {}, children }]
  })
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出 Word 文档', defaultPath: path.join(input.articleFolder, `${input.suggestedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100)}.docx`),
    filters: [{ name: 'Word 文档', extensions: ['docx'] }]
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, await Packer.toBuffer(document))
  return result.filePath
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1580, height: 980, minWidth: 1180, minHeight: 720,
    backgroundColor: '#0d111b', title: '稿间 DraftDock', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true
    }
  })
  const contents = mainWindow.webContents
  const cancelTransition = () => { transitioning = false; closeRequested = false; if (closeTimer) { clearTimeout(closeTimer); closeTimer = null } }
  const requestSave = (action: 'close' | 'reload') => {
    if (closeRequested || closing || transitioning) return
    if (!rendererReady) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning', title: '页面尚未就绪',
        message: action === 'reload' ? '页面无法确认未保存的内容。是否直接重新加载？' : '页面无法确认未保存的内容。是否直接关闭？',
        detail: '已保存的工作稿不会删除，尚未落盘的输入可能丢失。可取消后查看诊断日志。',
        buttons: [action === 'reload' ? '重新加载' : '关闭', '取消'], defaultId: 1, cancelId: 1
      })
      if (choice === 0) { if (action === 'reload') { transitioning = true; contents.reload() } else { closing = true; mainWindow?.destroy() } }
      return
    }
    closeAction = action
    closeRequested = true
    logger.write('info', 'app.save-requested', { action })
    contents.send('app:before-close')
    closeTimer = setTimeout(() => {
      if (!closeRequested || closing) return
      closeRequested = false
      logger.write('warn', 'app.save-timeout', { action })
      dialog.showErrorBox('保存尚未完成', '页面未完成保存确认。请先点击保存，或使用帮助菜单查看日志。')
    }, 30000)
  }
  requestWindowSave = requestSave
  contents.on('will-prevent-unload', event => { if (transitioning || closing) event.preventDefault() })
  mainWindow.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    requestSave('close')
  })
  contents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { event.preventDefault(); if (input.type === 'keyDown') requestSave('reload') }
  })
  contents.on('preload-error', (_event, preloadPath, error) => { rendererReady = false; logger.write('error', 'preload.error', { preloadPath, error }); dialog.showErrorBox('启动失败', `桌面接口加载失败。\n日志：${logger.file}`) })
  contents.on('console-message', (_event, level, message, line, source) => logger.write(level >= 3 ? 'error' : 'info', 'renderer.console', { message, line, source }))
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    logger.write('error', 'window.load.failed', { code, description, url, isMainFrame })
    if (isMainFrame && code !== -3) { rendererReady = false; cancelTransition(); dialog.showErrorBox('页面加载失败', `${description}\n日志：${logger.file}`) }
  })
  contents.on('render-process-gone', (_event, details) => { rendererReady = false; cancelTransition(); logger.write('error', 'renderer.gone', details); dialog.showErrorBox('页面进程已退出', `请通过帮助菜单重新加载。\n日志：${logger.file}`) })
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) rendererReady = false })
  mainWindow.on('unresponsive', () => logger.write('warn', 'window.unresponsive'))
  contents.on('did-finish-load', () => { transitioning = false; logger.write('info', 'window.loaded') })
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '帮助', submenu: [
    { label: '打开日志文件夹', click: () => { void shell.openPath(logger.directory) } },
    { label: '保存后重新加载页面', accelerator: 'CmdOrCtrl+R', click: () => requestSave('reload') },
    { label: '开发者工具', role: 'toggleDevTools' }
  ] }]))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => { event.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url) })
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const started = Date.now()
      logger.write('info', 'ipc.start', { channel })
      try {
        const result = await listener(event, ...args)
        logger.write('info', 'ipc.success', { channel, elapsedMs: Date.now() - started })
        return result
      } catch (error) { logger.write('error', 'ipc.failed', { channel, elapsedMs: Date.now() - started, error }); throw error }
    })
  }
  handle('diagnostics:open', () => shell.openPath(logger.directory))
  ipcMain.on('diagnostics:report', (_event, input) => {
    if (input?.event === 'ready') rendererReady = true
    if (input?.event === 'react.crash') rendererReady = false
    if (input && typeof input.event === 'string') logger.write(input.level === 'error' ? 'error' : 'info', `renderer.${input.event.slice(0, 100)}`, String(input.message ?? '').slice(0, 8000))
  })
  handle('library:get', () => currentLibrary())
  handle('delivery:export', async (_event, input: BundleInput) => {
    input.articleFolder = assertInsideRoot(input.articleFolder)
    const result = await exportDeliveryBundle(input)
    logger.write('info', 'delivery.exported', { platform: input.platform, imageCount: result.imageCount })
    return result
  })
  handle('history:restore', async (_event, folder: string, id: string) => { await restoreHistory(assertInsideRoot(folder), id); return currentLibrary() })
  ipcMain.on('app:request-close', () => requestWindowSave?.('close'))
  ipcMain.on('app:request-reload', () => requestWindowSave?.('reload'))
  ipcMain.on('app:close-ready', (_event, error?: string) => {
    if (!closeRequested) return
    closeRequested = false
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    if (error) { logger.write('error', 'app.close.save-failed', error); dialog.showErrorBox('保存失败，已取消关闭', '请检查错误提示并重试保存。'); return }
    transitioning = true
    logger.write('info', 'app.save-confirmed', { action: closeAction })
    mainWindow?.webContents.send('app:allow-unload')
    // Permit the already-confirmed transition even if the IPC signal is delivered
    // after Chromium begins beforeunload. Never grant this when saving failed.
    if (closeAction === 'reload') { mainWindow?.webContents.reload(); return }
    closing = true
    mainWindow?.close()
  })
  handle('sources:select', async (_event, folder: string, paths: string[]) => {
    await selectSources(assertInsideRoot(folder), paths.map(file => assertInsideRoot(file)))
    return currentLibrary()
  })
  handle('library:choose-root', async (_event, mode: LibraryMode = 'auto') => {
    if (!['auto', 'package', 'library'].includes(mode)) throw new Error('无效的目录模式')
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择内容根目录', properties: ['openDirectory', 'createDirectory'] })
    if (!result.canceled && result.filePaths[0]) { contentRoot = result.filePaths[0]; libraryMode = mode; await saveSettings(); startWatcher() }
    return currentLibrary()
  })
  handle('library:refresh', () => currentLibrary())
  handle('image:load', (_event, filePath: string) => readImageAsDataUrl(assertInsideRoot(filePath)))
  handle('asset:generate', async (_event, input: GenerateAssetInput) => {
    input.articleFolder = assertInsideRoot(input.articleFolder)
    input.sourcePath = assertInsideRoot(input.sourcePath)
    const result = await generateDerivedAsset(input)
    await emitLibrary()
    return result
  })
  handle('draft:save', (_event, input: SaveDraftInput) => saveDraft(assertInsideRoot(input.articleFolder), input.platform, input.title, input.markdown, input.details))
  handle('clipboard:write', async (_event, input: ClipboardInput) => {
    if (input.mode === 'markdown') return clipboard.writeText(input.markdown)
    if (input.mode === 'plain') return clipboard.writeText(input.markdown)
    const plain = buildDelivery('xiaohongshu', '', input.markdown).plain
    const html = sanitizeHtml(await marked.parse(input.markdown), {
      allowedTags: ['h1','h2','h3','h4','p','strong','em','blockquote','ul','ol','li','a','code','pre','br','hr','table','thead','tbody','tr','th','td'],
      allowedAttributes: { a: ['href','title'] }, allowedSchemes: ['http','https','mailto']
    })
    clipboard.write({ text: plain, html })
  })
  handle('docx:export', (_event, input: ExportDocxInput) => exportDocx(input))
  handle('path:open', (_event, target: string) => shell.openPath(assertInsideRoot(target)))
  handle('path:reveal', (_event, target: string) => { shell.showItemInFolder(assertInsideRoot(target)) })
  ipcMain.on('asset:start-drag', (event, target: string) => {
    try {
    const filePath = assertInsideRoot(target)
    const icon = nativeImage.createFromPath(filePath).resize({ width: 96, height: 96 })
    event.sender.startDrag({ file: filePath, icon })
    logger.write('info', 'asset.drag.started')
    } catch (error) { logger.write('error', 'asset.drag.failed', error) }
  })
}

app.whenReady().then(async () => {
  await loadSettings(); registerIpc(); startWatcher(); await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { libraryWatcher?.close(); logger.write('info', 'app.quit') })
