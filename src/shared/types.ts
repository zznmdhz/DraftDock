export type Platform = 'master' | 'wechat' | 'xiaohongshu'
export type AdaptMode = 'cover' | 'contain'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DerivedAsset {
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
}

export interface ArticleRecord {
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
}

export interface LibrarySnapshot {
  rootPath: string | null
  articles: ArticleRecord[]
  scannedAt: string
}

export interface GenerateAssetInput {
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
}

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
  openLogs(): Promise<string>
  report(input: { level: 'info' | 'error'; event: string; message: string }): void
  getLibrary(): Promise<LibrarySnapshot>
  chooseRoot(): Promise<LibrarySnapshot>
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
}
