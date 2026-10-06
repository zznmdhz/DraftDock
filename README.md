# 稿间 DraftDock

Windows 本地优先的多平台内容发布准备台：从现有 Markdown/TXT 和图片素材包，整理出微信公众号、小红书、X、知乎的独立工作稿与交付材料。原始素材不覆盖，发布由人确认。

当前版本：**0.2.0**。本轮全面检查、问题优先级与验收记录见 [优化修改文档](docs/OPTIMIZATION-PLAN.md)。

[下载 Windows 安装版与便携版](https://github.com/zznmdhz/DraftDock/releases/latest)

## 解决什么问题

AI 生成素材后，运营者仍要找正文、挑图、裁图、排序、适配多个平台、检查限制并记录发到了哪个账号。DraftDock 把“生成之后、发布之前”的重复操作统一为本地工作流。

## 0.2 已实现

- 明确选择单篇图包、多篇文章库或自动识别；递归读取 MD/Markdown/UTF-8 TXT 和多格式图片，HTML 不当作正文。
- 一份或多份正文来源按勾选顺序合并；从来源重建时归档旧稿，支持恢复。外部来源改变会提醒，现有编辑稿不自动覆盖。
- 主稿和公众号、小红书、X、知乎四份独立工作稿。编辑保留 Markdown，交付时分别转为富文本或纯文本。
- 图片完整预览、自由缩小/放大/拖动、完整留边；每次生成独立 PNG 与追溯记录。
- 按平台保存图片勾选、发布顺序及派生版本；默认不勾选名称含“预览/总览/contact sheet”的图片，可手动选择。
- 发布前检查：X 标准单条按 twitter-text 加权计数、最多四张静态图片；未核实的其他平台上限明确标为未知。账号自定义预算仅作提醒。
- 一键生成带标题、纯文本、Markdown、HTML、编号 PNG 图集、检查单和 manifest 的独立发布包；失败不留下半成品。
- 复制标题/正文、Word 导出、原生图片拖出；按当前选图顺序交付，不再默默跳图。
- 本地保存目标账号标记、编辑/待人工发布/已人工发布状态、链接和备注；支持按当前平台状态筛选。
- 可见保存状态、失败重试、切换/关闭/快捷键重新加载前保存保护；损坏状态文件不自动覆盖。
- 本机诊断日志、错误提示、路径边界校验与自动化回归测试。

## 快速使用

1. 安装或运行便携版，选“单篇图包”打开具体文章，或“多篇文章库”打开存放多篇文章的上级目录。
2. 确认正文来源；需要更换或合并来源时，在“正文来源与历史恢复”中勾选并重建。
3. 切换目标平台，编辑标题与正文。平台稿独立保存，不会回写原始文档。
4. 勾选配图，通过上下箭头排序，按需适配。生成后新版本会选为当前平台交付图，也可改回原图/旧版本。
5. 检查文字、图片与规则提示，生成发布包或复制正文。到平台后台人工上传、排版并确认限制。
6. 回来记录目标账号、状态和发布链接。导出不会自动标记“已发布”。

## 内容目录

```text
内容根目录/
├─ 一篇文章/
│  ├─ 01-标题正文.md
│  ├─ 02-补充提示词.txt
│  ├─ 发布图片/              # PNG/JPG/SVG等
│  └─ 源文件/index.html      # 可保留，但不是正文
└─ 另一篇文章/
   └─ article.md
```

首次保存后，每篇文章内创建 `.draftdock/`：`state.json` 保存工作稿/历史，`manifest.json` 保存派生图追溯，`outputs/<platform>/` 保存派生图，`deliveries/<platform>/<时间-UUID>/` 保存每次交付包。此目录不重复参与素材扫描。详见 [目录规范](docs/DIRECTORY-SPEC.md)。

## 平台边界

| 平台 | 当前发布入口 | 输出 |
|---|---|---|
| 微信公众号 | 后台图文文章 | 独立标题、富文本、封面/正文图工作预设 |
| 小红书 | 图文笔记 | 独立标题、纯文本、有序图集 |
| X | 标准单条 Post | 开头一句计入正文、加权字符检查、最多四图 |
| 知乎 | 专栏文章，非回答 | 独立标题、富文本、有序配图 |

预设像素和比例是工作建议，不是平台强制标准。公众号 API 限制不套用于手工后台；未公开核实的上限不填假值。规则来源、适用入口与核验日期见 [平台规则研究](docs/audit/PLATFORM-RESEARCH.md)。

本版不自动登录/代发、不接管 Cookie、不提供已认证的多账号实体、不自动拆 X 串文、不自动把图片插到准确正文位置。多账号模板、批量处理、知乎回答、日历与反馈指标列入 [路线图](docs/ROADMAP.md)。GIF 仅生成首帧静态图，SVG/TIFF 等转为 PNG；原素材保持不变。DOCX支持基本标题、段落、列表与附后图片，不完整复刻表格/代码样式；结构化预览以HTML包为准。移动素材库后的绝对路径需重新选来源和图片。

## Windows 开发与验证

需要 Node.js 22+、pnpm。

```bash
git clone https://github.com/zznmdhz/DraftDock.git
cd DraftDock
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm dist:win
```

安装版与便携版生成到 `release/`。如 Electron 下载受网络影响，可使用已安装的运行时：

```bash
pnpm exec electron-builder --win nsis portable --publish never --config.electronDist=node_modules/electron/dist
node scripts/smoke-packaged.mjs
node scripts/smoke-workflow.mjs
```

检查脚本使用独立临时配置/素材副本；可传入 exe 和真实图包路径，不会修改原图包。

## 数据与诊断

文章、图片、工作稿、发布记录和日志均在本机保存，无服务器依赖。Renderer 无 Node 权限；文件写入经过受控 IPC，生成与状态存储验证真实路径，拒绝跨文章目录写入。Markdown 预览、剪贴板 HTML 和交付 HTML 做清理。

顶栏齿轮、启动页“打开诊断日志”或 Alt → 帮助菜单可打开日志。默认 `%APPDATA%/draftdock/logs/`，以实际打开位置为准。单文件 5 MB 后轮转，保留五个历史文件。

日志记录启动版本、页面/预加载/React 异常、扫描警告、操作耗时与失败。不将正文、剪贴板或图片数据作为参数记录，也不自动上传。错误堆栈可能含本地路径，分享前请检查。损坏 `state.json` 会报错并保留原文件；先备份再人工处理，不要直接删除工作记录。

## 文档与开源

- [全面优化修改文档与验证记录](docs/OPTIMIZATION-PLAN.md)
- [产品说明](docs/PRD.md)、[技术架构](docs/ARCHITECTURE.md)、[路线图](docs/ROADMAP.md)
- [产品审计](docs/audit/PRODUCT-AUDIT.md)、[用户审计](docs/audit/USER-AUDIT.md)、[平台研究](docs/audit/PLATFORM-RESEARCH.md)
- [贡献指南](CONTRIBUTING.md)、[安全说明](SECURITY.md)

使用 [MIT](LICENSE) 协议，持续公开维护。
