# 技术架构（0.2）

## 模块与边界

- Electron 主进程：目录监听、具名 IPC、日志、系统对话框/剪贴板、DOCX、原生拖出、关闭与重新加载保存确认。
- Preload：sandbox + contextBridge，暴露受控业务接口，不暴露通用文件系统。
- React Renderer：目录/平台编辑会话、DraftBuffer、CropStudio、预检和发布记录。无 Node 权限。
- `shared/platforms.ts`：四平台 profile、发布入口、预设、官方来源、Markdown 交付转换、twitter-text 加权计数与检查。
- `main/library.ts`：三种目录模式、多来源读取、工作稿状态串行原子更新、50份来源切换/恢复历史、源指纹提示、损坏记录保护。
- `main/outputs.ts`：Sharp 图片生成、真实路径检查、输出和 manifest 串行提交。
- `main/delivery.ts`：所选图片与派生关系验证、有序 PNG 和文本文件交付、失败清理新建包。

## 数据流

```text
MD/TXT + 原图（只读）
  → ArticleRecord
  → 主稿 / 每平台独立 PlatformDraft
  → 图片选择、顺序、outputPath + 发布前检查
  → deliveries/<platform>/<时间-UUID>/
  → 平台端人工确认、上传和发布
  → 本地状态、账号标记、链接与备注
```

草稿保留 Markdown，纯文本转换只在交付边界执行一次，避免代码中的 `<T>` 被二次解析删除。平台规则未知时不硬编码数字；自定义工作预算与官方硬限制分开。

## 保存可靠性

输入立即进入按文章/平台键控的内存 cache 和 DraftBuffer，600ms 防抖后落盘。切换、扫描、更换目录和 native 关闭/快捷键 reload 前等待缓冲保存；生成图片时阻止切换并等待在途生成。失败保留待写数据、显示重试，不允许正常关闭时吞掉失败。强制结束进程/断电仍可能丢失尚未落盘输入，不能承诺故障下零损失。

工作稿按文章串行读取/修改/临时写入/rename，避免并发覆盖；每次来源重建或恢复前归档。扫描局部坏图/坏目录只产生警告，损坏状态不覆盖。

## 图片几何

原图全览与交付结果分开。`shared/composition.ts` 统一画布缩放、归一化位移；renderer 预览和 Sharp 输出使用相同算法。图片加载先规范为自动旋转 PNG，支持浏览器不能直接显示的 TIFF 等。缩小产生留边；contain 完整保留并禁止拖动。

## 安全与测试

contextIsolation、sandbox、webSecurity 启用。预览 DOMPurify，主进程和导出 sanitize-html 清理。图片输出、状态、交付包验证真实路径与文章边界，拒绝跨目录 junction/symlink。外部 HTTP(S) 链接交给系统浏览器。

Vitest 覆盖图包扫描/目录模式、来源选择/恢复、状态损坏/链接边界、保存并发/失败恢复、图片几何/EXIF、平台加权限制、交付顺序/失败清理。打包 CDP 检查使用本机临时 profile 与素材副本，验证实际 UI、preload、IPC、日志、快速编辑切换/关闭持久化。

大型库增量索引、可取消批任务、真正账号实体、官方授权草稿同步仍为后续设计，不属于当前实现。
