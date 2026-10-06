import { describe, expect, it } from 'vitest'
import { buildDelivery, plainText, PROFILES, textCount, validateDraft } from '../src/shared/platforms'
import type { PlatformDraft } from '../src/shared/types'

const draft: PlatformDraft = { title: '', markdown: 'hello', updatedAt: '', images: [] }
describe('platform-aware delivery checks', () => {
  it('uses weighted X counts for CJK, emoji sequences and links, not UTF-16 length', () => {
    expect(textCount('x', '中'.repeat(140))).toBe(280)
    expect(textCount('x', '👨‍👩‍👧‍👦')).toBe(2)
    expect(textCount('x', 'https://example.com/a-very-long-path')).toBe(23)
    expect(textCount('x', 'é')).toBe(textCount('x', 'e\u0301'))
  })
  it('counts X intro together with body and rejects 5 chosen images', () => {
    expect(buildDelivery('x', 'Intro', 'Body').plain).toBe('Intro\n\nBody')
    const over = { ...draft, markdown: '中'.repeat(141), images: Array.from({ length: 5 }, (_, i) => ({ sourcePath: String(i) })) }
    expect(validateDraft('x', over).filter(c => c.level === 'error').map(c => c.id)).toEqual(['text', 'images'])
    expect(over.markdown).toHaveLength(141)
  })
  it('keeps unknown platform limits unknown and custom budgets are only warnings', () => {
    for (const platform of ['xiaohongshu', 'wechat', 'zhihu'] as const) {
      expect(PROFILES[platform].textLimit).toBeUndefined()
      const checks = validateDraft(platform, { ...draft, markdown: '12345', limits: { text: 3 } })
      expect(checks.some(c => c.id === 'budget-text' && c.level === 'warning')).toBe(true)
      expect(checks.some(c => c.level === 'error')).toBe(false)
    }
  })
  it('preserves code, links and table meaning in plain text without literal markdown fences', () => {
    const text = plainText('# Heading\n\n**bold** [source](https://example.com)\n\n```ts\nconst x: Array<T> = [];\n```\n\n|A|B|\n|-|-|\n|1|2|')
    expect(text).toContain('const x: Array<T> = [];')
    expect(text).toContain('source (https://example.com)')
    expect(text).toContain('A | B')
    expect(text).not.toContain('```')
    for (const platform of ['x', 'xiaohongshu'] as const) {
      const result = buildDelivery(platform, '', '```ts\nconst x: Array<T> = [];\n```')
      expect(result.body).toBe('const x: Array<T> = [];')
      expect(result.plain).toBe(result.body)
      expect(result.html).toContain('Array&lt;T&gt;')
    }
  })
})
