import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { ArticleRecord, DerivedAsset, LibrarySnapshot, PlatformDraft } from '../shared/types'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tif', '.tiff', '.avif'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

function idFor(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')) as T } catch { return fallback }
}

async function makeThumbnail(filePath: string, extension: string): Promise<{ dataUrl: string; width: number | null; height: number | null; format: string | null }> {
  try {
    const image = sharp(filePath, { animated: false, density: extension === '.svg' ? 144 : undefined }).rotate()
    const metadata = await image.metadata()
    const buffer = await image.resize({ width: 420, height: 300, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    return { dataUrl: `data:image/webp;base64,${buffer.toString('base64')}`, width: metadata.width ?? null, height: metadata.height ?? null, format: metadata.format ?? null }
  } catch {
    return { dataUrl: '', width: null, height: null, format: extension.slice(1) || null }
  }
}

function titleFromMarkdown(markdown: string, folderName: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || folderName.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]?/, '').replace(/[-_]+/g, ' ').trim() || folderName
}

export function adaptMarkdown(markdown: string, platform: 'wechat' | 'xiaohongshu'): string {
  if (platform === 'wechat') return markdown.trim()
  return markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function defaultDraft(title: string, markdown: string, platform: 'master' | 'wechat' | 'xiaohongshu'): PlatformDraft {
  return {
    title,
    markdown: platform === 'xiaohongshu' ? adaptMarkdown(markdown, 'xiaohongshu') : markdown,
    updatedAt: new Date().toISOString()
  }
}

async function scanArticle(folderPath: string): Promise<ArticleRecord | null> {
  const folderName = path.basename(folderPath)
  const entries = await fs.readdir(folderPath, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile())
  const markdownFiles = files.filter((entry) => MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const imageFiles = files.filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  if (!markdownFiles.length && !imageFiles.length) return null

  const warnings: string[] = []
  if (!markdownFiles.length) warnings.push('未找到 Markdown 主稿')
  if (markdownFiles.length > 1) warnings.push(`发现 ${markdownFiles.length} 份 Markdown，当前使用 ${markdownFiles[0].name}`)
  const markdownPath = markdownFiles[0] ? path.join(folderPath, markdownFiles[0].name) : null
  const markdown = markdownPath ? await fs.readFile(markdownPath, 'utf8') : ''
  const title = titleFromMarkdown(markdown, folderName)
  const folderStats = await fs.stat(folderPath)
  const statePath = path.join(folderPath, '.draftdock', 'state.json')
  const manifestPath = path.join(folderPath, '.draftdock', 'manifest.json')
  const storedState = await readJson<{ drafts?: ArticleRecord['drafts'] }>(statePath, {})
  const manifest = await readJson<{ assets?: DerivedAsset[] }>(manifestPath, {})
  const derivatives = manifest.assets ?? []

  const images = await Promise.all(imageFiles.map(async (entry) => {
    const filePath = path.join(folderPath, entry.name)
    const stats = await fs.stat(filePath)
    const extension = path.extname(entry.name).toLowerCase()
    const thumb = await makeThumbnail(filePath, extension)
    if (!thumb.dataUrl) warnings.push(`无法读取图片：${entry.name}`)
    return {
      id: idFor(filePath), name: entry.name, path: filePath, extension,
      width: thumb.width, height: thumb.height, format: thumb.format, size: stats.size,
      thumbnailDataUrl: thumb.dataUrl,
      derivatives: derivatives.filter((item) => item.sourcePath === filePath)
    }
  }))

  const drafts = storedState.drafts ?? {}
  drafts.master ??= defaultDraft(title, markdown, 'master')
  drafts.wechat ??= defaultDraft(title, markdown, 'wechat')
  drafts.xiaohongshu ??= defaultDraft(title, markdown, 'xiaohongshu')

  return {
    id: idFor(folderPath), title, folderName, folderPath, markdownPath, markdown,
    modifiedAt: folderStats.mtime.toISOString(), images, drafts, warnings
  }
}

export async function scanLibrary(rootPath: string | null): Promise<LibrarySnapshot> {
  if (!rootPath) return { rootPath: null, articles: [], scannedAt: new Date().toISOString() }
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
  const articles = (await Promise.all(folders.map((folder) => scanArticle(path.join(rootPath, folder.name))))).filter(Boolean) as ArticleRecord[]
  articles.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return { rootPath, articles, scannedAt: new Date().toISOString() }
}

export async function saveDraft(articleFolder: string, platform: 'master' | 'wechat' | 'xiaohongshu', title: string, markdown: string): Promise<void> {
  const stateDir = path.join(articleFolder, '.draftdock')
  const statePath = path.join(stateDir, 'state.json')
  await fs.mkdir(stateDir, { recursive: true })
  const state = await readJson<{ version: number; drafts: ArticleRecord['drafts'] }>(statePath, { version: 1, drafts: {} })
  state.drafts[platform] = { title, markdown, updatedAt: new Date().toISOString() }
  const tempPath = `${statePath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(tempPath, statePath)
}

export async function readImageAsDataUrl(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase()
  const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : extension === '.avif' ? 'image/avif' : 'image/jpeg'
  return `data:${mime};base64,${(await fs.readFile(filePath)).toString('base64')}`
}
