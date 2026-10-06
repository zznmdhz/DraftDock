import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { test, expect } from 'vitest'
import { scanLibrary, saveDraft, selectSources } from '../src/main/library'

test('opens a nested image package with multiple sources and preserves drafts when changing sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftdock-package-'))
  try {
    const article = path.join(root, '分组', '文章')
    await fs.mkdir(path.join(article, '发布图片'), { recursive: true })
    await fs.mkdir(path.join(article, '.draftdock', 'outputs'), { recursive: true })
    const md = path.join(article, '01_标题与正文.md'), txt = path.join(article, '02_提示词.txt')
    await fs.writeFile(md, '# 推荐标题\n\n**真正标题**\n\n# 备选标题\n不要发布\n\n# 正文（可直接发布）\n\n发布正文\n\n# 话题标签\n#PPT\n\n# 置顶评论\n评论')
    await fs.writeFile(txt, '提示词补充')
    await fs.writeFile(path.join(article, '发布图片', '01.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>')
    await fs.writeFile(path.join(article, '.draftdock', 'outputs', 'ignored.md'), 'ignored')
    const direct = await scanLibrary(article)
    const library = await scanLibrary(root)
    expect(library.articles.map(a => a.id)).toEqual(direct.articles.map(a => a.id))
    const result = direct.articles[0]
    expect(result.images).toHaveLength(1)
    expect(result.sourceFiles).toHaveLength(2)
    expect(result.title).toBe('真正标题')
    expect(result.drafts.wechat?.markdown).toBe('发布正文')
    expect(result.drafts.xiaohongshu?.markdown).toBe('发布正文\n\n#PPT')
    await saveDraft(article, 'wechat', '旧标题', '用户编辑稿')
    await selectSources(article, [txt, md])
    const merged = (await scanLibrary(article)).articles[0]
    expect(merged.markdown.startsWith('提示词补充\n\n# 推荐标题')).toBe(true)
    expect(merged.selectedSources).toEqual([txt, md])
    await selectSources(article, [txt])
    expect((await scanLibrary(article)).articles[0].drafts.wechat?.markdown).toBe('提示词补充')
    const state = JSON.parse(await fs.readFile(path.join(article, '.draftdock', 'state.json'), 'utf8'))
    expect(state.history[0].drafts.wechat.markdown).toBe('用户编辑稿')
    expect(await fs.readFile(txt, 'utf8')).toBe('提示词补充')
    await expect(selectSources(article, [path.join(root, 'outside.md')])).rejects.toThrow()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
