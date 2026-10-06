import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { adaptBody, PLATFORM_IDS } from '../shared/platforms'
import type { ArticleRecord, DerivedAsset, DraftHistory, LibraryMode, LibrarySnapshot, Platform, PlatformDraft } from '../shared/types'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tif', '.tiff', '.avif'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const ignored = (name: string): boolean => name.startsWith('.') || name === 'node_modules'
const idFor = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 16)

async function collectFiles(folder: string, warnings: string[] = []): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(folder, { withFileTypes: true })
  for (const entry of entries.filter(e => !ignored(e.name))) {
    const full = path.join(folder, entry.name)
    if (entry.isFile()) files.push(full)
    else if (entry.isDirectory()) {
      try { files.push(...await collectFiles(full, warnings)) }
      catch (error) { warnings.push(`无法读取子目录 ${entry.name}：${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  return files.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

interface ArticleState {
  version?: number
  drafts?: ArticleRecord['drafts']
  selectedSources?: string[]
  sourceRevision?: string
  sourceFingerprint?: string
  history?: DraftHistory[]
}

async function storageFile(folder: string, name: string, create = false): Promise<string> {
  const realFolder = await fs.realpath(folder)
  const directory = path.join(folder, '.draftdock')
  const assertContained = async (target: string): Promise<void> => {
    const resolved = await fs.realpath(target), relative = path.relative(realFolder, resolved)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('保存记录越过文章目录边界，原文件已保留')
  }
  let directoryStats = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (!directoryStats && create) {
    // Only create this one level under the verified article; never follow recursive missing paths.
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error })
    directoryStats = await fs.lstat(directory)
  }
  if (directoryStats) {
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) throw new Error('保存目录不能是链接或文件，原文件已保留')
    await assertContained(directory)
  }
  const file = path.join(directory, name)
  const stats = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (stats) {
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('保存记录不能是链接或目录，原文件已保留')
    await assertContained(file)
  }
  return file
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function validDraft(value: unknown): boolean {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.markdown !== 'string') return false
  for (const key of ['updatedAt', 'account', 'publishedUrl', 'notes']) if (value[key] !== undefined && typeof value[key] !== 'string') return false
  if (value.status !== undefined && !['draft', 'ready', 'published'].includes(value.status as string)) return false
  if (value.images !== undefined && (!Array.isArray(value.images) || value.images.some(image => !isRecord(image) || typeof image.sourcePath !== 'string' || (image.outputPath !== undefined && typeof image.outputPath !== 'string')))) return false
  if (value.limits !== undefined && (!isRecord(value.limits) || Object.values(value.limits).some(limit => limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0)))) return false
  return true
}

function validDerivative(value: unknown): value is DerivedAsset {
  return isRecord(value) && typeof value.id === 'string' && !!value.id && typeof value.sourcePath === 'string' &&
    typeof value.outputPath === 'string' && path.isAbsolute(value.outputPath) && typeof value.presetId === 'string' &&
    PLATFORM_IDS.includes(value.platform as DerivedAsset['platform']) && ['cover', 'contain'].includes(value.mode as string) &&
    Number.isInteger(value.width) && (value.width as number) > 0 && Number.isInteger(value.height) && (value.height as number) > 0 &&
    typeof value.createdAt === 'string'
}

async function availableDerivatives(folder: string, records: unknown[], warnings: string[]): Promise<DerivedAsset[]> {
  const realFolder = await fs.realpath(folder), valid: DerivedAsset[] = []
  const inside = (candidate: string): boolean => { const relative = path.relative(realFolder, candidate); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
  const sourcePaths = new Map<string, Promise<string>>()
  for (const [index, item] of records.entries()) {
    if (!validDerivative(item)) { warnings.push(`交付图记录 ${index + 1} 格式无效，已隐藏；原记录保留`); continue }
    try {
      const resolved = await fs.realpath(item.outputPath)
      if (!inside(resolved) || !(await fs.stat(resolved)).isFile()) throw new Error('文件越界或不是有效文件')
      let source = sourcePaths.get(item.sourcePath)
      if (!source) { source = fs.realpath(item.sourcePath); sourcePaths.set(item.sourcePath, source) }
      const canonicalSource = await source
      if (!inside(canonicalSource)) throw new Error('图片来源越过文章目录')
      // Resolve aliases for matching only. The manifest remains unchanged on disk.
      valid.push({ ...item, sourcePath: canonicalSource })
    } catch { warnings.push(`交付图已失效或不在文章目录内：${path.basename(item.outputPath)}，原记录保留`) }
  }
  return valid
}

function validateState(state: ArticleState): void {
  const sourcesValid = (sources: unknown): boolean => sources === undefined || (Array.isArray(sources) && sources.every(item => typeof item === 'string'))
  const draftsValid = (drafts: unknown): boolean => drafts === undefined || (isRecord(drafts) && Object.values(drafts).every(validDraft))
  if (!isRecord(state) || !draftsValid(state.drafts) || !sourcesValid(state.selectedSources) ||
    (state.sourceRevision !== undefined && typeof state.sourceRevision !== 'string') ||
    (state.sourceFingerprint !== undefined && typeof state.sourceFingerprint !== 'string') ||
    (state.history !== undefined && (!Array.isArray(state.history) || state.history.some(item => !isRecord(item) || typeof item.savedAt !== 'string' || !isRecord(item.drafts) || !draftsValid(item.drafts) || !sourcesValid(item.selectedSources))))) {
    throw new Error('保存记录格式损坏，原文件已保留，请检查 state.json')
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error(`无法读取保存记录 ${file}，原文件已保留：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readState(folder: string): Promise<ArticleState> {
  const state = await readJson<ArticleState>(await storageFile(folder, 'state.json'), {})
  validateState(state)
  return state
}

const stateQueues = new Map<string, Promise<void>>()
function updateState(folder: string, update: (state: ArticleState) => void | Promise<void>): Promise<void> {
  const previous = stateQueues.get(folder) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const state = await readState(folder)
    await update(state)
    state.version = 2
    validateState(state)
    const file = await storageFile(folder, 'state.json', true)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' })
      await storageFile(folder, 'state.json')
      await fs.rename(temporary, file)
    } finally { await fs.unlink(temporary).catch(() => {}) }
  })
  stateQueues.set(folder, next)
  void next.finally(() => { if (stateQueues.get(folder) === next) stateQueues.delete(folder) }).catch(() => {})
  return next
}

async function resolveSources(folder: string, available: string[], requested: string[]): Promise<{ sources: string[]; missingSources: boolean }> {
  const realFolder = await fs.realpath(folder)
  const key = (candidate: string): string => process.platform === 'win32' ? candidate.toLowerCase() : candidate
  const canonical = new Map<string, string>()
  for (const file of available) {
    try {
      const resolved = await fs.realpath(file), relative = path.relative(realFolder, resolved)
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) canonical.set(key(resolved), file)
    } catch { /* A source removed during scanning is not a selectable source. */ }
  }
  const sources: string[] = []
  let missingSources = false
  for (const candidate of requested) {
    let selected: string | undefined
    try { selected = canonical.get(key(await fs.realpath(candidate))) } catch { /* Report it as missing below. */ }
    if (!selected) missingSources = true
    else if (!sources.includes(selected)) sources.push(selected)
  }
  return { sources, missingSources }
}

async function loadSource(folder: string, files: string[], storedSources?: string[]): Promise<{ sources: string[]; markdown: string; fingerprint: string; missingSources: boolean }> {
  const available = files.filter(file => MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase()))
  const { sources, missingSources } = await resolveSources(folder, available, storedSources ?? available.slice(0, 1))
  const contents = await Promise.all(sources.map(file => fs.readFile(file, 'utf8').then(text => text.replace(/^\uFEFF/, ''))))
  return { sources, missingSources, markdown: contents.join('\n\n'), fingerprint: createHash('sha256').update(JSON.stringify(sources.map((file, i) => [file, contents[i]]))).digest('hex') }
}

function titleFromMarkdown(markdown: string, folderName: string): string {
  const recommended = markdown.match(/^#{1,6}\s+推荐标题\s*\r?\n+([^\r\n]+)/m)?.[1]?.replace(/\*\*/g, '').trim()
  return recommended || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || folderName.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]?/, '').replace(/[-_]+/g, ' ').trim() || folderName
}

export function adaptMarkdown(markdown: string, platform: 'wechat' | 'xiaohongshu'): string {
  return platform === 'wechat' ? markdown.trim() : adaptBody(markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'), platform)
}

function defaultDraft(title: string, markdown: string, platform: Platform, parseTemplate = true): PlatformDraft {
  const body = markdown.match(/^#\s+正文[^\r\n]*\r?\n([\s\S]*?)(?=^#\s|$(?![\s\S]))/m)?.[1]?.trim()
  const tags = markdown.match(/^#\s+话题标签[^\r\n]*\r?\n([\s\S]*?)(?=^#\s|$(?![\s\S]))/m)?.[1]?.trim()
  const publishingText = parseTemplate && platform !== 'master' && body ? [body, platform === 'xiaohongshu' ? tags : ''].filter(Boolean).join('\n\n') : markdown
  return { title: platform === 'x' ? '' : title, markdown: publishingText.trim(), updatedAt: new Date().toISOString() }
}

function completeDrafts(folder: string, state: ArticleState, source: Awaited<ReturnType<typeof loadSource>>): ArticleRecord['drafts'] {
  const title = titleFromMarkdown(source.markdown, path.basename(folder))
  return Object.fromEntries((['master', ...PLATFORM_IDS] as Platform[]).map(platform => [platform, state.drafts?.[platform] ?? defaultDraft(title, source.markdown, platform, source.sources.length === 1)]))
}

function archiveDrafts(state: ArticleState, drafts: ArticleRecord['drafts'], sources: string[]): void {
  state.history = [...(state.history ?? []), { id: randomUUID(), savedAt: new Date().toISOString(), drafts: structuredClone(drafts), selectedSources: [...sources] }].slice(-50)
}

export async function selectSources(folder: string, sources: string[]): Promise<void> {
  const files = await collectFiles(folder)
  const resolved = await resolveSources(folder, files.filter(file => MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase())), sources)
  if (!resolved.sources.length || resolved.missingSources) throw new Error('请选择文章目录中的 MD 或 TXT 文件')
  await updateState(folder, async state => {
    const current = await loadSource(folder, files, state.selectedSources)
    archiveDrafts(state, completeDrafts(folder, state, current), current.sources)
    const next = await loadSource(folder, files, resolved.sources)
    state.selectedSources = next.sources
    state.sourceFingerprint = next.fingerprint
    state.sourceRevision = randomUUID()
    state.drafts = completeDrafts(folder, {}, next)
  })
}

export async function restoreHistory(folder: string, id: string): Promise<void> {
  await updateState(folder, async state => {
    const record = state.history?.find((item, index) => (item.id || `legacy-${index}-${item.savedAt}`) === id)
    if (!record || !record.drafts || typeof record.drafts !== 'object') throw new Error('未找到可恢复的历史稿件')
    const files = await collectFiles(folder), current = await loadSource(folder, files, state.selectedSources)
    archiveDrafts(state, completeDrafts(folder, state, current), current.sources)
    const restored = await loadSource(folder, files, record.selectedSources)
    state.selectedSources = restored.sources
    state.sourceFingerprint = restored.fingerprint
    state.sourceRevision = randomUUID()
    state.drafts = structuredClone(record.drafts)
  })
}

type Thumbnail = { dataUrl: string; width: number | null; height: number | null; format: string | null }
const thumbnailCache = new Map<string, { signature: string; result: Promise<Thumbnail> }>()
let thumbnailActive = 0
const thumbnailWaiters: (() => void)[] = []
async function thumbnailSlot<T>(action: () => Promise<T>): Promise<T> {
  if (thumbnailActive >= 4) await new Promise<void>(resolve => thumbnailWaiters.push(resolve))
  else thumbnailActive++
  try { return await action() }
  finally { const waiting = thumbnailWaiters.shift(); if (waiting) waiting(); else thumbnailActive-- }
}
async function makeThumbnail(file: string, extension: string, signature: string): Promise<Thumbnail> {
  const cached = thumbnailCache.get(file)
  if (cached?.signature === signature) return cached.result
  const result = thumbnailSlot(async () => {
    try {
      const image = sharp(file, { animated: false, density: extension === '.svg' ? 144 : undefined }).rotate()
      const metadata = await image.metadata()
      const buffer = await image.resize({ width: 420, height: 300, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
      const rotated = metadata.orientation && metadata.orientation >= 5
      return { dataUrl: `data:image/webp;base64,${buffer.toString('base64')}`, width: (rotated ? metadata.height : metadata.width) ?? null, height: (rotated ? metadata.width : metadata.height) ?? null, format: metadata.format ?? null }
    } catch { return { dataUrl: '', width: null, height: null, format: extension.slice(1) || null } }
  })
  thumbnailCache.delete(file)
  thumbnailCache.set(file, { signature, result })
  if (thumbnailCache.size > 256) thumbnailCache.delete(thumbnailCache.keys().next().value!)
  return result
}

async function scanArticle(folderPath: string): Promise<ArticleRecord | null> {
  const warnings: string[] = [], folderName = path.basename(folderPath)
  const files = await collectFiles(folderPath, warnings)
  const markdownFiles = files.filter(file => MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase()))
  const imageFiles = files.filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  if (!markdownFiles.length && !imageFiles.length) return null
  let storedState: ArticleState = {}
  try { storedState = await readState(folderPath) } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)) }
  if (!markdownFiles.length) warnings.push('未找到 MD / TXT 正文，请检查文件位置')
  const source = await loadSource(folderPath, files, storedState.selectedSources)
  if (source.missingSources) warnings.push('部分已选正文文件已移动或删除，请重新选择来源')
  const sourceChanged = !!storedState.sourceFingerprint && storedState.sourceFingerprint !== source.fingerprint
  if (sourceChanged) warnings.push('正文来源内容已变化，当前平台草稿已保留；请检查来源并应用以重新派生，旧稿会归档')
  const folderStats = await fs.stat(folderPath)
  let derivatives: DerivedAsset[] = []
  try {
    const manifest = await readJson<{ assets?: DerivedAsset[] }>(await storageFile(folderPath, 'manifest.json'), {})
    if (manifest.assets !== undefined && !Array.isArray(manifest.assets)) throw new Error('交付图记录格式损坏')
    derivatives = await availableDerivatives(folderPath, manifest.assets ?? [], warnings)
  } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)) }
  const images = (await Promise.all(imageFiles.map(async filePath => {
    const name = path.relative(folderPath, filePath), extension = path.extname(filePath).toLowerCase()
    try {
      const stats = await fs.stat(filePath), canonicalPath = await fs.realpath(filePath), thumb = await makeThumbnail(filePath, extension, `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`)
      if (!thumb.dataUrl) warnings.push(`无法读取图片：${name}`)
      return { id: idFor(filePath), name, path: filePath, extension, width: thumb.width, height: thumb.height, format: thumb.format, size: stats.size, thumbnailDataUrl: thumb.dataUrl, derivatives: derivatives.filter(item => item.sourcePath === canonicalPath) }
    } catch { warnings.push(`图片已移动或无法读取：${name}`); return null }
  }))).filter((image): image is NonNullable<typeof image> => image !== null)
  return {
    id: idFor(folderPath), title: titleFromMarkdown(source.markdown, folderName), folderName, folderPath,
    markdownPath: source.sources[0] ?? null, markdown: source.markdown,
    sourceFiles: markdownFiles.map(file => ({ path: file, name: path.relative(folderPath, file) })), selectedSources: source.sources,
    sourceRevision: storedState.sourceRevision ?? '', modifiedAt: folderStats.mtime.toISOString(), images,
    drafts: completeDrafts(folderPath, storedState, source), warnings, sourceChanged,
    history: (storedState.history ?? []).filter(item => item && typeof item.savedAt === 'string' && item.drafts && typeof item.drafts === 'object').map((item, index) => ({ ...item, id: item.id || `legacy-${index}-${item.savedAt}` }))
  }
}

export async function scanLibrary(rootPath: string | null, mode: LibraryMode = 'auto'): Promise<LibrarySnapshot> {
  const warnings: string[] = []
  if (!rootPath) return { rootPath: null, articles: [], scannedAt: new Date().toISOString(), mode, warnings }
  async function discover(folder: string): Promise<ArticleRecord[]> {
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true })
      if (entries.some(e => e.isFile() && (MARKDOWN_EXTENSIONS.has(path.extname(e.name).toLowerCase()) || IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())))) {
        const article = await scanArticle(folder)
        return article ? [article] : []
      }
      const articles: ArticleRecord[] = []
      for (const entry of entries.filter(e => e.isDirectory() && !ignored(e.name))) articles.push(...await discover(path.join(folder, entry.name)))
      return articles
    } catch (error) { warnings.push(`无法扫描目录 ${folder}：${error instanceof Error ? error.message : String(error)}`); return [] }
  }
  let articles: ArticleRecord[] = []
  if (mode === 'package') {
    try { const article = await scanArticle(rootPath); if (article) articles.push(article) }
    catch (error) { warnings.push(`无法扫描内容包：${error instanceof Error ? error.message : String(error)}`) }
  } else if (mode === 'library') {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true })
      for (const entry of entries.filter(e => e.isDirectory() && !ignored(e.name))) articles.push(...await discover(path.join(rootPath, entry.name)))
    } catch (error) { warnings.push(`无法读取文章库：${error instanceof Error ? error.message : String(error)}`) }
  } else articles = await discover(rootPath)
  articles.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return { rootPath, articles, scannedAt: new Date().toISOString(), mode, warnings }
}

export async function saveDraft(articleFolder: string, platform: Platform, title: string, markdown: string, details?: Omit<PlatformDraft, 'title' | 'markdown' | 'updatedAt'>): Promise<void> {
  await updateState(articleFolder, async state => {
    const source = await loadSource(articleFolder, await collectFiles(articleFolder), state.selectedSources)
    state.drafts = completeDrafts(articleFolder, state, source)
    state.selectedSources ??= source.sources
    state.sourceFingerprint ??= source.fingerprint
    state.drafts[platform] = { ...state.drafts[platform], ...details, title, markdown, updatedAt: new Date().toISOString() }
  })
}

export async function readImageAsDataUrl(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase()
  const buffer = await sharp(filePath, { animated: false, density: extension === '.svg' ? 72 : undefined }).rotate().png().toBuffer()
  return `data:image/png;base64,${buffer.toString('base64')}`
}
