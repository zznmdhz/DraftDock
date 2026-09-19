# 技术架构

## 技术栈

- Electron：Windows 桌面外壳、系统对话框、剪贴板、原生文件拖出。
- React + TypeScript + Vite：三栏工作台和图片适配交互。
- Sharp：元数据读取、缩略图、裁切、留边、SVG 栅格化和 PNG 输出。
- react-easy-crop：交互式裁切选区。
- marked + sanitize-html / DOMPurify：Markdown 转换和不可信 HTML 清理。
- docx：生成真正的 Office Open XML 文档。
- electron-builder：Windows NSIS 安装包和便携版。

## 进程边界

```text
Renderer（无 Node 权限）
    │ 受控 IPC
Preload（contextBridge）
    │
Main
├─ 目录扫描与监听
├─ 图片读取和派生生成
├─ 平台稿件保存
├─ 系统剪贴板
├─ DOCX 导出
└─ Windows 原生文件拖出
```

## 安全模型

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Preload 只暴露具名业务操作，不暴露通用文件系统。
- Main 对所有来自 Renderer 的文件路径执行“必须位于当前内容根目录内”的校验。
- 外部链接交给系统浏览器，禁止在 Electron 窗口内任意打开。

## 非破坏性图片链路

```text
原图（只读）
→ 读取像素尺寸与预览
→ Renderer 计算 cropPixels 或 contain 参数
→ Main 校验路径与参数
→ Sharp 生成新的 PNG
→ 写入 .draftdock/outputs/<platform>/
→ manifest 追加追溯记录
→ Renderer 获得真实 outputPath
→ Electron startDrag 拖出文件
```

## 后续扩展点

- 可配置平台模板与规则文件。
- 插图锚点和正文图片位置提示。
- 图片批量使用同一预设。
- Windows 文件关联与右键“在稿间打开”。
- 可选的官方草稿接口；必须与本地准备链路解耦。
