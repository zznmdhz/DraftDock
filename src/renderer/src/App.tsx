import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import DOMPurify from 'dompurify'
import { Archive, Clipboard, FileDown, FolderOpen, Image as ImageIcon, RefreshCw, Search, Settings2, WandSparkles, X } from 'lucide-react'
import CropStudio from './CropStudio'
import { DraftBuffer } from './draftBuffer'
import { PLATFORM_IDS, PROFILES, buildDelivery, platformLabel, textCount, validateDraft } from '../../shared/platforms'
import type { ArticleRecord, DeliveryImage, ImageAsset, LibraryMode, LibrarySnapshot, Platform, PlatformDraft } from '../../shared/types'

const EMPTY: LibrarySnapshot = { rootPath: null, articles: [], scannedAt: '' }
const MODES: { id: LibraryMode; label: string; detail: string }[] = [
  { id: 'package', label: '单篇图包', detail: '正文和子目录图片属于同一篇文章' },
  { id: 'library', label: '多篇文章库', detail: '子文件夹作为文章，忽略根目录说明文件' },
  { id: 'auto', label: '自动识别', detail: '按素材分布寻找文章边界' }
]
function defaultDraft(article: ArticleRecord, platform: Platform): PlatformDraft {
  const draft = article.drafts[platform] ?? { title: article.title, markdown: article.markdown, updatedAt: '' }
  return { ...draft, images: draft.images ?? article.images.filter(image => !/(总览|预览|contact.?sheet)/i.test(image.name)).map(image => ({ sourcePath: image.path })), status: draft.status ?? 'draft' }
}
function draftKey(folder: string, platform: Platform): string { return `${folder}\0${platform}` }
function formatBytes(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(2)} MB` }

export default function App(): ReactElement {
  const [library, setLibrary] = useState(EMPTY)
  const [articleId, setArticleId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<Platform>('wechat')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<LibraryMode>('package')
  const [draft, setDraft] = useState<PlatformDraft>({ title: '', markdown: '', updatedAt: '', images: [] })
  const [sourceChoices, setSourceChoices] = useState<string[]>([])
  const [cropTarget, setCropTarget] = useState<ImageAsset | null>(null)
  const [busy, setBusy] = useState('正在读取文章库…')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [saveState, setSaveState] = useState('已保存')
  const [bundlePath, setBundlePath] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sessionRevision, setSessionRevision] = useState(0)
  const cache = useRef(new Map<string, PlatformDraft>())
  const buffer = useRef(new DraftBuffer(input => window.draftdock.saveDraft(input)))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingGeneration = useRef<Promise<void> | null>(null)
  const closeInProgress = useRef(false)
  const active = library.articles.find(article => article.id === articleId) ?? library.articles[0] ?? null
  const current = useRef({ active, platform, draft })
  current.current = { active, platform, draft }
  const key = active ? draftKey(active.folderPath, platform) : ''
  const selected = draft.images ?? []
  const profile = platform === 'master' ? null : PROFILES[platform]
  const delivery = useMemo(() => buildDelivery(platform, draft.title, draft.markdown), [platform, draft.title, draft.markdown])
  const checks = platform === 'master' ? [] : validateDraft(platform, draft)
  const missingImages = selected.filter(image => !active?.images.some(asset => asset.path === image.sourcePath))
  if (missingImages.length) checks.push({ id: 'missing-images', level: 'error', message: `${missingImages.length} 张已选原图已移动或删除，请移除失效选择。` })
  if (selected.some(image => image.outputPath && !active?.images.find(asset => asset.path === image.sourcePath)?.derivatives.some(item => item.outputPath === image.outputPath && item.platform === platform))) checks.push({ id: 'missing-versions', level: 'error', message: '部分所选派生版本已失效，请选择原图或重新生成。' })
  const blocked = checks.some(item => item.level === 'error')
  const notice = (message: string): void => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4500)
  }
  const flush = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    if (!buffer.current.size) return
    setSaveState('正在保存…')
    try { await buffer.current.flush(); setSaveState(buffer.current.size ? '待保存' : '已保存') }
    catch (cause) { setSaveState('保存失败 · 点击重试'); throw cause }
  }
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label); setError('')
    try { await action() }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); window.draftdock.report({ level: 'error', event: 'operation.failed', message: `${label}: ${message}` }) }
    finally { if (!closeInProgress.current) setBusy('') }
  }
  const update = (patch: Partial<PlatformDraft>): void => {
    if (!active) return
    const next = { ...current.current.draft, ...patch, updatedAt: new Date().toISOString() }
    current.current.draft = next
    setDraft(next)
    cache.current.set(key, next)
    const { title, markdown, updatedAt: _time, ...details } = next
    buffer.current.set({ articleFolder: active.folderPath, platform, title, markdown, details })
    setSaveState('待保存')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(cause => setError(String(cause))) }, 600)
  }
  const invalidate = (folder: string): void => { for (const savedKey of cache.current.keys()) if (savedKey.startsWith(`${folder}\0`)) cache.current.delete(savedKey) }
  const adopt = (snapshot: LibrarySnapshot): void => { setLibrary(snapshot); setBundlePath('') }

  useEffect(() => {
    let alive = true
    void window.draftdock.getLibrary().then(snapshot => { if (alive) { setLibrary(snapshot); setArticleId(snapshot.articles[0]?.id ?? null); setBusy('') } }).catch(cause => { if (alive) { setError(String(cause)); setBusy('') } })
    const unsubscribe = window.draftdock.onLibraryChanged(snapshot => { if (alive) setLibrary(snapshot) })
    const close = window.draftdock.onBeforeClose(async () => {
      closeInProgress.current = true
      setBusy('正在保存…')
      try { await pendingGeneration.current; await buffer.current.flush() }
      catch (cause) { closeInProgress.current = false; setBusy(''); setSaveState('保存失败 · 点击重试'); setError(String(cause)); throw cause }
    })
    return () => { alive = false; unsubscribe(); close(); if (timer.current) clearTimeout(timer.current); if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])
  useEffect(() => {
    if (!active) return
    const next = cache.current.get(key) ?? defaultDraft(active, platform)
    setDraft(next); current.current.draft = next
    setSourceChoices(active.selectedSources); setBundlePath('')
  }, [key, active?.sourceRevision, active?.markdown, sessionRevision])

  const switchPlatform = (target: Platform): void => { void run('保存并切换平台…', async () => { await flush(); setCropTarget(null); setPlatform(target) }) }
  const switchArticle = (article: ArticleRecord): void => { void run('保存并切换文章…', async () => { await flush(); setCropTarget(null); setArticleId(article.id) }) }
  const chooseRoot = (): void => { void run('打开内容目录…', async () => { await flush(); const snapshot = await window.draftdock.chooseRoot(mode); cache.current.clear(); adopt(snapshot); setSessionRevision(value => value + 1); setArticleId(snapshot.articles[0]?.id ?? null) }) }
  const refresh = (): void => { void run('重新扫描…', async () => { await flush(); const snapshot = await window.draftdock.refreshLibrary(); cache.current.clear(); adopt(snapshot); setSessionRevision(value => value + 1); notice('文章库已更新') }) }
  const applySources = (): void => { if (!active) return; void run('重建平台稿…', async () => { await flush(); const snapshot = await window.draftdock.selectSources(active.folderPath, sourceChoices); invalidate(active.folderPath); adopt(snapshot); notice('已重建工作稿，旧稿可在历史记录中恢复') }) }
  const restore = (id: string): void => { if (!active) return; void run('恢复历史稿…', async () => { await flush(); const snapshot = await window.draftdock.restoreHistory(active.folderPath, id); invalidate(active.folderPath); adopt(snapshot); notice('已恢复历史稿，恢复前的稿件也已备份') }) }
  const copy = (): void => { void run('复制正文…', async () => { await flush(); await window.draftdock.writeClipboard({ markdown: delivery.body, mode: profile?.format === 'rich' ? 'rich' : platform === 'master' ? 'markdown' : 'plain' }); notice(blocked ? '正文已复制；发布前仍需解决检查中的超限问题' : '已复制当前平台正文') }) }
  const exportBundle = (): void => {
    if (!active || platform === 'master') return
    void run('生成发布交付包…', async () => { await flush(); const result = await window.draftdock.exportBundle({ articleFolder: active.folderPath, platform, draft }); setBundlePath(result.outputFolder); notice(`已生成 ${result.imageCount} 张图片的交付包${result.warnings.length ? '，请查看交付清单中的提示' : ''}`) })
  }
  const exportWord = (): void => { if (!active) return; void run('导出 Word…', async () => { await flush(); const result = await window.draftdock.exportDocx({ articleFolder: active.folderPath, title: draft.title, markdown: delivery.body, imagePaths: selected.map(image => image.outputPath ?? image.sourcePath), suggestedName: `${draft.title || '未命名'}-${platformLabel(platform)}` }); if (result) notice('Word 文档已导出') }) }
  const generate = async (asset: ImageAsset, options: Parameters<React.ComponentProps<typeof CropStudio>['onGenerate']>[0]): Promise<void> => {
    if (!active || platform === 'master') return
    const originKey = key, originFolder = active.folderPath, originPlatform = platform
    const originalDraft = structuredClone(current.current.draft)
    setBusy('正在生成并保存交付图…')
    const operation = (async () => { try {
      const output = await window.draftdock.generateAsset({ articleFolder: originFolder, sourcePath: asset.path, platform: originPlatform, presetId: options.preset.id, width: options.preset.width, height: options.preset.height, mode: options.mode, composition: options.composition, background: options.background })
      const latest = cache.current.get(originKey) ?? originalDraft, images = latest.images ?? []
      const next = { ...latest, images: images.some(image => image.sourcePath === asset.path) ? images.map(image => image.sourcePath === asset.path ? { ...image, outputPath: output.outputPath } : image) : [...images, { sourcePath: asset.path, outputPath: output.outputPath }] }
      cache.current.set(originKey, next)
      const { title, markdown, updatedAt: _time, ...details } = next
      buffer.current.set({ articleFolder: originFolder, platform: originPlatform, title, markdown, details })
      if (current.current.active?.folderPath === originFolder && current.current.platform === originPlatform) { setDraft(next); current.current.draft = next }
      await flush()
      notice('新图已生成，并选为当前平台交付版本')
    } catch (cause) { setError(String(cause)); throw cause } })()
    pendingGeneration.current = operation
    try { await operation } finally { pendingGeneration.current = null; if (!closeInProgress.current) setBusy('') }
  }
  const toggleImage = (asset: ImageAsset, checked: boolean): void => update({ images: checked ? [...selected, { sourcePath: asset.path }] : selected.filter(image => image.sourcePath !== asset.path) })
  const moveImage = (sourcePath: string, direction: -1 | 1): void => {
    const list = [...selected], index = list.findIndex(image => image.sourcePath === sourcePath), target = index + direction
    if (index < 0 || target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    update({ images: list })
  }
  const displayedImages = active ? [...active.images].sort((a, b) => {
    const ai = selected.findIndex(image => image.sourcePath === a.path), bi = selected.findIndex(image => image.sourcePath === b.path)
    return (ai < 0 ? 999999 : ai) - (bi < 0 ? 999999 : bi)
  }) : []
  const filtered = library.articles.filter(article => `${article.title} ${article.folderName}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'all' || ((cache.current.get(draftKey(article.folderPath, platform)) ?? article.drafts[platform])?.status ?? 'draft') === statusFilter))

  if (!library.rootPath) return <div className="onboarding-shell"><div className="onboarding-card"><div className="logo large">稿</div><span className="overline">DRAFTDOCK · MULTI-PLATFORM WORKSPACE</span><h1>一次整理，准备多个平台</h1><p>选择文章库或单篇图包，读取正文和图片。每个平台独立编辑、检查、排序并生成发布材料。</p><div className="mode-options">{MODES.map(item => <label key={item.id}><input type="radio" name="mode" checked={mode === item.id} onChange={() => setMode(item.id)}/><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div><button className="button primary large-button" disabled={!!busy} onClick={chooseRoot}><FolderOpen size={18}/>选择内容根目录</button>{busy && <p role="status">{busy}</p>}{error && <div className="error-banner" role="alert">{error}<button onClick={refresh}>重试</button></div>}<button className="link-button" onClick={() => void window.draftdock.openLogs()}>打开诊断日志</button></div></div>

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="logo">稿</div><div><strong>稿间</strong><span>DraftDock 0.2</span></div></div><nav className="platform-tabs">{(['master', ...PLATFORM_IDS] as Platform[]).map(item => <button key={item} disabled={!!busy} className={platform === item ? 'active' : ''} onClick={() => switchPlatform(item)}>{platformLabel(item)}</button>)}</nav><div className="header-actions"><button className={`save-status ${saveState.includes('失败') ? 'failed' : ''}`} onClick={() => void run('保存工作稿…', flush)} disabled={!!busy}>{saveState}</button><button className="icon-btn dark" title="重新扫描" disabled={!!busy} onClick={refresh}><RefreshCw size={17}/></button><button className="icon-btn dark" title="诊断日志" onClick={() => void window.draftdock.openLogs()}><Settings2 size={17}/></button></div></header>
    {(busy || error) && <div className={`activity-banner ${error ? 'error-banner' : ''}`} role={error ? 'alert' : 'status'}>{error || busy}{error && <><button onClick={() => void run('重试保存…', flush)}>重试保存</button><button onClick={() => setError('')} aria-label="关闭错误提示"><X size={15}/></button></>}</div>}
    <main className="workbench">
      <aside className="article-panel"><div className="panel-header"><div><span className="overline">CONTENT LIBRARY</span><h2>文章目录</h2></div><button className="icon-btn" disabled={!!busy} onClick={chooseRoot} title="更换目录"><FolderOpen size={18}/></button></div><div className="root-card"><span><strong>{library.rootPath.split(/[\\/]/).pop()}</strong><small title={library.rootPath}>{library.rootPath}</small></span></div><select className="mode-select" value={mode} onChange={event => setMode(event.target.value as LibraryMode)} aria-label="下次打开目录的模式">{MODES.map(item => <option value={item.id} key={item.id}>下次打开：{item.label}</option>)}</select><small className="mode-caption">当前：{MODES.find(item => item.id === library.mode)?.label ?? '自动识别'}</small><label className="search-box"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文章"/></label><select className="mode-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="按当前平台状态筛选"><option value="all">全部状态</option><option value="draft">编辑中</option><option value="ready">待人工发布</option><option value="published">已人工发布</option></select><div className="list-meta"><span>{filtered.length} 篇文章</span><span>当前平台状态</span></div><div className="article-list">{filtered.map(article => <button disabled={!!busy} className={`article-row ${active?.id === article.id ? 'active' : ''}`} key={article.id} onClick={() => switchArticle(article)}><span className="folder-glyph"><Archive size={16}/></span><span className="article-copy"><strong>{article.title}</strong><small>{article.images.length} 张图片 · {article.selectedSources.length} 份来源</small><em>{(cache.current.get(draftKey(article.folderPath, platform)) ?? article.drafts[platform])?.status === 'published' ? '已人工发布' : (cache.current.get(draftKey(article.folderPath, platform)) ?? article.drafts[platform])?.status === 'ready' ? '待人工发布' : '编辑中'}</em></span>{article.warnings.length > 0 && <span className="warning-count">{article.warnings.length}</span>}</button>)}</div>{library.warnings?.length ? <div className="warning-box">{library.warnings.map(message => <span key={message}>{message}</span>)}</div> : null}<footer className="article-footer">本地保存 · 自动监听</footer></aside>
      {active ? <>
        <section className="image-panel"><div className="panel-header"><div><span className="overline">DELIVERY IMAGES</span><h2>图片工作区 <b>{selected.length}/{active.images.length}</b></h2></div><span className="read-only-badge">原图只读</span></div><div className="image-toolbar"><button disabled={!!busy} onClick={() => update({ images: active.images.map(image => selected.find(item => item.sourcePath === image.path) ?? { sourcePath: image.path }) })}>全选</button><button disabled={!!busy} onClick={() => update({ images: [] })}>清空选择</button><span>上下箭头调整发布顺序</span></div>{active.warnings.length > 0 && <div className="warning-box">{active.warnings.map(message => <span key={message}>{message}</span>)}</div>}<div className="image-list">{displayedImages.map(asset => <ImageCard key={asset.id} asset={asset} platform={platform} selected={selected.find(image => image.sourcePath === asset.path)} index={selected.findIndex(image => image.sourcePath === asset.path)} count={selected.length} disabled={!!busy} onSelect={checked => toggleImage(asset, checked)} onMove={direction => moveImage(asset.path, direction)} onVersion={outputPath => update({ images: selected.map(image => image.sourcePath === asset.path ? { ...image, outputPath: outputPath || undefined } : image) })} onAdapt={() => setCropTarget(asset)}/>)}{!active.images.length && <div className="empty-state"><ImageIcon size={36}/><strong>暂无图片</strong><span>将图片放入文章文件夹后刷新即可。</span></div>}</div></section>
        <section className="editor-panel"><div className="panel-header"><div><span className="overline">CONTENT & DELIVERY</span><h2>正文与交付</h2></div><span className={`platform-badge ${platform}`}>{platformLabel(platform)}</span></div><div className="editor-scroll">
          <label className="title-field"><span>{profile?.titleLabel ?? '主稿标题'}</span><input disabled={!!busy} value={draft.title} onChange={event => update({ title: event.target.value })}/><small>{[...draft.title].length} 字 <button onClick={() => void run('复制标题…', () => window.draftdock.writeClipboard({ markdown: draft.title, mode: 'plain' }))}>复制标题</button></small></label>
          <div className="source-line"><span>正文来源</span><code>{active.selectedSources.map(file => file.split(/[\\/]/).pop()).join(' + ') || '尚未选择'}</code></div>
          {missingImages.length > 0 && <div className="warning-box"><span>已选原图失效：{missingImages.map(image => image.sourcePath.split(/[\\/]/).pop()).join('、')}</span><button className="button" disabled={!!busy} onClick={() => update({ images: selected.filter(image => !missingImages.includes(image)) })}>移除失效选择（保留其他顺序）</button></div>}
          {active.sourceChanged && <div className="warning-box"><span>来源文件已更新。现有编辑稿已保留；确认后可从来源重建并归档旧稿。</span></div>}
          <details className="source-selector"><summary>正文来源与历史恢复</summary><p>勾选顺序就是合并顺序。重建会更新全部平台稿，旧稿可恢复。</p>{active.sourceFiles.map(file => <label key={file.path}><input type="checkbox" checked={sourceChoices.includes(file.path)} disabled={!!busy} onChange={event => setSourceChoices(choices => event.target.checked ? [...choices, file.path] : choices.filter(choice => choice !== file.path))}/>{sourceChoices.includes(file.path) ? `${sourceChoices.indexOf(file.path) + 1}. ` : ''}{file.name}</label>)}<button className="button" disabled={!!busy || !sourceChoices.length} onClick={applySources}>从所选来源重建</button><div className="history-list">{active.history?.length ? active.history.slice().reverse().map(item => <div key={item.id}><span>{new Date(item.savedAt).toLocaleString()} · {item.selectedSources?.length ?? 0} 份来源</span><button disabled={!!busy} onClick={() => restore(item.id)}>恢复</button></div>) : <small>尚无来源切换历史</small>}</div></details>
          <div className="edit-card"><div className="card-title"><span>{platform === 'master' ? '主稿编辑' : '平台版本编辑'}</span><em>{saveState}</em></div><textarea aria-label="平台正文" disabled={!!busy} value={draft.markdown} onChange={event => update({ markdown: event.target.value })} spellCheck={false}/></div>
          {profile && <><section className="preflight"><h3>发布前检查 <span>{textCount(platform, delivery.plain)}{profile.textLimit ? `/${profile.textLimit}` : ''} {platform === 'x' ? '加权字符' : '字'} · {selected.length} 张图</span></h3>{checks.map(item => <p key={item.id} className={`check-${item.level}`}>{item.level === 'error' ? '需处理' : item.level === 'warning' ? '提醒' : '说明'} · {item.message}</p>)}<a href={profile.rulesUrl} target="_blank" rel="noreferrer">官方入口与规则</a><small>核验：{profile.verifiedAt}；预设比例为工作建议。</small></section><details className="source-selector"><summary>账号与运营记录</summary><label>目标账号标记<input placeholder="例如：个人号 / 品牌号" value={draft.account ?? ''} disabled={!!busy} onChange={event => update({ account: event.target.value })}/></label><label>工作状态<select value={draft.status ?? 'draft'} disabled={!!busy} onChange={event => update({ status: event.target.value as PlatformDraft['status'] })}><option value="draft">编辑中</option><option value="ready">待人工发布</option><option value="published">已人工发布</option></select></label><label>发布链接<input value={draft.publishedUrl ?? ''} disabled={!!busy} placeholder="在平台发布后手动记录" onChange={event => update({ publishedUrl: event.target.value })}/></label><label>备注<input value={draft.notes ?? ''} disabled={!!busy} onChange={event => update({ notes: event.target.value })}/></label><p>以下为你的账号工作预算，留空表示不设；它们不代表官方限制。</p><div className="budget-fields">{(['title', 'text', 'images'] as const).map(field => <label key={field}>{field === 'title' ? '标题字数' : field === 'text' ? '正文字数' : '图片张数'}<input type="number" min="1" max="1000000" value={draft.limits?.[field] ?? ''} disabled={!!busy} onChange={event => update({ limits: { ...draft.limits, [field]: event.target.value ? Math.max(1, Number(event.target.value)) : undefined } })}/></label>)}</div></details></>}
          <div className="preview-card"><div className="card-title"><span>交付正文预览</span><em>{profile?.format === 'plain' ? '纯文本' : '富文本结构'}</em></div>{profile?.format === 'plain' ? <pre className="plain-preview">{delivery.plain}</pre> : <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(delivery.html) }}/>}</div>
          {bundlePath && <div className="bundle-result"><strong>交付包已生成</strong><code>{bundlePath}</code><button className="button" onClick={() => void window.draftdock.openPath(bundlePath)}>打开交付文件夹</button></div>}
        </div><footer className="delivery-footer"><div><span>{selected.length} 张交付图 · 当前发布顺序</span><small>导出材料后，在平台人工发布</small></div><div><button className="button ghost" disabled={!!busy} onClick={exportWord}><FileDown size={15}/>Word</button><button className="button ghost" disabled={!!busy} onClick={copy}><Clipboard size={15}/>复制正文</button>{profile && <button className="button primary" title={blocked ? '请先处理发布前检查中的问题' : '导出文字、图片和清单'} disabled={!!busy || blocked} onClick={exportBundle}>生成发布包</button>}</div></footer></section>
      </> : <div className="no-articles"><Archive size={40}/><h2>没有找到可识别的文章</h2><p>选择“单篇图包”打开具体文章，或选择“文章库”打开它的上级目录。</p><button className="button" onClick={chooseRoot}>重新选择</button></div>}
    </main>{cropTarget && platform !== 'master' && <CropStudio key={`${cropTarget.id}-${platform}`} asset={cropTarget} platform={platform} onClose={() => setCropTarget(null)} onGenerate={options => generate(cropTarget, options)}/>}{toast && <div role="status" className="toast">{toast}</div>}
  </div>
}

interface ImageCardProps { asset: ImageAsset; platform: Platform; selected?: DeliveryImage; index: number; count: number; disabled: boolean; onSelect(value: boolean): void; onMove(direction: -1 | 1): void; onVersion(path: string): void; onAdapt(): void }
function ImageCard({ asset, platform, selected, index, count, disabled, onSelect, onMove, onVersion, onAdapt }: ImageCardProps): ReactElement {
  const versions = asset.derivatives.filter(item => item.platform === platform)
  const chosen = selected?.outputPath ? versions.find(item => item.outputPath === selected.outputPath) : undefined
  return <div className={`image-card ${selected ? 'image-selected' : ''}`}><div className="order-controls">{selected && <><button title="上移" disabled={disabled || index === 0} onClick={() => onMove(-1)}>↑</button><button title="下移" disabled={disabled || index === count - 1} onClick={() => onMove(1)}>↓</button></>}</div><div className="full-thumbnail">{asset.thumbnailDataUrl ? <img src={asset.thumbnailDataUrl} alt={asset.name}/> : <ImageIcon size={28}/>}<span>{selected ? String(index + 1).padStart(2, '0') : '未选'}</span><input type="checkbox" disabled={disabled} checked={!!selected} onChange={event => onSelect(event.target.checked)} aria-label={`选择 ${asset.name}`}/></div><div className="image-info"><strong title={asset.name}>{asset.name}</strong><small>{asset.width} × {asset.height} · {formatBytes(asset.size)}</small><div className="image-actions"><button className="mini-button" onClick={() => void window.draftdock.revealPath(asset.path)}>原图</button>{platform !== 'master' && <button className="mini-button accent" disabled={disabled || !asset.thumbnailDataUrl} onClick={onAdapt}><WandSparkles size={14}/>适配并生成</button>}</div>{selected && <select disabled={disabled} aria-label={`${asset.name}交付版本`} value={selected.outputPath ?? ''} onChange={event => onVersion(event.target.value)}><option value="">原图 · 保留尺寸</option>{versions.map((item, i) => <option value={item.outputPath} key={item.id}>版本 {i + 1} · {item.presetId} · {item.width}×{item.height}</option>)}</select>}{selected?.outputPath && !chosen && <small className="check-error">所选版本未找到，请重新选择</small>}{selected && <button className="mini-button drag-output" draggable onDragStart={event => { event.preventDefault(); window.draftdock.startDrag(selected.outputPath ?? asset.path) }} onClick={() => void window.draftdock.revealPath(selected.outputPath ?? asset.path)}>拖出所选交付图</button>}</div></div>
}
