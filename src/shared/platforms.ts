import { marked } from 'marked'
import twitterText from 'twitter-text'
import type { Platform, PlatformDraft, PublishingPlatform } from './types'

export interface ImagePreset { id: string; label: string; detail: string; width: number; height: number }
export interface CheckItem { id: string; level: 'error' | 'warning' | 'info'; message: string }
export interface PlatformProfile {
  id: PublishingPlatform; label: string; format: 'plain' | 'rich'; entry: string
  rulesUrl: string; verifiedAt: string; notes: string; titleLabel: string
  textLimit?: number; imageLimit?: number; presets: ImagePreset[]
}
export const PLATFORM_IDS: PublishingPlatform[] = ['wechat', 'xiaohongshu', 'x', 'zhihu']
export const PROFILES: Record<PublishingPlatform, PlatformProfile> = {
  wechat: { id: 'wechat', label: '微信公众号', format: 'rich', entry: '公众号后台 · 图文文章', rulesUrl: 'https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add', verifiedAt: '2026-10-06', notes: '图文后台与 API 限制不同。预设为工作尺寸，正文、标题和图数上限请以账号后台为准。', titleLabel: '文章标题', presets: [
    { id: 'wechat-cover', label: '2.35:1', detail: '横封面工作预设', width: 900, height: 383 },
    { id: 'wechat-square', label: '1:1', detail: '方形封面工作预设', width: 1080, height: 1080 },
    { id: 'wechat-body-43', label: '4:3', detail: '正文横图', width: 1200, height: 900 }
  ] },
  xiaohongshu: { id: 'xiaohongshu', label: '小红书', format: 'plain', entry: '创作中心 · 图文笔记', rulesUrl: 'https://creator.xiaohongshu.com/', verifiedAt: '2026-10-06', notes: '公开官方页面未核实统一字数和图数上限；长文与普通图文入口可能不同。可设置自己的账号工作预算。', titleLabel: '笔记标题', presets: [
    { id: 'xhs-portrait', label: '3:4', detail: '竖图工作预设', width: 1080, height: 1440 },
    { id: 'xhs-story', label: '9:16', detail: '全屏竖图', width: 1080, height: 1920 },
    { id: 'xhs-square', label: '1:1', detail: '方形图', width: 1080, height: 1080 }
  ] },
  x: { id: 'x', label: 'X', format: 'plain', entry: '标准单条 Post · 不含 Premium 长文', rulesUrl: 'https://help.x.com/en/using-x/how-to-post', verifiedAt: '2026-10-06', notes: '标准单条按 twitter-text 加权计数，链接折算。超长只提示，不自动截断；Premium/串文需单独规划。', titleLabel: '开头一句（可留空，计入正文）', textLimit: 280, imageLimit: 4, presets: [
    { id: 'x-landscape', label: '16:9', detail: '横图工作预设', width: 1600, height: 900 },
    { id: 'x-square', label: '1:1', detail: '方形图', width: 1200, height: 1200 }
  ] },
  zhihu: { id: 'zhihu', label: '知乎', format: 'rich', entry: '专栏文章 · 非问题回答', rulesUrl: 'https://zhuanlan.zhihu.com/write', verifiedAt: '2026-10-06', notes: '本版适配专栏文章。回答入口没有独立文章标题；统一字数、图片上限未从公开官方页面核实。', titleLabel: '专栏文章标题', presets: [
    { id: 'zhihu-landscape', label: '16:9', detail: '封面工作预设', width: 1600, height: 900 },
    { id: 'zhihu-body', label: '4:3', detail: '正文图', width: 1200, height: 900 }
  ] }
}
export function platformLabel(platform: Platform): string { return platform === 'master' ? '主稿' : PROFILES[platform].label }
interface TextToken { type?: string; text?: string; href?: string; tokens?: TextToken[]; items?: TextToken[]; header?: TextToken[]; rows?: TextToken[][]; ordered?: boolean; start?: number }
function tokenText(token: TextToken): string {
  const nested = () => token.tokens?.map(tokenText).join('') ?? token.text ?? ''
  if (token.type === 'image' || token.type === 'space' || token.type === 'def') return ''
  if (token.type === 'br') return '\n'
  if (token.type === 'code' || token.type === 'codespan') return token.text ?? ''
  if (token.type === 'link') { const text = nested(); return text === token.href ? text : `${text} (${token.href})` }
  if (token.type === 'html') return (token.text ?? '').replace(/<[^>]*>/g, '')
  if (token.type === 'list') return (token.items ?? []).map((item, i) => `${token.ordered ? `${(token.start ?? 1) + i}.` : '•'} ${tokenText(item)}`).join('\n')
  if (token.type === 'table') return [token.header ?? [], ...(token.rows ?? [])].map(row => row.map(tokenText).join(' | ')).join('\n')
  if (token.type === 'paragraph' || token.type === 'heading' || token.type === 'blockquote') return `${nested()}\n\n`
  return nested()
}
export function plainText(markdown: string): string {
  const source = markdown.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '')
  return (marked.lexer(source) as unknown as TextToken[]).map(tokenText).join('').replace(/\n{3,}/g, '\n\n').trim()
}
export function adaptBody(markdown: string, platform: Platform): string {
  return platform === 'x' || platform === 'xiaohongshu' ? plainText(markdown) : markdown.trim()
}
export function buildDelivery(platform: Platform, title: string, markdown: string): { body: string; plain: string; html: string } {
  // Keep the editable draft as Markdown; convert only at the delivery boundary.
  // Re-parsing already converted code would remove literal generic/HTML-like text.
  const text = plainText(markdown)
  const body = platform === 'x' || platform === 'xiaohongshu' ? text : markdown.trim()
  const combined = platform === 'x' && title.trim() && !text.startsWith(title.trim()) ? `${title.trim()}\n\n${text}` : text
  const escape = (value: string) => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
  return { body: platform === 'x' ? combined : body, plain: combined, html: platform === 'x' || platform === 'xiaohongshu' ? `<pre>${escape(combined)}</pre>` : marked.parse(body, { async: false }) as string }
}
export function textCount(platform: Platform, text: string): number { return platform === 'x' ? twitterText.parseTweet(text).weightedLength : [...text].length }
export function validateDraft(platform: PublishingPlatform, draft: PlatformDraft): CheckItem[] {
  const profile = PROFILES[platform], result: CheckItem[] = []
  const delivered = buildDelivery(platform, draft.title, draft.markdown)
  const length = textCount(platform, delivered.plain), images = draft.images ?? []
  if (!delivered.plain.trim()) result.push({ id: 'empty', level: 'error', message: '正文为空，请先完善内容。' })
  if (platform !== 'x' && !draft.title.trim()) result.push({ id: 'title', level: 'warning', message: '尚未填写独立标题。' })
  if (profile.textLimit && length > profile.textLimit) result.push({ id: 'text', level: 'error', message: `标准单条正文 ${length}/${profile.textLimit} 加权字符，需精简或改用长文/串文入口。` })
  if (profile.imageLimit && images.length > profile.imageLimit) result.push({ id: 'images', level: 'error', message: `标准单条图片 ${images.length}/${profile.imageLimit} 张，请减少所选图片。` })
  if (draft.status === 'published' && !/^https?:\/\/\S+$/i.test(draft.publishedUrl ?? '')) result.push({ id: 'published-link', level: 'warning', message: '已标记人工发布，建议补充有效发布链接以便追踪。' })
  for (const [key, count, label] of [['text', length, '正文'], ['title', [...draft.title].length, '标题'], ['images', images.length, '图片']] as const) {
    const limit = draft.limits?.[key]
    if (limit && count > limit) result.push({ id: `budget-${key}`, level: 'warning', message: `${label} ${count}/${limit}，超出自定义账号工作预算（不是官方限制）。` })
  }
  if (images.some(image => !image.outputPath)) result.push({ id: 'originals', level: 'info', message: '含未适配原图，交付时会保留原尺寸并转换为 PNG。' })
  result.push({ id: 'rules', level: 'info', message: `${profile.entry}。${profile.notes}` })
  return result
}
