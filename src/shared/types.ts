export type Platform = 'master' | 'wechat' | 'xiaohongshu' | 'x' | 'zhihu'
export type PublishingPlatform = Exclude<Platform, 'master'>
export type LibraryMode = 'auto' | 'package' | 'library'
export interface DeliveryImage { sourcePath: string; outputPath?: string }
export type AdaptMode = 'cover' | 'contain'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Composition { zoom: number; offsetX: number; offsetY: number }

export interface DerivedAsset {
  composition?: Composition
  id: string
  sourcePath: string
  outputPath: string
  platform: Exclude<Platform, 'master'>
  presetId: string
  width: number
  height: number
  mode: AdaptMode
  crop?: CropRect
  background?: string
  createdAt: string
}

export interface ImageAsset {
  id: string
  name: string
  path: string
  extension: string
  width: number | null
  height: number | null
  format: string | null
  size: number
  thumbnailDataUrl: string
  derivatives: DerivedAsset[]
}

export interface PlatformDraft {
  title: string
  markdown: string
  updatedAt: string
  images?: DeliveryImage[]
  account?: string
  status?: 'draft' | 'ready' | 'published'
  publishedUrl?: string
  notes?: string
  limits?: { text?: number; title?: number; images?: number }
}

export interface DraftHistory { id: string; savedAt: string; drafts: Partial<Record<Platform, PlatformDraft>>; selectedSources?: string[] }

export interface ArticleRecord {
  sourceFiles: { path: string; name: string }[]
  selectedSources: string[]
  sourceRevision: string
  id: string
  title: string
  folderName: string
  folderPath: string
  markdownPath: string | null
  markdown: string
  modifiedAt: string
  images: ImageAsset[]
  drafts: Partial<Record<Platform, PlatformDraft>>
  warnings: string[]
  history: DraftHistory[]
  sourceChanged: boolean
}

export interface LibrarySnapshot {
  rootPath: string | null
  articles: ArticleRecord[]
  scannedAt: string
  mode?: LibraryMode
  warnings?: string[]
}

export interface GenerateAssetInput {
  composition?: Composition
  articleFolder: string
  sourcePath: string
  platform: Exclude<Platform, 'master'>
  presetId: string
  width: number
  height: number
  mode: AdaptMode
  crop?: CropRect
  background?: string
}

export interface SaveDraftInput {
  articleFolder: string
  platform: Platform
  title: string
  markdown: string
  details?: Omit<PlatformDraft, 'title' | 'markdown' | 'updatedAt'>
}

export interface BundleInput { articleFolder: string; platform: PublishingPlatform; draft: PlatformDraft }
export interface BundleResult { outputFolder: string; imageCount: number; warnings: string[] }

export interface ExportDocxInput {
  articleFolder: string
  title: string
  markdown: string
  imagePaths: string[]
  suggestedName: string
}

export interface ClipboardInput {
  markdown: string
  mode: 'markdown' | 'rich' | 'plain'
}

export interface DraftDockApi {
  requestReload(): void
  exportBundle(input: BundleInput): Promise<BundleResult>
  restoreHistory(articleFolder: string, id: string): Promise<LibrarySnapshot>
  selectSources(articleFolder: string, paths: string[]): Promise<LibrarySnapshot>
  openLogs(): Promise<string>
  report(input: { level: 'info' | 'error'; event: string; message: string }): void
  getLibrary(): Promise<LibrarySnapshot>
  chooseRoot(mode?: LibraryMode): Promise<LibrarySnapshot>
  refreshLibrary(): Promise<LibrarySnapshot>
  loadImage(path: string): Promise<string>
  generateAsset(input: GenerateAssetInput): Promise<DerivedAsset>
  saveDraft(input: SaveDraftInput): Promise<void>
  writeClipboard(input: ClipboardInput): Promise<void>
  exportDocx(input: ExportDocxInput): Promise<string | null>
  openPath(path: string): Promise<void>
  revealPath(path: string): Promise<void>
  startDrag(path: string): void
  onLibraryChanged(callback: (snapshot: LibrarySnapshot) => void): () => void
  onBeforeClose(callback: () => Promise<void>): () => void
}
