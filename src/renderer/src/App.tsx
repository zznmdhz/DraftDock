import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Archive, CheckCircle2, ChevronRight, Clipboard, FileDown, FolderOpen, GripVertical, Image as ImageIcon, RefreshCw, Search, Settings2, Sparkles, WandSparkles } from 'lucide-react'
import CropStudio from './CropStudio'
import type { ArticleRecord, DerivedAsset, ImageAsset, LibrarySnapshot, Platform } from '../../shared/types'

const EMPTY: LibrarySnapshot = { rootPath: null, articles: [], scannedAt: new Date(0).toISOString() }
const PLATFORM_LABELS: Record<Platform, string> = { master: '主稿', wechat: '公众号文章', xiaohongshu: '小红书图文' }

function formatBytes(bytes: number): string { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB` }
function formatDate(iso: string): string { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) }

export default function App(): ReactElement {
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY)
  const [articleId, setArticleId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<Platform>('wechat')
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set())
  const [cropTarget, setCropTarget] = useState<ImageAsset | null>(null)
  const [toast, setToast] = useState('')
  const activeArticle = library.articles.find((article) => article.id === articleId) ?? library.articles[0] ?? null
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    void window.draftdock.getLibrary().then((snapshot) => { setLibrary(snapshot); setArticleId(snapshot.articles[0]?.id ?? null) })
    return window.draftdock.onLibraryChanged((snapshot) => setLibrary(snapshot))
  }, [])

  useEffect(() => {
    if (!activeArticle) return
    const draft = activeArticle.drafts[platform] ?? activeArticle.drafts.master
    setTitle(draft?.title ?? activeArticle.title)
    setMarkdown(draft?.markdown ?? activeArticle.markdown)
    setSelectedImages(new Set(activeArticle.images.map((image) => image.path)))
  }, [activeArticle?.id, platform])

  useEffect(() => {
    if (!activeArticle) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void window.draftdock.saveDraft({ articleFolder: activeArticle.folderPath, platform, title, markdown })
    }, 600)
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current) }
  }, [title, markdown, platform, activeArticle?.folderPath])

  const htmlPreview = useMemo(() => DOMPurify.sanitize(marked.parse(markdown) as string), [markdown])
  const filteredArticles = library.articles.filter((article) => `${article.title} ${article.folderName}`.toLowerCase().includes(query.toLowerCase()))
  const showToast = (message: string): void => { setToast(message); window.setTimeout(() => setToast(''), 2200) }

  const chooseRoot = async (): Promise<void> => {
    const snapshot = await window.draftdock.chooseRoot(); setLibrary(snapshot); setArticleId(snapshot.articles[0]?.id ?? null)
  }

  const refresh = async (): Promise<void> => { const snapshot = await window.draftdock.refreshLibrary(); setLibrary(snapshot); showToast(`已重新扫描 ${snapshot.articles.length} 篇文章`) }

  const generateAsset = async (asset: ImageAsset, options: Parameters<NonNullable<React.ComponentProps<typeof CropStudio>['onGenerate']>>[0]): Promise<void> => {
    if (!activeArticle || platform === 'master') return
    const result = await window.draftdock.generateAsset({
      articleFolder: activeArticle.folderPath, sourcePath: asset.path, platform,
      presetId: options.preset.id, width: options.preset.width, height: options.preset.height,
      mode: options.mode, crop: options.crop, background: options.background
    })
    showToast(`已生成 ${result.width} × ${result.height} 交付图，原图未修改`)
  }

  const copy = async (): Promise<void> => {
    const mode = platform === 'wechat' ? 'rich' : platform === 'xiaohongshu' ? 'plain' : 'markdown'
    await window.draftdock.writeClipboard({ markdown, mode }); showToast(`已复制${PLATFORM_LABELS[platform]}内容`)
  }

  const exportWord = async (): Promise<void> => {
    if (!activeArticle) return
    const output = await window.draftdock.exportDocx({ articleFolder: activeArticle.folderPath, title, markdown, imagePaths: [...selectedImages], suggestedName: `${title}-${PLATFORM_LABELS[platform]}` })
    if (output) showToast('Word 文档已导出')
  }

  if (!library.rootPath) return <div className="onboarding-shell">
    <div className="onboarding-card"><div className="logo large">稿</div><span className="overline">DRAFTDOCK FOR WINDOWS</span><h1>从内容目录开始，而不是从“导入”开始</h1><p>选择一个根目录。稿间会把每个一级子文件夹识别为一篇文章，自动读取其中唯一的 Markdown 主稿和全部图片。</p>
      <button className="button primary large-button" onClick={() => void chooseRoot()}><FolderOpen size={19}/>选择内容根目录</button>
      <div className="folder-rule"><code>内容根目录 / 文章文件夹 / article.md + images.*</code><span>内容只在本机处理</span></div></div>
  </div>

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="logo">稿</div><div><strong>稿间</strong><span>DraftDock</span></div></div>
      <nav className="platform-tabs">{(['master','wechat','xiaohongshu'] as Platform[]).map((item) => <button key={item} className={platform === item ? 'active' : ''} onClick={() => setPlatform(item)}>{PLATFORM_LABELS[item]}</button>)}</nav>
      <div className="header-actions"><span className="local-badge"><i/>本地工作区</span><button className="icon-btn dark" title="重新扫描" onClick={() => void refresh()}><RefreshCw size={17}/></button><button className="button primary" onClick={() => void copy()}><Clipboard size={16}/>复制当前版本</button></div>
    </header>

    <main className="workbench">
      <aside className="article-panel">
        <div className="panel-header"><div><span className="overline">CONTENT ROOT</span><h2>文章目录</h2></div><button className="icon-btn" onClick={() => void chooseRoot()} title="更换目录"><Settings2 size={18}/></button></div>
        <button className="root-card" onClick={() => void window.draftdock.openPath(library.rootPath!)}><FolderOpen size={18}/><span><strong>{library.rootPath.split(/[\\/]/).pop()}</strong><small title={library.rootPath}>{library.rootPath}</small></span><ChevronRight size={16}/></button>
        <label className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文章文件夹"/></label>
        <div className="list-meta"><span>{filteredArticles.length} 篇文章</span><span>每个文件夹一篇</span></div>
        <div className="article-list">{filteredArticles.map((article) => <button key={article.id} className={`article-row ${activeArticle?.id === article.id ? 'active' : ''}`} onClick={() => setArticleId(article.id)}>
          <span className="folder-glyph"><Archive size={16}/></span><span className="article-copy"><strong>{article.title}</strong><small>{article.images.length} 张图片 · {article.markdownPath ? '1 份主稿' : '缺少主稿'}</small><em>{formatDate(article.modifiedAt)}</em></span>
          {article.warnings.length ? <span className="warning-count">{article.warnings.length}</span> : <CheckCircle2 className="ok-icon" size={16}/>}</button>)}</div>
        <footer className="article-footer"><span>自动监听目录变化</span><i/></footer>
      </aside>

      {activeArticle ? <>
        <section className="image-panel">
          <div className="panel-header"><div><span className="overline">VISUAL ASSETS</span><h2>图片工作区 <b>{activeArticle.images.length}</b></h2></div><span className="read-only-badge">原图只读</span></div>
          <div className="source-summary"><ImageIcon size={18}/><span><strong>{activeArticle.folderName}</strong><small>PNG / JPG / SVG 等图片会自动列出；输出文件不回流到原图列表。</small></span></div>
          {activeArticle.warnings.length > 0 && <div className="warning-box">{activeArticle.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
          <div className="image-list">{activeArticle.images.length ? activeArticle.images.map((asset, index) => <ImageCard key={asset.id} asset={asset} index={index} platform={platform} selected={selectedImages.has(asset.path)} onSelect={(checked) => setSelectedImages((current) => { const next = new Set(current); checked ? next.add(asset.path) : next.delete(asset.path); return next })} onAdapt={() => setCropTarget(asset)}/>) : <div className="empty-state"><ImageIcon size={36}/><strong>这个文章文件夹里还没有图片</strong><span>把图片保存到文件夹后，稿间会自动刷新。</span></div>}</div>
        </section>

        <section className="editor-panel">
          <div className="panel-header"><div><span className="overline">CONTENT & DELIVERY</span><h2>正文与交付</h2></div><span className={`platform-badge ${platform}`}>{PLATFORM_LABELS[platform]}</span></div>
          <div className="editor-scroll">
            <label className="title-field"><span>标题</span><input value={title} onChange={(e) => setTitle(e.target.value)}/><small>{title.length} 字 · 从同一份 Markdown 派生</small></label>
            <div className="source-line"><span><Sparkles size={15}/>数据来源</span><code>{activeArticle.markdownPath?.split(/[\\/]/).pop() ?? '未找到 Markdown'}</code></div>
            <div className="edit-card"><div className="card-title"><span>平台版本编辑</span><em>修改自动保存到 .draftdock/state.json</em></div><textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} spellCheck={false}/></div>
            <div className="preview-card"><div className="card-title"><span>输出预览</span><em>{platform === 'wechat' ? '富文本结构' : platform === 'xiaohongshu' ? '纯文本排版' : 'Markdown 结构'}</em></div>{platform === 'xiaohongshu' ? <pre className="plain-preview">{markdown}</pre> : <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: htmlPreview }}/>}</div>
          </div>
          <footer className="delivery-footer"><div><span>{selectedImages.size} 张图片将加入 Word</span><small>图片交付仍按中栏顺序单独处理</small></div><div><button className="button ghost" onClick={() => void exportWord()}><FileDown size={16}/>导出 DOCX</button><button className="button primary" onClick={() => void copy()}><Clipboard size={16}/>复制{platform === 'wechat' ? '富文本' : platform === 'xiaohongshu' ? '纯文本' : ' Markdown'}</button></div></footer>
        </section>
      </> : <div className="no-articles"><Archive size={42}/><h2>根目录中还没有可识别的文章</h2><p>新建一级子文件夹，并放入一份 Markdown 与若干图片。</p></div>}
    </main>

    {cropTarget && platform !== 'master' && <CropStudio asset={cropTarget} platform={platform} onClose={() => setCropTarget(null)} onGenerate={(options) => generateAsset(cropTarget, options)}/>}
    {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>
}

interface ImageCardProps { asset: ImageAsset; index: number; platform: Platform; selected: boolean; onSelect: (checked: boolean) => void; onAdapt: () => void }
function ImageCard({ asset, index, platform, selected, onSelect, onAdapt }: ImageCardProps): ReactElement {
  const outputs = asset.derivatives.filter((item) => item.platform === platform)
  const latest = outputs.at(-1)
  return <div className="image-card">
    <div className="drag-handle"><GripVertical size={17}/></div>
    <div className="full-thumbnail">{asset.thumbnailDataUrl ? <img src={asset.thumbnailDataUrl} alt={asset.name}/> : <ImageIcon size={28}/>}<span>{String(index + 1).padStart(2, '0')}</span><input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`选择 ${asset.name}`}/></div>
    <div className="image-info"><div><strong title={asset.name}>{asset.name}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '尺寸未知'} · {asset.extension.slice(1).toUpperCase()} · {formatBytes(asset.size)}</small></div>
      <div className="image-actions">{platform === 'master' ? <button className="mini-button" onClick={() => void window.draftdock.revealPath(asset.path)}>查看原图</button> : <button className="mini-button accent" onClick={onAdapt}><WandSparkles size={14}/>适配并生成</button>}
        {latest && <button className="mini-button drag-output" draggable onDragStart={(event) => { event.preventDefault(); window.draftdock.startDrag(latest.outputPath) }} onClick={() => void window.draftdock.revealPath(latest.outputPath)} title="按住拖到平台上传区"><GripVertical size={13}/>拖出交付图</button>}</div>
      {latest ? <DerivedRow item={latest}/> : <span className="not-generated">尚未生成{platform === 'master' ? '' : '当前平台'}交付图</span>}
    </div>
  </div>
}

function DerivedRow({ item }: { item: DerivedAsset }): ReactElement {
  return <div className="derived-row"><span><i/>{item.presetId} · {item.mode === 'cover' ? '裁切填满' : '完整留边'} · {item.width}×{item.height}</span><button onClick={() => void window.draftdock.revealPath(item.outputPath)}>打开位置</button></div>
}
