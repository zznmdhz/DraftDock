import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import sharp from 'sharp'
import { generateDerivedAsset } from './outputs'
import { readImageAsDataUrl, saveDraft, scanLibrary } from './library'
import type { ClipboardInput, ExportDocxInput, GenerateAssetInput, LibrarySnapshot, SaveDraftInput } from '../shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let contentRoot: string | null = null
let libraryWatcher: FSWatcher | null = null
let watcherTimer: NodeJS.Timeout | null = null

function settingsPath(): string { return path.join(app.getPath('userData'), 'settings.json') }

async function loadSettings(): Promise<void> {
  const developmentRoot = process.env.DRAFTDOCK_CONTENT_ROOT
  if (developmentRoot && await fs.stat(developmentRoot).then((stat) => stat.isDirectory()).catch(() => false)) {
    contentRoot = developmentRoot
    return
  }
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as { contentRoot?: string }
    if (settings.contentRoot && await fs.stat(settings.contentRoot).then((stat) => stat.isDirectory()).catch(() => false)) contentRoot = settings.contentRoot
  } catch { contentRoot = null }
}

async function saveSettings(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  const temp = `${settingsPath()}.tmp`
  await fs.writeFile(temp, JSON.stringify({ contentRoot }, null, 2), 'utf8')
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

async function currentLibrary(): Promise<LibrarySnapshot> { return scanLibrary(contentRoot) }

async function emitLibrary(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('library:changed', await currentLibrary())
}

function startWatcher(): void {
  libraryWatcher?.close(); libraryWatcher = null
  if (!contentRoot) return
  try {
    libraryWatcher = watch(contentRoot, { recursive: true }, (_event, filename) => {
      if (!filename || filename.includes('.draftdock')) return
      if (watcherTimer) clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => void emitLibrary(), 450)
    })
  } catch { libraryWatcher = null }
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
  for (const candidate of input.imagePaths.slice(0, 20)) {
    const imagePath = assertInsideRoot(candidate)
    try {
      const image = sharp(imagePath, { animated: false }).rotate()
      const metadata = await image.metadata()
      const width = Math.min(720, metadata.width ?? 720)
      const height = Math.round(width * (metadata.height ?? 480) / (metadata.width ?? 720))
      const data = await image.png().toBuffer()
      children.push(new Paragraph({ children: [new ImageRun({ data, transformation: { width, height }, type: 'png' })] }))
    } catch { /* Keep the document export usable when one image is unsupported. */ }
  }
  const document = new Document({
    numbering: { config: [{ reference: 'draftdock-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'start' }] }] },
    sections: [{ properties: {}, children }]
  })
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出 Word 文档', defaultPath: path.join(input.articleFolder, `${input.suggestedName}.docx`),
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
      preload: path.join(__dirname, '../preload/index.mjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('library:get', () => currentLibrary())
  ipcMain.handle('library:choose-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择内容根目录', properties: ['openDirectory', 'createDirectory'] })
    if (!result.canceled && result.filePaths[0]) { contentRoot = result.filePaths[0]; await saveSettings(); startWatcher() }
    return currentLibrary()
  })
  ipcMain.handle('library:refresh', () => currentLibrary())
  ipcMain.handle('image:load', (_event, filePath: string) => readImageAsDataUrl(assertInsideRoot(filePath)))
  ipcMain.handle('asset:generate', async (_event, input: GenerateAssetInput) => {
    input.articleFolder = assertInsideRoot(input.articleFolder)
    input.sourcePath = assertInsideRoot(input.sourcePath)
    const result = await generateDerivedAsset(input)
    await emitLibrary()
    return result
  })
  ipcMain.handle('draft:save', (_event, input: SaveDraftInput) => saveDraft(assertInsideRoot(input.articleFolder), input.platform, input.title, input.markdown))
  ipcMain.handle('clipboard:write', async (_event, input: ClipboardInput) => {
    if (input.mode === 'markdown') return clipboard.writeText(input.markdown)
    const plain = input.markdown.replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__|`/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    if (input.mode === 'plain') return clipboard.writeText(plain)
    const html = sanitizeHtml(await marked.parse(input.markdown), {
      allowedTags: ['h1','h2','h3','h4','p','strong','em','blockquote','ul','ol','li','a','code','pre','br','hr'],
      allowedAttributes: { a: ['href','title'] }, allowedSchemes: ['http','https','mailto']
    })
    clipboard.write({ text: plain, html })
  })
  ipcMain.handle('docx:export', (_event, input: ExportDocxInput) => exportDocx(input))
  ipcMain.handle('path:open', (_event, target: string) => shell.openPath(assertInsideRoot(target)))
  ipcMain.handle('path:reveal', (_event, target: string) => { shell.showItemInFolder(assertInsideRoot(target)) })
  ipcMain.on('asset:start-drag', (event, target: string) => {
    const filePath = assertInsideRoot(target)
    const icon = nativeImage.createFromPath(filePath).resize({ width: 96, height: 96 })
    event.sender.startDrag({ file: filePath, icon })
  })
}

app.whenReady().then(async () => {
  await loadSettings(); registerIpc(); startWatcher(); await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => libraryWatcher?.close())
