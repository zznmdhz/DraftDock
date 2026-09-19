import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { DerivedAsset, GenerateAssetInput } from '../shared/types'

async function readManifest(articleFolder: string): Promise<{ version: number; assets: DerivedAsset[] }> {
  try { return JSON.parse(await fs.readFile(path.join(articleFolder, '.draftdock', 'manifest.json'), 'utf8')) }
  catch { return { version: 1, assets: [] } }
}

async function uniqueOutputPath(directory: string, baseName: string): Promise<string> {
  let candidate = path.join(directory, `${baseName}.png`), counter = 2
  while (await fs.stat(candidate).then(() => true).catch(() => false)) candidate = path.join(directory, `${baseName}-${counter++}.png`)
  return candidate
}

export async function generateDerivedAsset(input: GenerateAssetInput): Promise<DerivedAsset> {
  const outputDir = path.join(input.articleFolder, '.draftdock', 'outputs', input.platform)
  await fs.mkdir(outputDir, { recursive: true })
  const sourceName = path.basename(input.sourcePath, path.extname(input.sourcePath)).replace(/[^\p{L}\p{N}._-]+/gu, '-')
  const baseName = `${sourceName}__${input.presetId}__${input.mode}`
  const outputPath = await uniqueOutputPath(outputDir, baseName)
  let pipeline = sharp(input.sourcePath, { animated: false, density: path.extname(input.sourcePath).toLowerCase() === '.svg' ? 192 : undefined }).rotate()

  if (input.mode === 'cover') {
    if (input.crop) {
      const metadata = await pipeline.metadata()
      const maxWidth = metadata.width ?? Math.ceil(input.crop.x + input.crop.width)
      const maxHeight = metadata.height ?? Math.ceil(input.crop.y + input.crop.height)
      const left = Math.max(0, Math.min(Math.floor(input.crop.x), maxWidth - 1))
      const top = Math.max(0, Math.min(Math.floor(input.crop.y), maxHeight - 1))
      const width = Math.max(1, Math.min(Math.round(input.crop.width), maxWidth - left))
      const height = Math.max(1, Math.min(Math.round(input.crop.height), maxHeight - top))
      pipeline = pipeline.extract({ left, top, width, height }).resize(input.width, input.height, { fit: 'fill' })
    } else {
      pipeline = pipeline.resize(input.width, input.height, { fit: 'cover', position: 'centre' })
    }
  } else {
    pipeline = pipeline.resize(input.width, input.height, { fit: 'contain', background: input.background || '#ffffff' })
  }
  await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath)

  const item: DerivedAsset = {
    id: randomUUID(), sourcePath: input.sourcePath, outputPath, platform: input.platform,
    presetId: input.presetId, width: input.width, height: input.height, mode: input.mode,
    crop: input.crop, background: input.background, createdAt: new Date().toISOString()
  }
  const manifest = await readManifest(input.articleFolder)
  manifest.assets.push(item)
  const manifestPath = path.join(input.articleFolder, '.draftdock', 'manifest.json')
  const tempPath = `${manifestPath}.${createHash('sha1').update(item.id).digest('hex').slice(0, 8)}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8')
  await fs.rename(tempPath, manifestPath)
  return item
}
