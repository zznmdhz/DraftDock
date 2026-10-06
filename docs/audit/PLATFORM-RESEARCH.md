# 多平台交付规则研究与配置建议

核验日期：2026-10-06（Asia/Hong_Kong）。适用范围：DraftDock 的本地素材整理、配文适配、图片交付和发布前检查。本文只采用平台帮助中心、官方开发者文档和官方产品页面；平台域名上的普通用户文章不视为官方规则。

## 1. 规则应该按入口建模

不能用一个“微信最大图数”或“小红书最大字数”覆盖所有内容类型。建议把规则的作用范围设为 `平台 → 账号能力 → 发布入口 → 内容类型 → 字段/媒体角色`。

| 平台 | 本轮默认交付入口 | 需要区别的其他入口或能力 |
| --- | --- | --- |
| X | 普通账号的普通图文帖；用户手动发布 | Premium 长帖、Articles、线程中的每条帖、媒体 API、广告素材 |
| 小红书 | 创作服务平台/客户端的图文笔记；用户手动发布 | 视频笔记、长文入口、分享 SDK、商业内容、账号灰度能力 |
| 微信公众号 | 公众平台后台的图文文章；用户手动发布 | `news` 草稿 API、`newspic` 图片消息 API、正文图片上传、永久图片素材、`thumb` 缩略图素材、群发/发布权限 |
| 知乎 | 普通专栏文章；用户手动发布 | 问题回答、想法、付费专栏、机构号和商业合作内容 |

本轮“导出成功”只代表交付文件已准备，不代表平台草稿已创建、发布成功或账户具有发布权限。账号运营进度需要用户确认并记录真实链接。

## 2. 证据等级与交互

- **硬限制（verified）**：官方来源明确写出数值且范围吻合。超限显示错误；仍允许保存、复制和Word导出以便修改，但阻止生成宣称可用的发布交付包。
- **推荐规格（recommendation）**：产品编辑建议或显示效果建议。显示提醒，可覆盖；不得标为“平台禁止”。
- **未核实（unknown）**：公开来源未提供、依赖登录/账号权限、抓取失败或官方条文存在歧义。明确显示“待核验”，不设伪造硬限制。

每项规则必须带来源、核验日期、范围、计数方式和严重级别。计数与截断要分离：检查不能静默删正文、删图片、替换原图。一个不确定字段不应阻止整包交付。

## 3. X

以下均核验于 2026-10-06。

| 规则 | 等级 | 范围与实现建议 | 官方来源 |
| --- | --- | --- | --- |
| 普通帖上限 280 加权字符 | 硬限制 | 普通帖；中文等 CJK 通常权重 2，复杂 emoji 序列整体权重 2，不能用 JS `length` 代替 | [Counting Characters](https://docs.x.com/fundamentals/counting-characters) |
| 有效 URL 固定占 23 加权字符 | 硬限制 | 使用官方推荐的 `twitter-text` 解析、NFC 规范化；不要用简单正则把任意字符串当 URL | [Counting Characters](https://docs.x.com/fundamentals/counting-characters) |
| 一条普通帖最多 4 张静态图片 | 硬限制 | 必须计算本条帖实际选中的媒体，不是文章原图总数；线程每条独立检查 | [How to Post](https://help.x.com/en/using-x/how-to-post) |
| 静态照片最大 5 MB；支持 GIF/JPEG/PNG | 硬限制 | 官方帮助页面的照片上传入口；SVG/TIFF/BMP 应先生成 PNG/JPEG 交付图，保留原文件 | [图片与 GIF 帮助](https://help.x.com/en/using-x/posting-gifs-and-pictures) |
| API `tweet_image` 典型上限 5 MB | 硬限制/按入口复核 | API 媒体类别；不可把分块上传单块上限当成整张图片上限 | [媒体上传指南](https://docs.x.com/x-api/media/quickstart/media-upload-chunked) |
| 单图宽高比在 2:1 至 3:4 区间时，官方说明可完整显示 | 显示建议 | 单图展示，不是上传宽高比硬限制，也不是多图网格裁切保证 | [图片与 GIF 帮助](https://help.x.com/en/using-x/posting-gifs-and-pictures) |
| Premium 长帖可达 25,000 字符 | 条件性硬限制 | 长帖需订阅能力，不能默认替普通账号解除 280；本轮保留普通帖配置。长帖计数及客户端能力需专门测试 | [帖子类型](https://help.x.com/en/using-x/types-of-posts) |

产品建议：默认交付 PNG/JPEG，提供 1600×900 横图、1200×1200 方图、1200×1600 竖图，都是 DraftDock 预设而非官方像素要求。首条用独立短配文；长内容可由用户编排成线程，保留每条配图绑定和顺序。超过 4 图时提示用户选择或拆线程，不能自动丢弃第 5 张之后的素材。

## 4. 微信公众号

以下均核验于 2026-10-06。网页读取工具不能解析微信开发文档；本轮通过直接 HTTPS 读取官方页面 HTML 核验参数和注意事项，并未采用第三方转述数值。

| 规则 | 等级 | 适用入口/角色 | 官方来源 |
| --- | --- | --- | --- |
| 草稿 `title` ≤32 字、`author` ≤16 字、`digest` ≤120 字 | 硬限制（API 范围） | 新建草稿；摘要只在单图文中适用，未填写时按官方说明取正文前 54 字。不能推断后台网页标题也限制 32 | [新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) |
| `news` 内容支持 HTML，过滤 JS 与外部图片 URL | 硬限制（API 范围） | 正文图片需要上传接口返回的 URL；本地图片路径或 data URL 不能直接作为 API 图文正文图片 | [新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) |
| `news` 封面要求永久素材 `thumb_media_id` | 硬限制（API 范围） | 封面素材引用，不等于已获得发布权限 | [新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) |
| `newspic` 图片列表最多 20 张，第一张是封面 | 硬限制（API 范围） | 图片消息；不可应用到 `news` 的正文配图总数 | [新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) |
| `news` 封面裁剪参数支持 2.35:1、1:1；`newspic` 还支持 16:9 | 硬限制（API 参数范围） | 指 API `cover_info` 的裁剪比例选项；不是所有正文图片都必须按此裁切 | [新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add) |
| 永久图片素材 10M，BMP/PNG/JPEG/JPG/GIF | 硬限制（API 范围） | `material/add_material` 的 `image`；与正文 `uploadimg` 分开 | [新增永久素材](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_addmaterial) |
| 永久素材 `thumb` 为 JPG，64KB | 硬限制（API 范围） | 明确指定 `type=thumb` 的缩略图；不能要求所有手动上传封面都 ≤64KB | [新增永久素材](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_addmaterial) |
| 正文图片 JPG/PNG，必须低于 1MB | 硬限制（API 范围） | `media/uploadimg` 获取正文图片 URL；不是后台网页通用图片限制 | [上传图文消息图片](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage) |

注意：新增草稿官方 `content` 说明同时出现“大小不可超过 2kb”“少于 2 万字符”“小于 1M”。该条缺少一致的字段范围解释，本轮把正文完整容量判定标为**待核实**，不把其中某一个数值强行升级为所有公众号内容的硬限制。未来做 API 连接器时需针对真实账号做边界验证并保存错误码证据。[官方字段说明](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add)（核验 2026-10-06）

产品建议：公众号网页交付默认生成 900×383 横封面、1080×1080 方形分享图；比例选项有 API 官方依据，像素值是产品预设。正文图优先保留原比例。正文、标题、作者、摘要、原文链接分别编辑和复制。富文本粘贴效果必须通过实际后台预览检查；本地预览不可承诺与微信阅读页完全一致。

后台网页标题、摘要、图片大小和正文图数的现行精确限制，本轮未从可公开访问的官方网页编辑器规则获得完整证据；在网页交付配置里应设为 `unknown` 或产品提醒。不要把草稿 API 32 字规则复制成网页标题硬限制。

## 5. 小红书

| 规则/问题 | 等级 | 本轮处理 | 官方来源与核验日期 |
| --- | --- | --- | --- |
| 创作服务平台发布页需要登录 | 已核实入口事实 | 本轮公开抓取只能得到登录页，未核实目标账号当前图文标题/正文/图数/大小边界 | [官方发布入口](https://creator.xiaohongshu.com/publish)，2026-10-06 |
| JS 分享 SDK 不再支持自动填充标题、文案、话题 | 已核实 SDK 能力边界 | SDK 唤起与发布笔记是不同动作；不能承诺通过官方 SDK 自动完成正文或发布 | [JS SDK 文档](https://agora.xiaohongshu.com/doc/js)，2026-10-06（文档页面标示更新 2023-12-10） |
| JS SDK 的图片/视频等地址必须是服务器地址；部分字段不支持本地文件 | 已核实 SDK 入口限制 | 本地目录交付不直接满足该 SDK；本轮采用手动复制文本、上传图片 | [JS SDK 文档](https://agora.xiaohongshu.com/doc/js)，2026-10-06 |
| 图文标题 20、正文 1000、图片 9/18 等流传上限 | 未核实 | 不作为硬规则；账号、客户端和内容入口可能不同，需要用户目标账号实测 | [官方发布入口](https://creator.xiaohongshu.com/publish)，2026-10-06 |
| 上传图的硬比例、像素、大小和数量 | 未核实 | 允许自定义并提示去目标发布入口确认；不把 3:4 误写为唯一允许比例 | [官方发布入口](https://creator.xiaohongshu.com/publish)，2026-10-06 |

产品建议：提供标题独立字段、纯文本正文、标签列表和有顺序的图片队列。默认 1080×1440（3:4）/1080×1080 方图，缩小时用画布留边保全内容。标题 20 字、正文 1000 字、9 图可作为可调整的**编辑提醒**，不得叫“官方限制”，不得自动截断。第一张图片角色是用户选择的首图，不能把文件名第一项直接锁为封面。

## 6. 知乎

| 规则/问题 | 等级 | 本轮处理 | 官方来源与核验日期 |
| --- | --- | --- | --- |
| 知乎文章、回答是不同编辑与投放对象 | 已核实产品差异 | 回答需要问题链接；专栏文章需要自己的标题和封面，不可把平台名当唯一内容类型 | [知乎官方付费专栏指南](https://www.zhihu.com/parker/campaign/1847015770967654400)，2026-10-06 |
| 普通文章/回答的标题、正文、图片数量/大小硬上限 | 未核实 | 本轮不设置伪造数字。平台域名上的用户经验文不是官方证据 | [专栏入口](https://zhuanlan.zhihu.com/)，2026-10-06 |
| 付费专栏封面 1:1；专栏内文章/回答超过 100 字 | 条件性规则 | 仅适用于该付费专栏指南描述的产品，不套用为普通文章规范 | [知乎官方付费专栏指南](https://www.zhihu.com/parker/campaign/1847015770967654400)，2026-10-06 |
| 普通文章封面必须 16:9、正文必须 800 字等说法 | 未核实 | 16:9 可以是产品预设；长度只做编辑建议 | [专栏入口](https://zhuanlan.zhihu.com/)，2026-10-06 |

产品建议：文章默认提供 1600×900 封面和保持原比例的正文图片；保留标题层级、引用、链接和代码。回答版本增加问题链接与问题标题，正文开头先回答该问题。复制富文本/导出 Markdown 后，用户在目标编辑器校对图片和格式。未核验公开发布 API，不能承诺自动发布。

## 7. 本轮建议默认配置

这些默认值把“已经核验的硬规则”和“产品提供的制作预设”分离。未知值用 `null`，不能用 0 表达未知。

| 配置 ID | 正文/标题提醒 | 图数 | 图片预设 | 本轮交付能力 |
| --- | --- | --- | --- | --- |
| `x.standard.manual` | 正文 280 加权字符：硬限制；没有独立标题 | 最多4静态图：硬限制 | 1600×900、1200×1200、1200×1600：产品预设 | 复制纯文本；导出有序图包 |
| `xiaohongshu.note.manual` | 标题20/正文1000：产品提醒、可覆盖 | 9图：产品提醒、可覆盖；官方硬限未知 | 1080×1440、1080×1080：产品预设 | 分别复制标题/正文/标签；有序图包 |
| `wechat.article.manual` | 网页硬限未知；标题/摘要独立编辑 | 正文图数未知 | 900×383、1080×1080：产品预设；正文保原比例 | 复制富文本；标题/摘要；HTML/Markdown/图片交付 |
| `zhihu.article.manual` | 网页硬限未知；标题/正文独立编辑 | 未知 | 1600×900封面：产品预设；正文保原比例 | 富文本/Markdown；封面与正文图分开 |

API 规则应保留在另一个 profile 中供未来连接器启用。当前手动交付不能强制执行不匹配的 API 限制。规则检查面板始终展示规则等级与入口。

## 8. 数据结构建议

```ts
type EvidenceStatus = 'verified' | 'recommendation' | 'unknown'
type Counting = 'twitter-text' | 'unicode-codepoints' | 'graphemes' | 'utf8-bytes'

interface PlatformRule<T> {
  value: T | null
  status: EvidenceStatus
  severity: 'error' | 'warning' | 'info'
  sourceUrl?: string
  verifiedAt: string
  scope: string
  unit?: Counting | 'bytes' | 'images' | 'pixels' | 'ratio'
  notes?: string
}

interface ChannelProfile {
  id: string
  platform: 'x' | 'xiaohongshu' | 'wechat' | 'zhihu'
  entry: 'manual-web' | 'manual-app' | 'api' | 'share-sdk'
  contentType: 'post' | 'thread' | 'note' | 'article' | 'answer' | 'newspic'
  capability: 'standard' | 'premium' | 'account-specific'
  fields: Record<string, PlatformRule<number>>
  media: {
    maxImages: PlatformRule<number>
    maxFileBytes: PlatformRule<number>
    acceptedMime: PlatformRule<string[]>
    roles: Array<'cover' | 'share-cover' | 'inline' | 'gallery'>
    presets: Array<{ id: string; width: number; height: number; status: 'recommendation' }>
  }
  delivery: Array<'text' | 'html' | 'markdown' | 'ordered-images'>
}
```

账号数据建议单独保存 `accountId/name/platform/profileId/overrides`，不在平台配置里写账号密钥。每个内容包按 `packageId + platform + accountId + contentType` 保存标题、正文、摘要、标签、图片选择/顺序/角色、状态和发布链接。导出清单保存使用的 `profileId`、规则版本、检查结果与源文件指纹，便于之后规则变化时判断哪个包需要重新准备。

## 9. 后续核验与验收

1. 使用目标账号在官方编辑器实测并人工记录边界：正常值、超限值、截图、入口、账号能力、日期；不把一次账号实测推广为全平台官方规则。
2. 规则变更更新证据记录和配置版本，旧交付包保留旧规则快照。
3. X 测试中文、复杂 emoji、短/长 URL、超过4图；计数需和官方 `twitter-text` 一致。
4. 同一公众号图分别分配“正文、永久素材、thumb”角色，确保各自限制不会串用；网页手动交付可正常保存。
5. 小红书/知乎未核验字段明确显示“待核验”；产品建议超出后仍可导出，不能静默裁掉或删除内容。
6. 预览注明是本地排版预览；交付后在平台后台检查首图、图片顺序、外链和富文本。用户确认真实发布后才标记“已发布”。
