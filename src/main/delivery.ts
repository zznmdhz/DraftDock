import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import sanitizeHtml from 'sanitize-html'
import { buildDelivery, PROFILES, validateDraft } from '../shared/platforms'
import type { BundleInput, BundleResult, DerivedAsset } from '../shared/types'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tif', '.tiff', '.avif'])
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function escapeHtml(text: string): string { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) }
function markdownTitle(title: string): string { return title.replace(/[\r\n]+/g, ' ').trim() }

async function imageWithin(root: string, candidate: string): Promise<string> {
  const lexical = path.resolve(candidate)
  if (!inside(root, lexical) || !IMAGE_EXTENSIONS.has(path.extname(lexical).toLowerCase())) throw new Error('交付图片必须是当前文章内的有效图片文件')
  const resolved = await fs.realpath(lexical)
  if (!inside(root, resolved) || !(await fs.stat(resolved)).isFile()) throw new Error('交付图片路径不在当前文章内')
  return resolved
}

/** Creates a complete, ordered publishing package. Source files are only read. */
export async function exportDeliveryBundle(input: BundleInput): Promise<BundleResult> {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, input.platform)) throw new Error('不支持的发布平台')
  const checks = validateDraft(input.platform, input.draft)
  const errors = checks.filter(check => check.level === 'error')
  if (errors.length) throw new Error(`交付检查未通过：${errors.map(check => check.message).join('；')}`)
  const article = await fs.realpath(path.resolve(input.articleFolder))
  if (!(await fs.stat(article)).isDirectory()) throw new Error('文章目录不存在')
  const selected = input.draft.images ?? []
  const warnings = checks.filter(check => check.level === 'warning').map(check => check.message)
  if (!selected.length) warnings.push('本次交付没有选择图片。')
  let assets: DerivedAsset[] = []
  if (selected.some(image => image.outputPath)) {
    const manifestPath = path.join(article, '.draftdock', 'manifest.json')
    const realManifest = await fs.realpath(manifestPath)
    if (!inside(article, realManifest)) throw new Error('派生图记录路径不在当前文章内')
    const manifest = JSON.parse(await fs.readFile(realManifest, 'utf8')) as { assets?: DerivedAsset[] }
    if (!Array.isArray(manifest.assets)) throw new Error('派生图记录损坏，请重新生成交付图')
    assets = manifest.assets
  }
  const files: { source: string; input: string; derived: boolean; name: string }[] = []
  for (const [index, image] of selected.entries()) {
    const source = await imageWithin(article, image.sourcePath)
    if (inside(path.join(article, '.draftdock'), source)) throw new Error('原图不能来自应用输出目录')
    let candidate = source
    if (image.outputPath) {
      candidate = await imageWithin(article, image.outputPath)
      if (!inside(path.join(article, '.draftdock', 'outputs', input.platform), candidate)) throw new Error('派生图不属于当前平台')
      let matched = false
      for (const item of assets) {
        if (item.platform !== input.platform || typeof item.sourcePath !== 'string' || typeof item.outputPath !== 'string') continue
        try {
          if ((await fs.realpath(item.sourcePath)) === source && (await fs.realpath(item.outputPath)) === candidate) { matched = true; break }
        } catch { /* An obsolete record does not authorize the chosen output. */ }
      }
      if (!matched) throw new Error('所选派生图与当前原图的记录不匹配')
    }
    const stem = path.basename(source, path.extname(source)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'image'
    files.push({ source, input: candidate, derived: Boolean(image.outputPath), name: `${String(index + 1).padStart(2, '0')}-${stem}.png` })
  }

  // Resolve each intermediate directory before proceeding: a junction must never redirect writes outside the article.
  let parent = article
  for (const segment of ['.draftdock', 'deliveries', input.platform]) {
    parent = path.join(parent, segment)
    await fs.mkdir(parent).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    parent = await fs.realpath(parent)
    if (!inside(article, parent) || !(await fs.stat(parent)).isDirectory()) throw new Error('交付目录不在当前文章内')
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputFolder = path.join(parent, `${stamp}-${randomUUID()}`)
  await fs.mkdir(outputFolder)
  try {
    await fs.mkdir(path.join(outputFolder, 'images'))
    const deliveredImages: { order: number; sourcePath: string; selectedPath: string; derived: boolean; file: string; width: number; height: number }[] = []
    for (const [index, file] of files.entries()) {
      const destination = path.join(outputFolder, 'images', file.name)
      const result = await sharp(file.input, { animated: false, density: path.extname(file.input).toLowerCase() === '.svg' ? 192 : undefined }).rotate().png().toFile(destination)
      if (input.platform === 'x' && result.size > 5 * 1024 * 1024) throw new Error(`X 配图 ${index + 1} 转换后的 PNG 超过 5 MB，请先降低分辨率后重新交付`)
      deliveredImages.push({ order: index + 1, sourcePath: path.relative(article, file.source), selectedPath: path.relative(article, file.input), derived: file.derived, file: `images/${file.name}`, width: result.width, height: result.height })
    }
    const delivered = buildDelivery(input.platform, input.draft.title, input.draft.markdown)
    const imageMarkdown = deliveredImages.map(image => `![配图 ${image.order}](<${image.file}>)`).join('\n\n')
    // Existing Markdown image references are not copied into a portable bundle; selected images are appended in explicit order.
    const articleMarkdown = [`# ${markdownTitle(input.draft.title) || PROFILES[input.platform].label}`, delivered.body.replace(/!\[[^\]]*\]\([^)]*\)/g, ''), imageMarkdown ? `## 所选配图（按发布顺序附后）\n\n${imageMarkdown}` : ''].filter(Boolean).join('\n\n')
    const bodyHtml = sanitizeHtml(delivered.html, { allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'], allowedAttributes: { a: ['href', 'title'] }, allowedSchemes: ['http', 'https', 'mailto'] })
    const figures = deliveredImages.map(image => `<figure><img src="${escapeHtml(image.file)}" alt="配图 ${image.order}"><figcaption>配图 ${image.order}</figcaption></figure>`).join('\n')
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.draft.title)}</title><style>body{max-width:820px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui,sans-serif;color:#202838}img{max-width:100%;height:auto}figure{margin:24px 0}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}</style></head><body><h1>${escapeHtml(input.draft.title)}</h1>${bodyHtml}${figures ? '<h2>所选配图（按发布顺序附后）</h2>' + figures : ''}</body></html>`
    const checklist = [`# ${PROFILES[input.platform].label}交付检查单`, `- 发布入口：${PROFILES[input.platform].entry}`, `- 账号备注：${input.draft.account?.replace(/[\r\n]/g, ' ') || '未指定'}`, `- 图片：${deliveredImages.length} 张，按 images 文件名前缀顺序上传。`, '- 文字与配图已准备完成；请在平台端人工检查排版和发布。', '- 配图附在 HTML/Markdown 末尾；正文精确插图位置需要在平台端确认。', ...checks.map(check => `- [${check.level}] ${check.message}`), ...warnings.filter(warning => !checks.some(check => check.message === warning)).map(warning => `- [warning] ${warning}`), '- [ ] 确认标题和正文', '- [ ] 确认封面、图片顺序、清晰度与正文插图位置', '- [ ] 在对应账号后台检查限制并发布', '- [ ] 回到 DraftDock 记录状态与发布链接'].join('\n\n') + '\n'
    const writes = await Promise.allSettled([
      fs.writeFile(path.join(outputFolder, 'title.txt'), input.draft.title, 'utf8'),
      fs.writeFile(path.join(outputFolder, 'body.txt'), delivered.plain, 'utf8'),
      fs.writeFile(path.join(outputFolder, 'article.md'), articleMarkdown, 'utf8'),
      fs.writeFile(path.join(outputFolder, 'article.html'), html, 'utf8'),
      fs.writeFile(path.join(outputFolder, 'delivery-checklist.md'), checklist, 'utf8')
    ])
    const failedWrite = writes.find((write): write is PromiseRejectedResult => write.status === 'rejected')
    if (failedWrite) throw failedWrite.reason
    await fs.writeFile(path.join(outputFolder, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), platform: input.platform, title: input.draft.title, account: input.draft.account ?? '', status: input.draft.status ?? 'draft', publishedUrl: input.draft.publishedUrl ?? '', notes: input.draft.notes ?? '', limits: input.draft.limits ?? {}, images: deliveredImages, warnings, checks, rules: { url: PROFILES[input.platform].rulesUrl, verifiedAt: PROFILES[input.platform].verifiedAt, entry: PROFILES[input.platform].entry } }, null, 2), 'utf8')
    return { outputFolder, imageCount: deliveredImages.length, warnings }
  } catch (error) {
    await fs.rm(outputFolder, { recursive: true, force: true })
    throw new Error(`交付包生成失败，未保留不完整输出：${error instanceof Error ? error.message : String(error)}`)
  }
}
