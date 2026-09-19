import { useEffect, useMemo, useState, type ReactElement } from 'react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { Check, Image as ImageIcon, Maximize2, X } from 'lucide-react'
import type { AdaptMode, CropRect, ImageAsset, Platform } from '../../shared/types'

interface Preset { id: string; label: string; detail: string; width: number; height: number }
const PRESETS: Record<Exclude<Platform, 'master'>, Preset[]> = {
  wechat: [
    { id: 'wechat-cover', label: '2.35:1', detail: '公众号横封面', width: 900, height: 383 },
    { id: 'wechat-square', label: '1:1', detail: '公众号方形封面', width: 1080, height: 1080 },
    { id: 'wechat-body-43', label: '4:3', detail: '正文横图', width: 1200, height: 900 }
  ],
  xiaohongshu: [
    { id: 'xhs-portrait', label: '3:4', detail: '小红书竖图', width: 1080, height: 1440 },
    { id: 'xhs-story', label: '9:16', detail: '全屏竖图', width: 1080, height: 1920 },
    { id: 'xhs-square', label: '1:1', detail: '方形图', width: 1080, height: 1080 }
  ]
}

interface Props {
  asset: ImageAsset
  platform: Exclude<Platform, 'master'>
  onClose: () => void
  onGenerate: (input: { preset: Preset; mode: AdaptMode; crop?: CropRect; background: string }) => Promise<void>
}

export default function CropStudio({ asset, platform, onClose, onGenerate }: Props): ReactElement {
  const presets = PRESETS[platform]
  const [preset, setPreset] = useState(presets[0])
  const [mode, setMode] = useState<AdaptMode>('cover')
  const [background, setBackground] = useState('#f5f3ee')
  const [imageUrl, setImageUrl] = useState(asset.thumbnailDataUrl)
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [cropPixels, setCropPixels] = useState<Area | null>(null)
  const [working, setWorking] = useState(false)
  const aspect = preset.width / preset.height

  useEffect(() => { void window.draftdock.loadImage(asset.path).then(setImageUrl) }, [asset.path])
  useEffect(() => { setCrop({ x: 0, y: 0 }); setZoom(1); setCropPixels(null) }, [preset.id, mode])

  const dimensions = useMemo(() => asset.width && asset.height ? `${asset.width} × ${asset.height}` : '尺寸未知', [asset])
  const generate = async (): Promise<void> => {
    setWorking(true)
    try {
      await onGenerate({
        preset, mode, background,
        crop: mode === 'cover' && cropPixels ? { x: cropPixels.x, y: cropPixels.y, width: cropPixels.width, height: cropPixels.height } : undefined
      })
      onClose()
    } finally { setWorking(false) }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="crop-studio" role="dialog" aria-modal="true" aria-label="图片适配">
      <header className="crop-header">
        <div><span className="overline">IMAGE ADAPTATION</span><h2>图片适配</h2><p>{asset.name} · {dimensions}</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </header>

      <div className="crop-main">
        <section className="original-pane">
          <div className="pane-title"><span><ImageIcon size={16}/> 原图全览</span><b>原图只读，不会被覆盖</b></div>
          <div className="original-stage"><img src={imageUrl} alt={`原图 ${asset.name}`}/></div>
          <p>先在这里确认整张图的内容，再到右侧选择交付范围。</p>
        </section>

        <section className="result-pane">
          <div className="pane-title"><span><Maximize2 size={16}/> 交付结果</span><b>{preset.width} × {preset.height}px</b></div>
          <div className="result-stage" style={{ aspectRatio: `${preset.width}/${preset.height}`, background }}>
            {mode === 'cover'
              ? <Cropper image={imageUrl} crop={crop} zoom={zoom} aspect={aspect} objectFit="contain" restrictPosition={false} showGrid
                  onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_area, pixels) => setCropPixels(pixels)} />
              : <img className="contain-preview" src={imageUrl} alt="完整留边预览" />}
          </div>
          <p>{mode === 'cover' ? '拖动图片调整选区；框外仍可看到完整原图上下文。' : '完整图片会保留，空余区域使用所选背景色。'}</p>
        </section>

        <aside className="crop-controls">
          <div className="control-group"><label>用途预设</label><div className="preset-grid">{presets.map((item) =>
            <button key={item.id} className={preset.id === item.id ? 'selected' : ''} onClick={() => setPreset(item)}>
              <strong>{item.label}</strong><span>{item.detail}</span>{preset.id === item.id && <Check size={14}/>} </button>)}</div></div>
          <div className="control-group"><label>适配方式</label><div className="segmented">
            <button className={mode === 'cover' ? 'selected' : ''} onClick={() => setMode('cover')}>裁切填满</button>
            <button className={mode === 'contain' ? 'selected' : ''} onClick={() => setMode('contain')}>完整留边</button>
          </div></div>
          {mode === 'cover' ? <div className="control-group"><label htmlFor="zoom">缩放 <span>{zoom.toFixed(2)}×</span></label><input id="zoom" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}/></div>
            : <div className="control-group"><label htmlFor="background">留边颜色</label><div className="color-field"><input id="background" type="color" value={background} onChange={(e) => setBackground(e.target.value)}/><code>{background.toUpperCase()}</code></div></div>}
          <div className="output-note"><strong>新建派生文件</strong><p>输出到 <code>.draftdock/outputs/{platform}/</code>，并写入来源与裁切记录。原文件不会移动、改名或覆盖。</p></div>
        </aside>
      </div>

      <footer className="crop-footer"><span>支持 PNG、JPG、WebP、GIF、SVG、BMP、TIFF、AVIF</span><div><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={working} onClick={() => void generate()}>{working ? '正在生成…' : '生成新的交付图片'}</button></div></footer>
    </section>
  </div>
}
