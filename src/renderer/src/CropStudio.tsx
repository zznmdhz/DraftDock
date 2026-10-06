import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Check, Image as ImageIcon, Maximize2, X } from 'lucide-react'
import type { AdaptMode, Composition, ImageAsset, Platform } from '../../shared/types'
import { compositionRect } from '../../shared/composition'
import { PROFILES } from '../../shared/platforms'

interface Preset { id: string; label: string; detail: string; width: number; height: number }

interface Props {
  asset: ImageAsset
  platform: Exclude<Platform, 'master'>
  onClose: () => void
  onGenerate: (input: { preset: Preset; mode: AdaptMode; composition: Composition; background: string }) => Promise<void>
}

export default function CropStudio({ asset, platform, onClose, onGenerate }: Props): ReactElement {
  const presets = PROFILES[platform].presets
  const [preset, setPreset] = useState(presets[0])
  const [mode, setMode] = useState<AdaptMode>('cover')
  const [background, setBackground] = useState('#f5f3ee')
  const [imageUrl, setImageUrl] = useState(asset.thumbnailDataUrl)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [natural, setNatural] = useState({ width: asset.width ?? 1, height: asset.height ?? 1 })
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = useState({ width: 300, height: 400 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    if (frame.current) observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  const [working, setWorking] = useState(false)
  const containZoom = Math.min(preset.width / natural.width, preset.height / natural.height) / Math.max(preset.width / natural.width, preset.height / natural.height)
  const composition = { zoom: mode === 'contain' ? containZoom : zoom, offsetX: crop.x, offsetY: crop.y }
  const rect = compositionRect(natural.width, natural.height, preset.width, preset.height, composition)

  useEffect(() => { let active = true; void window.draftdock.loadImage(asset.path).then(url => { if (active) { setImageUrl(url); setLoaded(true) } }).catch(error => { if (active) setLoadError(String(error)) }); return () => { active = false } }, [asset.path])
  useEffect(() => { setCrop({ x: 0, y: 0 }); setZoom(1) }, [preset.id, mode])

  const dimensions = useMemo(() => asset.width && asset.height ? `${asset.width} × ${asset.height}` : '尺寸未知', [asset])
  const generate = async (): Promise<void> => {
    setWorking(true)
    try {
      await onGenerate({
        preset, mode, background,
        composition
      })
      onClose()
    } catch (cause) { setLoadError(String(cause))
    } finally { setWorking(false) }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="crop-studio" role="dialog" aria-modal="true" aria-label="图片适配">
      <header className="crop-header">
        <div><span className="overline">IMAGE ADAPTATION</span><h2>图片适配</h2><p>{asset.name} · {dimensions}</p></div>
        <button className="icon-btn" disabled={working} onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </header>

      <div className="crop-main">
        <section className="original-pane">
          <div className="pane-title"><span><ImageIcon size={16}/> 原图全览</span><b>原图只读，不会被覆盖</b></div>
          <div className="original-stage"><img src={imageUrl} alt={`原图 ${asset.name}`} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/></div>
          <p>先在这里确认整张图的内容，再到右侧选择交付范围。</p>
        </section>

        <section className="result-pane">
          <div className="pane-title"><span><Maximize2 size={16}/> 交付结果</span><b>{preset.width} × {preset.height}px</b></div>
          <div ref={frame} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
          <div className="result-stage" style={{ width: Math.min(frameSize.width, frameSize.height * preset.width / preset.height), height: Math.min(frameSize.height, frameSize.width * preset.height / preset.width), flexShrink: 0, maxHeight: 'none', background, position: 'relative', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}
            onPointerDown={event => { if (mode === 'contain') return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, offsetX: crop.x, offsetY: crop.y } }}
            onPointerMove={event => { if (!drag.current) return; const bounds = event.currentTarget.getBoundingClientRect(); setCrop({ x: Math.max(-5, Math.min(5, drag.current.offsetX + (event.clientX - drag.current.x) / bounds.width)), y: Math.max(-5, Math.min(5, drag.current.offsetY + (event.clientY - drag.current.y) / bounds.height)) }) }}
            onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
            <img src={imageUrl} draggable={false} alt="交付预览" style={{ position: 'absolute', width: `${rect.width / preset.width * 100}%`, height: `${rect.height / preset.height * 100}%`, maxWidth: 'none', maxHeight: 'none', left: `${rect.left / preset.width * 100}%`, top: `${rect.top / preset.height * 100}%`, pointerEvents: 'none' }}/>
          </div>
          </div>
          <p>{loadError || (mode === 'cover' ? '可放大或缩小、拖动位置。缩小时空余区域使用背景色，导出与此预览一致。' : '完整图片会保留，空余区域使用所选背景色。')}</p>
        </section>

        <aside className="crop-controls">
          <div className="control-group"><label>用途预设</label><div className="preset-grid">{presets.map((item) =>
            <button key={item.id} className={preset.id === item.id ? 'selected' : ''} onClick={() => setPreset(item)}>
              <strong>{item.label}</strong><span>{item.detail}</span>{preset.id === item.id && <Check size={14}/>} </button>)}</div></div>
          <div className="control-group"><label>适配方式</label><div className="segmented">
            <button className={mode === 'cover' ? 'selected' : ''} onClick={() => setMode('cover')}>自由裁切</button>
            <button className={mode === 'contain' ? 'selected' : ''} onClick={() => setMode('contain')}>完整留边</button>
          </div></div>
          {mode === 'cover' && <div className="control-group"><label htmlFor="zoom">缩放 <span>{zoom.toFixed(2)}×</span></label><input id="zoom" type="range" min={Math.min(0.1, containZoom)} max="3" step="0.001" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}/><button onClick={() => { setZoom(containZoom); setCrop({ x: 0, y: 0 }) }}>完整显示</button> <button onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }) }}>铺满画布</button></div>}
          <div className="control-group"><label htmlFor="background">留边颜色</label><div className="color-field"><input id="background" type="color" value={background} onChange={(e) => setBackground(e.target.value)}/><code>{background.toUpperCase()}</code></div></div>
          <div className="output-note"><strong>新建派生文件</strong><p>输出到 <code>.draftdock/outputs/{platform}/</code>，并写入来源与裁切记录。原文件不会移动、改名或覆盖。</p></div>
        </aside>
      </div>

      <footer className="crop-footer"><span>支持 PNG、JPG、WebP、GIF、SVG、BMP、TIFF、AVIF</span><div><button className="button ghost" disabled={working} onClick={onClose}>取消</button><button className="button primary" disabled={working || !loaded} onClick={() => void generate()}>{working ? '正在生成…' : '生成新的交付图片'}</button></div></footer>
    </section>
  </div>
}
