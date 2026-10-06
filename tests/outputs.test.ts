import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { generateDerivedAsset } from '../src/main/outputs'
import type { GenerateAssetInput } from '../src/shared/types'

const created: string[] = []
afterEach(async () => { await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))) })

async function hash(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

describe('non-destructive image outputs', () => {
  it('exports zoomed-out composition with background and exact placement without stretching', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'wide.png')
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } }).png().toFile(sourcePath)
    const output = await generateDerivedAsset({ articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 100, height: 100, mode: 'cover', background: '#ffffff', composition: { zoom: 0.25, offsetX: 0.1, offsetY: 0 } })
    const { data, info } = await sharp(output.outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)]
    expect(pixel(10, 50)).toEqual([255, 255, 255])
    expect(pixel(60, 50)).toEqual([255, 0, 0])
    expect(pixel(60, 20)).toEqual([255, 255, 255])
    expect(output.composition?.zoom).toBe(0.25)
  })
  it('creates distinct derivatives without changing the original', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'source.png')
    await sharp({ create: { width: 1200, height: 800, channels: 4, background: '#ef5a3c' } }).png().toFile(sourcePath)
    const before = await hash(sourcePath)
    const input = { articleFolder, sourcePath, platform: 'wechat' as const, presetId: 'wechat-cover', width: 900, height: 383, mode: 'cover' as const, crop: { x: 120, y: 80, width: 900, height: 383 } }
    const first = await generateDerivedAsset(input)
    const second = await generateDerivedAsset(input)
    expect(first.outputPath).not.toBe(second.outputPath)
    expect(await hash(sourcePath)).toBe(before)
    expect((await sharp(first.outputPath).metadata()).width).toBe(900)
    expect((await sharp(first.outputPath).metadata()).height).toBe(383)
    const manifest = JSON.parse(await fs.readFile(path.join(articleFolder, '.draftdock', 'manifest.json'), 'utf8'))
    expect(manifest.assets).toHaveLength(2)
    expect(manifest.assets[0].sourcePath).toBe(sourcePath)
  })

  it('contains the whole image with a background instead of stretching', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'poster.png')
    await sharp({ create: { width: 300, height: 900, channels: 4, background: '#172033' } }).png().toFile(sourcePath)
    const result = await generateDerivedAsset({ articleFolder, sourcePath, platform: 'xiaohongshu', presetId: 'xhs-square', width: 1080, height: 1080, mode: 'contain', background: '#ffffff' })
    const metadata = await sharp(result.outputPath).metadata()
    expect([metadata.width, metadata.height]).toEqual([1080, 1080])
  })

  it('serializes simultaneous generation so both unique outputs are registered', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-concurrent-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'source.png')
    await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ff0000' } }).png().toFile(sourcePath)
    const input: GenerateAssetInput = { articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 60, height: 60, mode: 'contain' }
    const results = await Promise.all([generateDerivedAsset(input), generateDerivedAsset(input)])
    expect(new Set(results.map(result => result.outputPath)).size).toBe(2)
    const manifest = JSON.parse(await fs.readFile(path.join(articleFolder, '.draftdock', 'manifest.json'), 'utf8'))
    expect(manifest.assets.map((asset: { id: string }) => asset.id).sort()).toEqual(results.map(result => result.id).sort())
    expect(await fs.readdir(path.join(articleFolder, '.draftdock', 'outputs', 'wechat'))).toHaveLength(2)
  })

  it('leaves a corrupt manifest unchanged and creates no output', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-corrupt-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'source.png')
    await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ff0000' } }).png().toFile(sourcePath)
    await fs.mkdir(path.join(articleFolder, '.draftdock'))
    const file = path.join(articleFolder, '.draftdock', 'manifest.json'), original = '{"assets": damaged'
    await fs.writeFile(file, original)
    await expect(generateDerivedAsset({ articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 60, height: 60, mode: 'contain' })).rejects.toThrow('未覆盖原记录')
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect(await fs.readdir(path.join(articleFolder, '.draftdock'))).toEqual(['manifest.json'])
  })

  it('rejects invalid dimensions, unsafe presets and invalid platforms before creating output directories', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-invalid-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'source.png')
    const input: GenerateAssetInput = { articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 60, height: 60, mode: 'contain' }
    for (const width of [0, -1, NaN, Infinity, 10.5, 8193]) await expect(generateDerivedAsset({ ...input, width })).rejects.toThrow('尺寸无效')
    await expect(generateDerivedAsset({ ...input, presetId: '../escape' })).rejects.toThrow('预设无效')
    await expect(generateDerivedAsset({ ...input, platform: '../escape' as GenerateAssetInput['platform'] })).rejects.toThrow('平台')
    expect(await fs.readdir(articleFolder)).toEqual([])
  })

  it('uses oriented raster coordinates and clamps partially outside crops to valid positive pixels', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-crop-'))
    created.push(articleFolder)
    const sourcePath = path.join(articleFolder, 'oriented.jpg')
    await sharp({ create: { width: 40, height: 70, channels: 3, background: '#ff0000' } }).withMetadata({ orientation: 6 }).jpeg().toFile(sourcePath)
    const input: GenerateAssetInput = { articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 30, height: 30, mode: 'cover', crop: { x: 50, y: -5, width: 25, height: 25 } }
    const result = await generateDerivedAsset(input)
    expect(result.crop).toEqual({ x: 50, y: 0, width: 20, height: 20 })
    expect([(await sharp(result.outputPath).metadata()).width, (await sharp(result.outputPath).metadata()).height]).toEqual([30, 30])
    await expect(generateDerivedAsset({ ...input, crop: { x: 100, y: 0, width: 10, height: 10 } })).rejects.toThrow('没有覆盖原图')
    expect(await fs.readdir(path.dirname(result.outputPath))).toHaveLength(1)
  })

  it('rejects junction escapes for original images, output directories and manifest records', async () => {
    const articleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-safe-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-escaped-'))
    created.push(articleFolder, outside)
    const sourcePath = path.join(articleFolder, 'source.png')
    await sharp({ create: { width: 100, height: 80, channels: 3, background: '#ff0000' } }).png().toFile(sourcePath)
    await fs.copyFile(sourcePath, path.join(outside, 'external.png'))
    const input: GenerateAssetInput = { articleFolder, sourcePath, platform: 'wechat', presetId: 'square', width: 60, height: 60, mode: 'contain' }
    await fs.symlink(outside, path.join(articleFolder, 'linked'), 'junction')
    await expect(generateDerivedAsset({ ...input, sourcePath: path.join(articleFolder, 'linked', 'external.png') })).rejects.toThrow('原图路径')
    await fs.symlink(outside, path.join(articleFolder, '.draftdock'), 'junction')
    await expect(generateDerivedAsset(input)).rejects.toThrow('输出目录')
    await fs.writeFile(path.join(outside, 'manifest.json'), '{"version":1,"assets":[]}')
    await expect(generateDerivedAsset(input)).rejects.toThrow('派生记录路径')
    expect(await fs.readdir(outside)).toEqual(['external.png', 'manifest.json'])
  })
})
