import { expect, test } from 'vitest'
import { DraftBuffer } from '../src/renderer/src/draftBuffer'
import type { SaveDraftInput } from '../src/shared/types'

function input(platform: SaveDraftInput['platform'], markdown: string, articleFolder = 'article'): SaveDraftInput {
  return { articleFolder, platform, title: '标题', markdown, details: { account: '账号' } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('rapid changes collapse only the same article/platform and flush every independent key', async () => {
  const saved: SaveDraftInput[] = []
  const buffer = new DraftBuffer(async value => { saved.push(value) })
  const original = input('wechat', '公众号初稿')
  buffer.set(original)
  original.markdown = '调用方后续修改'
  buffer.set(input('wechat', '公众号最终稿'))
  buffer.set(input('xiaohongshu', '小红书稿'))
  buffer.set(input('wechat', '另一篇公众号', 'article-b'))
  await buffer.flush()
  expect(saved.map(value => [value.articleFolder, value.platform, value.markdown])).toEqual([
    ['article', 'wechat', '公众号最终稿'], ['article', 'xiaohongshu', '小红书稿'], ['article-b', 'wechat', '另一篇公众号']
  ])
  expect(buffer.size).toBe(0)
})

test('save failure leaves pending drafts intact and a retry succeeds without resubmitting successful keys', async () => {
  const saved: string[] = []
  let fail = true
  const buffer = new DraftBuffer(async value => {
    if (value.platform === 'x' && fail) throw new Error('磁盘暂不可写')
    saved.push(value.markdown)
  })
  buffer.set(input('wechat', '已写稿'))
  buffer.set(input('x', '失败稿'))
  buffer.set(input('zhihu', '未轮到的稿'))
  await expect(buffer.flush()).rejects.toThrow('磁盘暂不可写')
  expect(saved).toEqual(['已写稿'])
  expect(buffer.size).toBe(2)
  fail = false
  await buffer.flush()
  expect(saved).toEqual(['已写稿', '失败稿', '未轮到的稿'])
  expect(buffer.size).toBe(0)
})

test('one flush drains edits and new keys arriving while an earlier save is in flight', async () => {
  const gate = deferred<void>(), started = deferred<void>(), saved: string[] = []
  const buffer = new DraftBuffer(async value => {
    saved.push(value.markdown)
    if (value.markdown === '旧输入') { started.resolve(); await gate.promise }
  })
  buffer.set(input('wechat', '旧输入'))
  const flushing = buffer.flush()
  await started.promise
  buffer.set(input('wechat', '保存期间最终输入'))
  buffer.set(input('x', '保存期间另一平台'))
  gate.resolve()
  await flushing
  expect(saved).toEqual(['旧输入', '保存期间最终输入', '保存期间另一平台'])
  expect(buffer.size).toBe(0)
})

test('overlapping flushes serialize saves and keep same-key later edits', async () => {
  const gate = deferred<void>(), started = deferred<void>(), saved: string[] = []
  let active = 0, highest = 0
  const buffer = new DraftBuffer(async value => {
    active++; highest = Math.max(highest, active)
    saved.push(value.markdown)
    try { if (value.markdown === '旧输入') { started.resolve(); await gate.promise } }
    finally { active-- }
  })
  buffer.set(input('wechat', '旧输入'))
  const first = buffer.flush()
  await started.promise
  buffer.set(input('wechat', '新输入'))
  const second = buffer.flush()
  gate.resolve()
  await Promise.all([first, second])
  expect(saved).toEqual(['旧输入', '新输入'])
  expect(highest).toBe(1)
  expect(buffer.size).toBe(0)
})
