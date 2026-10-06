import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { afterEach, expect, test } from 'vitest'
import { readImageAsDataUrl, restoreHistory, saveDraft, scanLibrary, selectSources } from '../src/main/library'
import { generateDerivedAsset } from '../src/main/outputs'

const fixtures: string[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))) })
async function fixture(): Promise<string> { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-workflow-')); fixtures.push(folder); return folder }

test('explicit article-library mode ignores root README and preserves distinct article packages', async () => {
  const root = await fixture()
  await fs.writeFile(path.join(root, 'README.md'), '# 内容库说明')
  for (const name of ['文章A', '文章B']) {
    await fs.mkdir(path.join(root, name, '发布图片'), { recursive: true })
    await fs.writeFile(path.join(root, name, '正文.md'), `# ${name}\n\n正文`)
  }
  const library = await scanLibrary(root, 'library')
  expect(library.mode).toBe('library')
  expect(library.articles.map(article => article.folderName).sort()).toEqual(['文章A', '文章B'])
  expect(library.articles.every(article => article.sourceFiles.length === 1)).toBe(true)
  expect((await scanLibrary(path.join(root, '文章A'), 'package')).articles).toHaveLength(1)
})

test('switching sources archives all defaults, restores full platform details, and backs up the current draft', async () => {
  const folder = await fixture(), first = path.join(folder, '01.md'), second = path.join(folder, '02.txt')
  await fs.writeFile(first, '# 第一稿\n\n原始正文')
  await fs.writeFile(second, '第二正文')
  await selectSources(folder, [second])
  let article = (await scanLibrary(folder)).articles[0]
  expect(Object.keys(article.history[0].drafts).sort()).toEqual(['master', 'wechat', 'xiaohongshu', 'x', 'zhihu'].sort())
  expect(article.history[0].drafts.wechat?.markdown).toContain('原始正文')
  await saveDraft(folder, 'x', '开头', '编辑稿', { images: [{ sourcePath: 'b' }, { sourcePath: 'a', outputPath: 'derived' }], account: '账号A', status: 'ready', limits: { text: 200 } })
  await selectSources(folder, [first])
  article = (await scanLibrary(folder)).articles[0]
  const xHistory = article.history.find(item => item.drafts.x?.markdown === '编辑稿')!
  await saveDraft(folder, 'x', '', '当前新稿')
  await restoreHistory(folder, xHistory.id)
  article = (await scanLibrary(folder)).articles[0]
  expect(article.drafts.x?.markdown).toBe('编辑稿')
  expect(article.drafts.x?.images?.map(image => image.sourcePath)).toEqual(['b', 'a'])
  expect(article.drafts.x?.account).toBe('账号A')
  expect(article.selectedSources).toEqual([second])
  expect(article.history.at(-1)?.drafts.x?.markdown).toBe('当前新稿')
})

test('source changes warn without replacing saved drafts or clearing the warning after a later save', async () => {
  const folder = await fixture(), file = path.join(folder, 'article.md')
  await fs.writeFile(file, '# 原标题\n\n第一正文')
  await saveDraft(folder, 'wechat', '用户标题', '用户修改', { account: '公众号A' })
  await fs.writeFile(file, '# 新标题\n\n第二正文')
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.sourceChanged).toBe(true)
  expect(article.drafts.wechat?.markdown).toBe('用户修改')
  expect(article.drafts.zhihu?.markdown).toContain('第一正文')
  await saveDraft(folder, 'wechat', '用户标题', '继续修改')
  const next = (await scanLibrary(folder)).articles[0]
  expect(next.sourceChanged).toBe(true)
  expect(next.drafts.wechat?.account).toBe('公众号A')
  await selectSources(folder, [file])
  expect((await scanLibrary(folder)).articles[0].sourceChanged).toBe(false)
})

test('malformed state remains untouched and save fails explicitly while scanning still exposes the article', async () => {
  const folder = await fixture(), stateFile = path.join(folder, '.draftdock', 'state.json')
  await fs.mkdir(path.dirname(stateFile))
  await fs.writeFile(path.join(folder, 'article.md'), '可读原稿')
  const broken = '{invalid json'
  await fs.writeFile(stateFile, broken)
  expect((await scanLibrary(folder)).articles[0].warnings.join('')).toContain('原文件已保留')
  await expect(saveDraft(folder, 'wechat', 'title', 'edited')).rejects.toThrow('原文件已保留')
  expect(await fs.readFile(stateFile, 'utf8')).toBe(broken)
})

test('parallel writes merge platform drafts and preserve details rather than losing last writer state', async () => {
  const folder = await fixture()
  await fs.writeFile(path.join(folder, 'article.md'), '正文')
  await Promise.all([
    saveDraft(folder, 'wechat', '公众号', '公众号正文', { account: 'A', images: [] }),
    saveDraft(folder, 'zhihu', '知乎', '知乎正文', { account: 'B' }),
    saveDraft(folder, 'wechat', '公众号更新', '公众号正文更新')
  ])
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.drafts.wechat?.markdown).toBe('公众号正文更新')
  expect(article.drafts.wechat?.images).toEqual([])
  expect(article.drafts.wechat?.account).toBe('A')
  expect(article.drafts.zhihu?.markdown).toBe('知乎正文')
})

test('limits source history to 50 records and scans missing directories as warnings', async () => {
  const folder = await fixture(), first = path.join(folder, '01.md'), second = path.join(folder, '02.txt')
  await fs.writeFile(first, '第一正文')
  await fs.writeFile(second, '第二正文')
  for (let index = 0; index < 52; index++) await selectSources(folder, [index % 2 ? first : second])
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.history).toHaveLength(50)
  expect(new Set(article.history.map(item => item.id)).size).toBe(50)
  const missing = await scanLibrary(path.join(folder, '已删除目录'))
  expect(missing.articles).toEqual([])
  expect(missing.warnings?.length).toBe(1)
})

test('image loading normalizes TIFF, SVG and EXIF orientation into browser-readable PNG', async () => {
  const folder = await fixture(), svg = path.join(folder, 'source.svg'), tiff = path.join(folder, 'source.tiff'), jpeg = path.join(folder, 'source.jpg')
  await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>')
  await sharp({ create: { width: 30, height: 20, channels: 3, background: '#112233' } }).tiff().toFile(tiff)
  await sharp({ create: { width: 30, height: 20, channels: 3, background: '#112233' } }).withMetadata({ orientation: 6 }).jpeg().toFile(jpeg)
  for (const [file, width, height] of [[svg, 30, 20], [tiff, 30, 20], [jpeg, 20, 30]] as const) {
    const url = await readImageAsDataUrl(file)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const metadata = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
    expect([metadata.width, metadata.height]).toEqual([width, height])
    expect(metadata.orientation).toBeUndefined()
  }
})

test.each([
  { images: {} }, { images: [null] }, { images: [{ sourcePath: 5 }] },
  { limits: { text: '100' } }, { status: 'unknown' }, { account: {} }
])('malformed draft details surface warnings instead of reaching renderer: %j', async details => {
  const folder = await fixture(), stateFile = path.join(folder, '.draftdock', 'state.json')
  await fs.mkdir(path.dirname(stateFile))
  await fs.writeFile(path.join(folder, 'article.md'), '安全原稿')
  const broken = JSON.stringify({ drafts: { wechat: { title: '标题', markdown: '正文', ...details } } })
  await fs.writeFile(stateFile, broken)
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.warnings.join('')).toContain('格式损坏')
  expect(article.drafts.wechat?.markdown).toBe('安全原稿')
  await expect(saveDraft(folder, 'wechat', '标题', '修改')).rejects.toThrow('原文件已保留')
  expect(await fs.readFile(stateFile, 'utf8')).toBe(broken)
})

test('storage directory junction cannot read or write another article state', async () => {
  const folder = await fixture(), outside = await fixture()
  await fs.writeFile(path.join(folder, 'article.md'), '本篇原稿')
  const outsideFile = path.join(outside, 'state.json'), bytes = JSON.stringify({ drafts: { wechat: { title: '外部机密', markdown: '外部机密正文' } } })
  await fs.writeFile(outsideFile, bytes)
  await fs.symlink(outside, path.join(folder, '.draftdock'), process.platform === 'win32' ? 'junction' : 'dir')
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.warnings.join('')).toContain('链接')
  expect(article.drafts.wechat?.markdown).toBe('本篇原稿')
  await expect(saveDraft(folder, 'wechat', '标题', '修改')).rejects.toThrow('链接')
  expect(await fs.readFile(outsideFile, 'utf8')).toBe(bytes)
  expect((await fs.readdir(outside)).sort()).toEqual(['state.json'])
})

test('state file symlink is rejected without exposing or overwriting its external target', async context => {
  const folder = await fixture(), outside = await fixture(), stateFile = path.join(folder, '.draftdock', 'state.json')
  await fs.mkdir(path.dirname(stateFile))
  await fs.writeFile(path.join(folder, 'article.md'), '本篇原稿')
  const outsideFile = path.join(outside, 'private.json'), bytes = JSON.stringify({ drafts: { wechat: { title: '外部', markdown: '外部' } } })
  await fs.writeFile(outsideFile, bytes)
  try { await fs.symlink(outsideFile, stateFile, 'file') }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { context.skip(); return }; throw error }
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.warnings.join('')).toContain('链接')
  expect(article.drafts.wechat?.markdown).toBe('本篇原稿')
  await expect(saveDraft(folder, 'wechat', '标题', '修改')).rejects.toThrow('链接')
  expect(await fs.readFile(outsideFile, 'utf8')).toBe(bytes)
})

test('clearing an optional account budget saves the remaining budgets and removes the cleared value', async () => {
  const folder = await fixture()
  await fs.writeFile(path.join(folder, 'article.md'), '正文')
  await saveDraft(folder, 'wechat', '标题', '正文', { limits: { text: 100, images: 9 } })
  await saveDraft(folder, 'wechat', '标题', '正文', { limits: { text: undefined, images: 9 } })
  expect((await scanLibrary(folder)).articles[0].drafts.wechat?.limits).toEqual({ images: 9 })
})

test('deleted, external and malformed derived outputs are hidden with warnings without rewriting manifest', async () => {
  const folder = await fixture(), outside = await fixture(), source = path.join(folder, 'source.svg')
  await fs.writeFile(path.join(folder, 'article.md'), '正文')
  await fs.writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="red"/></svg>')
  const output = await generateDerivedAsset({ articleFolder: folder, sourcePath: source, platform: 'wechat', presetId: 'wechat-cover', width: 30, height: 20, mode: 'cover' })
  expect((await scanLibrary(folder)).articles[0].images[0].derivatives).toHaveLength(1)
  await fs.unlink(output.outputPath)
  const external = path.join(outside, 'outside.png')
  await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toFile(external)
  const manifestFile = path.join(folder, '.draftdock', 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  manifest.assets.push({ ...output, id: 'outside', outputPath: external })
  manifest.assets.push({ ...output, id: 'bad-dimensions', outputPath: external, width: '100' })
  const bytes = JSON.stringify(manifest)
  await fs.writeFile(manifestFile, bytes)
  const article = (await scanLibrary(folder)).articles[0]
  expect(article.images[0].derivatives).toEqual([])
  expect(article.warnings.filter(warning => warning.includes('交付图'))).toHaveLength(3)
  expect(await fs.readFile(manifestFile, 'utf8')).toBe(bytes)
  expect((await fs.stat(external)).isFile()).toBe(true)
})
