import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptMarkdown, scanLibrary } from '../src/main/library'

describe('content library', () => {
  it('treats each first-level folder as one article', async () => {
    const snapshot = await scanLibrary(path.resolve('examples/content-root'))
    expect(snapshot.articles).toHaveLength(1)
    expect(snapshot.articles[0].markdownPath).toMatch(/article\.md$/)
    expect(snapshot.articles[0].images).toHaveLength(2)
    expect(snapshot.articles[0].images.every((image) => image.extension === '.svg')).toBe(true)
  })

  it('derives a deterministic Xiaohongshu plain-text draft', () => {
    const source = '# 标题\n\n**重点**与[链接](https://example.com)\n\n![图](a.png)'
    expect(adaptMarkdown(source, 'xiaohongshu')).toBe('标题\n\n重点与链接')
  })
})
