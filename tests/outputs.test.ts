import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { generateDerivedAsset } from '../src/main/outputs'

const created: string[] = []
afterEach(async () => { await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))) })

async function hash(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

describe('non-destructive image outputs', () => {
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
})
