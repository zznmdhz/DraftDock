# 内容目录规范

## 根目录

打开时显式选择模式：“单篇图包”将整个选定目录作为一篇文章，递归收集素材；“多篇文章库”从子目录寻找文章，忽略根目录通用 README；“自动识别”遇到直接含 MD/TXT 或图片的目录作为文章，否则继续向下寻找。隐藏目录、符号链接和 node_modules 不参与扫描。自动模式边界不符合预期时改用明确模式。

## 文章文件夹

推荐结构：

```text
2026-09-19-topic-slug/
├─ article.md
├─ 01-cover.png
├─ 02-card.jpg
├─ 03-diagram.svg
└─ 发布图片/                # 子目录图片也会被读取
```

### Markdown

- 推荐文件名为 `article.md`，但名称不是强制要求。
- 支持 `.md`、`.markdown` 和 UTF-8 `.txt`，首次默认使用排序后的第一份。
- “正文与交付”区域可勾选一份或多份文件，按勾选顺序合并；应用选择后重新生成平台稿并归档旧稿。
- 单份包含“推荐标题 / 正文 / 话题标签”章节的文档会提取发布内容；主稿仍保留全文，多份合并也保留全文。
- “推荐标题”章节优先，否则使用一级标题或文件夹名称。

### 图片

文章文件夹及其子目录中的以下扩展名会被识别，`.draftdock` 中的交付图不会重复导入：

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
├─ outputs/<wechat|xiaohongshu|x|zhihu>/
└─ deliveries/<platform>/<时间-UUID>/
   ├─ title.txt / body.txt
   ├─ article.md / article.html
   ├─ delivery-checklist.md / manifest.json
   └─ images/01-原图名.png ...
```

### state.json

保存正文来源 selectedSources、指纹、主稿和四个平台稿 drafts，以及切换/恢复前最多50份 history。平台稿包含有序 images（sourcePath/可选outputPath）、account 标记、status、publishedUrl、notes、自定义 limits。删除它不会影响源文件，但会丢失编辑和运营记录。损坏记录会报错并保留原字节；先备份再人工修复。路径含绝对本地素材路径，移动整个素材库后需重新选择来源/图片，跨机器无缝迁移暂未实现。

### manifest.json

每次生成交付图追加一条记录。记录指向源图片与输出文件，使同一原图可以生成多个平台、多个比例和多次构图结果。

### outputs

文件名包含原图名、预设和适配方式。如果同名输出已存在，DraftDock 自动增加序号，不覆盖旧输出。

## 版本管理建议

如果内容目录也使用 Git，建议提交 Markdown、原图和 `.draftdock/state.json`；是否提交 `.draftdock/outputs/` 取决于是否需要保留二进制交付历史。
