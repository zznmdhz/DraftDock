import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { DerivedAsset, GenerateAssetInput } from '../shared/types'
import { compositionRect } from '../shared/composition'

const generationQueues = new Map<string, Promise<DerivedAsset>>()
const PLATFORMS = new Set(['wechat', 'xiaohongshu', 'x', 'zhihu'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tif', '.tiff', '.avif'])
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function validateInput(input: GenerateAssetInput): void {
  if (!PLATFORMS.has(input.platform) || !['cover', 'contain'].includes(input.mode)) throw new Error('图片平台或适配模式无效')
  if (typeof input.presetId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.presetId)) throw new Error('图片用途预设无效')
  if (![input.width, input.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192) || input.width * input.height > 64_000_000) throw new Error('图片输出尺寸无效，请使用 1–8192 像素且不超过 6400 万像素的画布')
  if (input.composition) {
    const { zoom, offsetX, offsetY } = input.composition
    if (![zoom, offsetX, offsetY].every(Number.isFinite) || zoom <= 0 || zoom > 3 || Math.abs(offsetX) > 5 || Math.abs(offsetY) > 5) throw new Error('图片缩放或位置参数无效')
  }
  if (input.crop && (![input.crop.x, input.crop.y, input.crop.width, input.crop.height].every(Number.isFinite) || input.crop.width <= 0 || input.crop.height <= 0)) throw new Error('图片裁切范围无效')
}
async function readManifest(article: string): Promise<{ version: number; assets: DerivedAsset[]; [key: string]: unknown }> {
  const candidate = path.join(article, '.draftdock', 'manifest.json')
  try {
    await fs.lstat(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, assets: [] }
    throw error
  }
  try {
    const resolved = await fs.realpath(candidate)
    if (!inside(article, resolved)) throw new Error('派生记录路径不在当前文章内')
    const parsed = JSON.parse(await fs.readFile(resolved, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.assets) || parsed.assets.some((asset: unknown) => !asset || typeof asset !== 'object' || typeof (asset as DerivedAsset).id !== 'string' || typeof (asset as DerivedAsset).sourcePath !== 'string' || typeof (asset as DerivedAsset).outputPath !== 'string')) throw new Error('派生记录结构无效')
    return parsed
  } catch (error) {
    throw new Error(`派生记录读取失败，未覆盖原记录：${error instanceof Error ? error.message : String(error)}`)
  }
}
async function outputDirectory(article: string, platform: string): Promise<string> {
  let directory = article
  for (const segment of ['.draftdock', 'outputs', platform]) {
    directory = path.join(directory, segment)
    await fs.mkdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    directory = await fs.realpath(directory)
    if (!inside(article, directory) || !(await fs.stat(directory)).isDirectory()) throw new Error('图片输出目录不在当前文章内')
  }
  return directory
}

export async function generateDerivedAsset(input: GenerateAssetInput): Promise<DerivedAsset> {
  validateInput(input)
  const article = await fs.realpath(path.resolve(input.articleFolder))
  if (!(await fs.stat(article)).isDirectory()) throw new Error('文章目录不存在')
  const previous = generationQueues.get(article)
  const next = (previous ?? Promise.resolve()).catch(() => {}).then(() => generateSerial(input, article))
  generationQueues.set(article, next)
  void next.finally(() => { if (generationQueues.get(article) === next) generationQueues.delete(article) }).catch(() => {})
  return next
}

async function generateSerial(input: GenerateAssetInput, article: string): Promise<DerivedAsset> {
  const lexical = path.resolve(input.sourcePath)
  if (!IMAGE_EXTENSIONS.has(path.extname(lexical).toLowerCase())) throw new Error('图片来源必须是当前文章内的有效图片')
  // Windows short names and directory aliases can look outside the canonical article while resolving inside it.
  const sourcePath = await fs.realpath(lexical).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('当前文章原图不存在或已移动')
    throw error
  })
  if (!inside(article, sourcePath) || inside(path.join(article, '.draftdock'), sourcePath) || !(await fs.stat(sourcePath)).isFile()) throw new Error('原图路径不在当前文章素材目录内')
  const manifest = await readManifest(article)
  // Materialize orientation and SVG rasterization before applying any pixel coordinates.
  const normalized = await sharp(sourcePath, { animated: false, density: path.extname(sourcePath).toLowerCase() === '.svg' ? 192 : undefined }).rotate().png().toBuffer({ resolveWithObject: true })
  let pipeline = sharp(normalized.data)
  let appliedCrop: GenerateAssetInput['crop']

  if (input.composition) {
    const rect = compositionRect(normalized.info.width, normalized.info.height, input.width, input.height, input.composition)
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    const width = Math.min(input.width, rect.left + rect.width) - left
    const height = Math.min(input.height, rect.top + rect.height) - top
    if (width <= 0 || height <= 0) throw new Error('图片完全移出了画布，请重新居中')
    const layer = await sharp(normalized.data).resize(rect.width, rect.height).extract({ left: left - rect.left, top: top - rect.top, width, height }).png().toBuffer()
    pipeline = sharp({ create: { width: input.width, height: input.height, channels: 4, background: input.background || '#ffffff' } }).composite([{ input: layer, left, top }])
  } else if (input.mode === 'cover') {
    if (input.crop) {
      const left = Math.max(0, Math.floor(input.crop.x)), top = Math.max(0, Math.floor(input.crop.y))
      const width = Math.min(normalized.info.width, Math.ceil(input.crop.x + input.crop.width)) - left
      const height = Math.min(normalized.info.height, Math.ceil(input.crop.y + input.crop.height)) - top
      if (width <= 0 || height <= 0) throw new Error('裁切范围没有覆盖原图，请重新选择')
      appliedCrop = { x: left, y: top, width, height }
      pipeline = pipeline.extract({ left, top, width, height }).resize(input.width, input.height, { fit: 'fill' })
    } else {
      pipeline = pipeline.resize(input.width, input.height, { fit: 'cover', position: 'centre' })
    }
  } else {
    pipeline = pipeline.resize(input.width, input.height, { fit: 'contain', background: input.background || '#ffffff' })
  }
  const id = randomUUID()
  const outputDir = await outputDirectory(article, input.platform)
  const sourceName = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80)
  const outputPath = path.join(outputDir, `${sourceName}__${input.presetId}__${input.mode}__${id}.png`)
  const manifestPath = path.join(article, '.draftdock', 'manifest.json')
  const tempPath = `${manifestPath}.${id}.tmp`
  const reservation = await fs.open(outputPath, 'wx')
  await reservation.close()
  try {
    await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath)
    const item: DerivedAsset = {
      id, sourcePath, outputPath, platform: input.platform,
      presetId: input.presetId, width: input.width, height: input.height, mode: input.mode,
      crop: appliedCrop, composition: input.composition, background: input.background, createdAt: new Date().toISOString()
    }
    manifest.assets.push(item)
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
    await fs.rename(tempPath, manifestPath)
    return item
  } catch (error) {
    await Promise.all([fs.rm(outputPath, { force: true }), fs.rm(tempPath, { force: true })])
    throw error
  }
}
