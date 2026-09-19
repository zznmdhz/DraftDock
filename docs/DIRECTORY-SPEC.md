# 内容目录规范

## 根目录

用户可以选择任意本地文件夹作为内容根目录。DraftDock 只把根目录下的一级子文件夹识别为文章，不递归把更深层文件夹当作新文章。

## 文章文件夹

推荐结构：

```text
2026-09-19-topic-slug/
├─ article.md
├─ 01-cover.png
├─ 02-card.jpg
├─ 03-diagram.svg
└─ references/              # MVP 忽略
```

### Markdown

- 推荐文件名为 `article.md`，但名称不是强制要求。
- MVP 使用按文件名排序后的第一份 `.md` 或 `.markdown`。
- 多于一份时不猜测用途，界面给出提示。
- Markdown 第一行一级标题 `# 标题` 优先作为文章标题；没有时使用文件夹名称。

### 图片

文章文件夹根层级中的以下扩展名会被识别：

```text
.png .jpg .jpeg .webp .gif .svg .bmp .tif .tiff .avif
```

排序按照自然文件名顺序，因此建议使用 `01-`、`02-` 前缀控制发布顺序。

## DraftDock 元数据

应用会创建隐藏工作目录：

```text
.draftdock/
├─ state.json
├─ manifest.json
└─ outputs/
   ├─ wechat/
   └─ xiaohongshu/
```

### state.json

保存主稿、公众号和小红书三个工作版本。删除它不会影响源 Markdown，但会丢失平台编辑记录。

### manifest.json

每次生成交付图追加一条记录。记录指向源图片与输出文件，使同一原图可以生成多个平台、多个比例和多次构图结果。

### outputs

文件名包含原图名、预设和适配方式。如果同名输出已存在，DraftDock 自动增加序号，不覆盖旧输出。

## 版本管理建议

如果内容目录也使用 Git，建议提交 Markdown、原图和 `.draftdock/state.json`；是否提交 `.draftdock/outputs/` 取决于是否需要保留二进制交付历史。
