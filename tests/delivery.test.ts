import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { exportDeliveryBundle } from '../src/main/delivery'
import type { BundleInput, DerivedAsset } from '../src/shared/types'

const created: string[] = []
afterEach(async () => { await Promise.all(created.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))) })
async function fixture(): Promise<{ folder: string; first: string; second: string; input: BundleInput }> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-delivery-'))
  created.push(folder)
  const first = path.join(folder, 'first.png'), second = path.join(folder, 'second.svg')
  await sharp({ create: { width: 40, height: 60, channels: 3, background: '#ff0000' } }).png().toFile(first)
  await fs.writeFile(second, '<svg xmlns="http://www.w3.org/2000/svg" width="70" height="30"><rect width="70" height="30" fill="#0000ff"/></svg>')
  return { folder, first, second, input: { articleFolder: folder, platform: 'wechat', draft: { title: '测试文章', markdown: '**发布正文**', updatedAt: new Date().toISOString(), images: [{ sourcePath: second }, { sourcePath: first }] } } }
}
async function hash(file: string): Promise<string> { return createHash('sha256').update(await fs.readFile(file)).digest('hex') }
async function derivative(folder: string, source: string, platform: 'wechat' | 'xiaohongshu'): Promise<string> {
  const output = path.join(folder, '.draftdock', 'outputs', platform, 'derived.png')
  await fs.mkdir(path.dirname(output), { recursive: true })
  await sharp({ create: { width: 90, height: 45, channels: 3, background: '#00ff00' } }).png().toFile(output)
  const asset: DerivedAsset = { id: 'derived', sourcePath: source, outputPath: output, platform, presetId: 'test', width: 90, height: 45, mode: 'contain', createdAt: new Date().toISOString() }
  await fs.writeFile(path.join(folder, '.draftdock', 'manifest.json'), JSON.stringify({ version: 1, assets: [asset] }))
  return output
}

describe('complete local publishing deliveries', () => {
  it('keeps original bytes, requested order and independent complete bundles with readable local HTML', async () => {
    const { folder, first, second, input } = await fixture()
    const before = [await hash(first), await hash(second)]
    const a = await exportDeliveryBundle(input), b = await exportDeliveryBundle(input)
    expect(a.outputFolder).not.toBe(b.outputFolder)
    expect(a.imageCount).toBe(2)
    expect([await hash(first), await hash(second)]).toEqual(before)
    const manifest = JSON.parse(await fs.readFile(path.join(a.outputFolder, 'manifest.json'), 'utf8'))
    expect(manifest.images.map((image: { sourcePath: string }) => image.sourcePath)).toEqual(['second.svg', 'first.png'])
    expect(await fs.readdir(a.outputFolder)).toEqual(expect.arrayContaining(['title.txt', 'body.txt', 'article.md', 'article.html', 'images', 'manifest.json', 'delivery-checklist.md']))
    expect(await fs.readdir(path.join(a.outputFolder, 'images'))).toEqual(['01-second.png', '02-first.png'])
    const html = await fs.readFile(path.join(a.outputFolder, 'article.html'), 'utf8')
    expect(html).toContain('<h1>测试文章</h1>')
    expect(html).toContain('src="images/01-second.png"')
    expect(manifest.checks.some((check: { id: string }) => check.id === 'originals')).toBe(true)
    expect(path.relative(folder, a.outputFolder)).toContain(path.join('.draftdock', 'deliveries', 'wechat'))
  })

  it('uses the explicitly selected derivative rather than the original', async () => {
    const { folder, first, input } = await fixture()
    const output = await derivative(folder, first, 'wechat')
    input.draft.images = [{ sourcePath: first, outputPath: output }]
    const result = await exportDeliveryBundle(input)
    const metadata = await sharp(path.join(result.outputFolder, 'images', '01-first.png')).metadata()
    expect([metadata.width, metadata.height]).toEqual([90, 45])
    const manifest = JSON.parse(await fs.readFile(path.join(result.outputFolder, 'manifest.json'), 'utf8'))
    expect(manifest.images[0].derived).toBe(true)
  })

  it('rejects a cross-platform or mismatched derivative even if it is within the article', async () => {
    const { folder, first, second, input } = await fixture()
    const other = await derivative(folder, first, 'xiaohongshu')
    input.draft.images = [{ sourcePath: first, outputPath: other }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('当前平台')
    const current = await derivative(folder, first, 'wechat')
    input.draft.images = [{ sourcePath: second, outputPath: current }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('记录不匹配')
  })

  it('rejects missing and unreadable images without keeping a partial delivery', async () => {
    const { folder, first, input } = await fixture()
    input.draft.images = [{ sourcePath: first }, { sourcePath: path.join(folder, 'missing.png') }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow()
    const broken = path.join(folder, 'broken.png')
    await fs.writeFile(broken, 'invalid png')
    input.draft.images = [{ sourcePath: first }, { sourcePath: broken }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('未保留不完整输出')
    expect(await fs.readdir(path.join(folder, '.draftdock', 'deliveries', 'wechat'))).toEqual([])
  })

  it('rejects traversal and hard platform failures and sanitizes delivered HTML', async () => {
    const { folder, input } = await fixture()
    input.draft.images = [{ sourcePath: path.join(folder, '..', 'outside.png') }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('当前文章')
    input.draft.images = []
    input.platform = 'x'
    input.draft.markdown = 'a'.repeat(281)
    await expect(exportDeliveryBundle(input)).rejects.toThrow('交付检查未通过')
    input.platform = 'wechat'
    input.draft.title = '<script>bad</script>'
    input.draft.markdown = '正文<script>alert(1)</script><img src="file:///private.png" onerror="bad()">'
    const result = await exportDeliveryBundle(input)
    const html = await fs.readFile(path.join(result.outputFolder, 'article.html'), 'utf8')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('file:///')
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(result.warnings).toContain('本次交付没有选择图片。')
  })

  it('normalizes TIFF orientation when producing standard PNG delivery images', async () => {
    const { folder, input } = await fixture()
    const source = path.join(folder, 'rotated.tiff')
    await sharp({ create: { width: 40, height: 70, channels: 3, background: '#fa5030' } }).withMetadata({ orientation: 6 }).tiff().toFile(source)
    input.draft.images = [{ sourcePath: source }]
    const result = await exportDeliveryBundle(input)
    const image = await sharp(path.join(result.outputFolder, 'images', '01-rotated.png')).metadata()
    expect([image.width, image.height, image.format]).toEqual([70, 40, 'png'])
  })

  it('rejects X delivery when the actual normalized PNG exceeds 5 MB without leaving a half-package', async () => {
    const { folder, input } = await fixture()
    const source = path.join(folder, 'large.png')
    await sharp(randomBytes(1600 * 1200 * 3), { raw: { width: 1600, height: 1200, channels: 3 } }).png().toFile(source)
    input.platform = 'x'
    input.draft.images = [{ sourcePath: source }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('PNG 超过 5 MB')
    expect(await fs.readdir(path.join(folder, '.draftdock', 'deliveries', 'x'))).toEqual([])
  })

  it('rejects junctions which redirect images or delivery writes outside the article', async () => {
    const { folder, input } = await fixture()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-outside-'))
    created.push(outside)
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } }).png().toFile(path.join(outside, 'private.png'))
    await fs.symlink(outside, path.join(folder, 'linked'), 'junction')
    input.draft.images = [{ sourcePath: path.join(folder, 'linked', 'private.png') }]
    await expect(exportDeliveryBundle(input)).rejects.toThrow('当前文章')
    await fs.symlink(outside, path.join(folder, '.draftdock'), 'junction')
    input.draft.images = []
    await expect(exportDeliveryBundle(input)).rejects.toThrow('交付目录不在当前文章内')
    expect(await fs.readdir(outside)).toEqual(['private.png'])
  })

  it('accepts legal aliases for the article, original and recorded derivative using canonical containment', async () => {
    const { folder, first, input } = await fixture()
    const aliasContainer = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-delivery-alias-'))
    created.push(aliasContainer)
    const alias = path.join(aliasContainer, 'article-link')
    await fs.symlink(folder, alias, 'junction')
    const output = await derivative(folder, first, 'wechat')
    const aliasOutput = path.join(alias, path.relative(await fs.realpath(folder), await fs.realpath(output)))
    input.draft.images = [{ sourcePath: path.join(alias, 'first.png'), outputPath: aliasOutput }]
    const result = await exportDeliveryBundle(input)
    expect(result.imageCount).toBe(1)
    const manifest = JSON.parse(await fs.readFile(path.join(result.outputFolder, 'manifest.json'), 'utf8'))
    expect(manifest.images[0].sourcePath).toBe('first.png')
    expect(manifest.images[0].derived).toBe(true)
    const fromAliasRoot = await exportDeliveryBundle({ ...input, articleFolder: alias })
    expect(fromAliasRoot.outputFolder).not.toBe(result.outputFolder)
  })
})
