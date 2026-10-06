import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, cp, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'

// Usage: node scripts/smoke-workflow.mjs [packaged-exe] [optional-source-package]
// For quick built-main verification, DRAFTDOCK_SMOKE_APP may point to the Electron app directory.
// All mutations target an isolated temporary copy; user source files are never edited.
const exe = path.resolve(process.argv[2] ?? 'release/win-unpacked/稿间 DraftDock.exe')
const profile = await realpath(await mkdtemp(path.join(tmpdir(), 'draftdock-workflow-')))
const content = path.join(profile, 'content')
const firstFolder = path.join(content, 'article-under-test')
const secondFolder = path.join(content, 'second-article')
await mkdir(firstFolder, { recursive: true })
if (process.argv[3]) await cp(path.resolve(process.argv[3]), firstFolder, { recursive: true, filter: file => !['.draftdock', '.git', 'node_modules'].includes(path.basename(file)) })
await mkdir(secondFolder, { recursive: true })
await writeFile(path.join(content, 'README.md'), '# Library description\nThis root document must not combine the two articles.\n')
const a = path.join(firstFolder, 'smoke-source-a.md'), b = path.join(firstFolder, 'smoke-source-b.txt')
await writeFile(a, '# Workflow fixture\n\nFirst source for local workflow verification.\n')
await writeFile(b, 'Second source for source selection and history verification.\n')
await writeFile(path.join(secondFolder, 'article.md'), '# Another article\n\nAn independent content package.\n')
const firstImage = path.join(firstFolder, 'smoke-image-a.png'), secondImage = path.join(firstFolder, 'smoke-image-b.png')
await sharp({ create: { width: 300, height: 100, channels: 3, background: '#ef5a3c' } }).png().toFile(firstImage)
await sharp({ create: { width: 100, height: 300, channels: 3, background: '#18385a' } }).png().toFile(secondImage)
await sharp({ create: { width: 80, height: 80, channels: 3, background: '#3aaf91' } }).png().toFile(path.join(secondFolder, 'cover.png'))
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ contentRoot: content, mode: 'library' }))
const env = { ...process.env, DRAFTDOCK_CONTENT_ROOT: content }
delete env.ELECTRON_RUN_AS_NODE
const port = 20000 + Math.floor(Math.random() * 1000)
let childError
const appArgs = process.env.DRAFTDOCK_SMOKE_APP ? [path.resolve(process.env.DRAFTDOCK_SMOKE_APP)] : []
const child = spawn(exe, [...appArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true })
child.on('error', error => { childError = error })
let socket, id = 0
const pending = new Map()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = () => !childError && child.exitCode === null && child.signalCode === null
const waitFor = async (label, check, timeout = 30000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    if (childError) throw childError
    await delay(100)
  }
  throw new Error(`Timeout: ${label}`)
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id, timeout = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(key, data => { clearTimeout(timeout); if (data.error) reject(new Error(data.error.message)); else resolve(data.result) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}
const ipc = (method, ...args) => evaluate(`window.draftdock.${method}(${args.map(value => JSON.stringify(value)).join(',')})`)
const idle = () => evaluate(`!!document.querySelector('textarea[aria-label="平台正文"]') && !document.querySelector('textarea[aria-label="平台正文"]').disabled && [...document.querySelectorAll('.platform-tabs button')].every(button => !button.disabled) && !document.querySelector('.error-banner')`)
const activePlatform = () => evaluate(`document.querySelector('.platform-tabs .active')?.textContent`)
async function switchPlatform(label) {
  await waitFor('UI idle before platform switch', idle)
  await evaluate(`(() => { const button = [...document.querySelectorAll('.platform-tabs button')].find(button => button.textContent === ${JSON.stringify(label)}); if (!button) throw new Error('Platform button missing'); button.click(); })()`)
  await waitFor(`platform ${label}`, async () => await activePlatform() === label && await idle())
}
const editorValue = () => evaluate(`document.querySelector('textarea[aria-label="平台正文"]').value`)
const setEditor = text => `(() => { const field = document.querySelector('textarea[aria-label="平台正文"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`
async function snapshot(name) { const image = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(profile, `${name}.png`), Buffer.from(image.data, 'base64')) }
async function click(expression) { await evaluate(expression); await waitFor('UI idle', idle) }
const checkedImages = () => evaluate(`[...document.querySelectorAll('.image-card')].filter(card => card.querySelector('input[type="checkbox"]').checked).map(card => card.querySelector('.image-info strong').textContent)`)
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex')

try {
  const page = await waitFor('renderer debug target', async () => {
    assert(alive(), 'Packaged application exited before loading')
    try { return (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json()).find(target => target.type === 'page') } catch { return null }
  })
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => { const result = JSON.parse(event.data); if (result.id && pending.has(result.id)) { pending.get(result.id)(result); pending.delete(result.id) } }
  await waitFor('actual workbench and preload', async () => await evaluate(`typeof window.draftdock === 'object' && !!document.querySelector('.article-row')`) && await idle())
  const library = await ipc('getLibrary')
  assert.equal(library.mode, 'library', 'Configured library mode was ignored')
  assert.equal(library.articles.length, 2, 'Root README must not merge two article folders')
  const article = library.articles.find(item => item.folderPath === firstFolder)
  assert(article && article.sourceFiles.length >= 2 && article.images.length >= 2, 'Recursive package scan did not discover sources and images')
  const row = library.articles.findIndex(item => item.id === article.id)
  await click(`document.querySelectorAll('.article-row')[${row}].click()`)
  await waitFor('tested article', async () => (await evaluate(`document.querySelector('.article-row.active')?.querySelector('strong')?.textContent`)) === article.title)
  await snapshot('startup')
  const originalHashes = new Map(await Promise.all([...article.sourceFiles.map(file => file.path), ...article.images.map(image => image.path)].map(async file => [file, await hash(file)])))

  // Exercise React event handlers, rather than calling saveDraft to conceal autosave failures.
  const switchMarker = `\n\nSWITCH-${randomUUID()}`
  const edited = await editorValue() + switchMarker
  await evaluate(`${setEditor(edited)}; [...document.querySelectorAll('.platform-tabs button')].find(button => button.textContent === '小红书').click()`)
  await waitFor('immediate platform switch', async () => await activePlatform() === '小红书' && await idle())
  await switchPlatform('微信公众号')
  assert.equal(await editorValue(), edited, 'Immediate platform switch lost trailing edit')
  assert.equal(JSON.parse(await readFile(path.join(firstFolder, '.draftdock', 'state.json'), 'utf8')).drafts.wechat.markdown, edited, 'UI edit did not persist to disk')

  await click(`[...document.querySelectorAll('.image-toolbar button')].find(button => button.textContent === '清空选择').click()`)
  for (const file of ['smoke-image-a.png', 'smoke-image-b.png']) {
    await click(`(() => { const card = [...document.querySelectorAll('.image-card')].find(card => card.querySelector('.image-info strong').textContent === ${JSON.stringify(file)}); card.querySelector('input[type="checkbox"]').click(); })()`)
  }
  await waitFor('two selected images', async () => (await checkedImages()).length === 2)
  await click(`document.querySelector('.image-card.image-selected button[title="下移"]').click()`)
  await waitFor('image order changed', async () => (await checkedImages())[0] === 'smoke-image-b.png')
  await switchPlatform('小红书')
  await switchPlatform('微信公众号')
  assert.deepEqual(await checkedImages(), ['smoke-image-b.png', 'smoke-image-a.png'], 'Image order did not persist across platforms')
  await click(`document.querySelector('.image-card.image-selected input[type="checkbox"]').click()`)
  await waitFor('image deselected', async () => (await checkedImages()).length === 1)
  await switchPlatform('小红书')
  await switchPlatform('微信公众号')
  assert.deepEqual(await checkedImages(), ['smoke-image-a.png'], 'Deselected image reappeared after switching')
  const imageState = JSON.parse(await readFile(path.join(firstFolder, '.draftdock', 'state.json'), 'utf8')).drafts.wechat.images
  assert.deepEqual(imageState.map(image => image.sourcePath), [firstImage], 'Image choice was not stored on disk')
  await snapshot('workbench')

  await call('Emulation.setDeviceMetricsOverride', { width: 1180, height: 720, deviceScaleFactor: 1, mobile: false })
  try {
    await waitFor('narrow desktop viewport', () => evaluate('window.innerWidth === 1180 && window.innerHeight === 720'))
    const narrow = await evaluate(`(() => {
      const actions = [...document.querySelectorAll('.platform-tabs button, .delivery-footer button')].map(button => {
        const bounds = button.getBoundingClientRect(); return { label: button.textContent, left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      });
      return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, actions };
    })()`)
    await snapshot('narrow')
    // Windows fractional display scaling can round the root by one CSS pixel.
    assert(narrow.scrollWidth <= narrow.innerWidth + 1 && narrow.bodyWidth <= narrow.innerWidth + 1, `Narrow desktop layout overflows horizontally: ${JSON.stringify(narrow)}`)
    for (const action of narrow.actions) assert(action.left >= -1 && action.top >= -1 && action.right <= narrow.innerWidth + 1 && action.bottom <= narrow.innerHeight + 1, `Primary action is outside narrow viewport: ${action.label}`)
  } finally { await call('Emulation.clearDeviceMetricsOverride') }

  await click(`document.querySelector('.image-card.image-selected .mini-button.accent').click()`)
  await waitFor('loaded crop dialog', () => evaluate(`!!document.querySelector('.crop-studio') && !document.querySelector('.crop-footer .button.primary').disabled`))
  const ratio = await evaluate(`(() => { const bounds = document.querySelector('.result-stage').getBoundingClientRect(); return bounds.width / bounds.height; })()`)
  assert(Math.abs(ratio - 900 / 383) < 0.02, 'Crop preview ratio does not match export size')
  await evaluate(`[...document.querySelectorAll('.crop-controls button')].find(button => button.textContent === '完整显示').click()`)
  await waitFor('crop zoom-out', () => evaluate(`Number(document.querySelector('#zoom').value) < 1`))
  await snapshot('crop')
  await evaluate(`document.querySelector('.crop-footer .button.primary').click()`)
  await waitFor('UI generated and selected a new derivative', async () => await idle() && await evaluate(`!document.querySelector('.crop-studio')`))
  const generatedArticle = (await ipc('getLibrary')).articles.find(item => item.folderPath === firstFolder)
  const chosenVersion = generatedArticle.drafts.wechat.images.find(image => image.sourcePath === firstImage)?.outputPath
  const derivative = generatedArticle.images.find(image => image.path === firstImage)?.derivatives.find(image => image.outputPath === chosenVersion)
  assert(derivative, 'UI generation did not select and persist the new derivative')
  for (const platform of ['wechat', 'xiaohongshu', 'x', 'zhihu']) {
    const draft = { title: `Workflow ${platform}`, markdown: 'Verified short publishing body.', updatedAt: new Date().toISOString(), account: 'workflow-test', status: 'ready', images: [{ sourcePath: secondImage }, { sourcePath: firstImage, ...(platform === 'wechat' ? { outputPath: derivative.outputPath } : {}) }] }
    const { title, markdown, updatedAt: _time, ...details } = draft
    await ipc('saveDraft', { articleFolder: firstFolder, platform, title, markdown, details })
    const result = await ipc('exportBundle', { articleFolder: firstFolder, platform, draft })
    assert.equal(result.imageCount, 2)
    const manifest = JSON.parse(await readFile(path.join(result.outputFolder, 'manifest.json'), 'utf8'))
    assert.equal(manifest.account, 'workflow-test')
    assert.equal(manifest.status, 'ready')
    assert.deepEqual(manifest.images.map(image => image.sourcePath), [path.basename(secondImage), path.basename(firstImage)])
    assert.equal(manifest.images[1].derived, platform === 'wechat')
    assert.equal((await readdir(path.join(result.outputFolder, 'images'))).length, 2)
    const body = await readFile(path.join(result.outputFolder, 'body.txt'), 'utf8')
    assert(body.includes(draft.markdown))
    if (platform === 'x') assert(body.startsWith(draft.title), 'X opening text omitted from delivery')
    assert((await readFile(path.join(result.outputFolder, 'article.html'), 'utf8')).includes('src="images/01-'))
  }
  for (const [file, before] of originalHashes) assert.equal(await hash(file), before, 'Original source file changed')

  const baseline = { title: 'History baseline', markdown: 'Restorable platform body.', details: { account: 'history-account', status: 'ready', images: [{ sourcePath: firstImage }] } }
  await ipc('saveDraft', { articleFolder: firstFolder, platform: 'wechat', ...baseline })
  const rebuilt = await ipc('selectSources', firstFolder, [a, b])
  const rebuiltArticle = rebuilt.articles.find(item => item.folderPath === firstFolder)
  assert.equal(rebuiltArticle.selectedSources.length, 2)
  const history = rebuiltArticle.history.findLast(record => record.drafts.wechat?.markdown === baseline.markdown)
  assert(history, 'Source rebuild did not archive edited platform draft')
  const restored = await ipc('restoreHistory', firstFolder, history.id)
  const restoredDraft = restored.articles.find(item => item.folderPath === firstFolder).drafts.wechat
  assert.equal(restoredDraft.markdown, baseline.markdown)
  assert.equal(restoredDraft.account, baseline.details.account)
  assert.equal(restoredDraft.images.length, 1)
  await click(`document.querySelector('button[title="重新扫描"]').click()`)
  await waitFor('restored history in actual editor', async () => await editorValue() === baseline.markdown && await idle())

  const reloadText = `${baseline.markdown}\n\nRELOAD-${randomUUID()}`
  await evaluate(`${setEditor(reloadText)}; window.__smokeOldPage = true; window.draftdock.requestReload()`)
  await waitFor('save-guarded reload', async () => {
    try { return !await evaluate('!!window.__smokeOldPage') && await idle() && await editorValue() === reloadText } catch { return false }
  })
  assert.equal(JSON.parse(await readFile(path.join(firstFolder, '.draftdock', 'state.json'), 'utf8')).drafts.wechat.markdown, reloadText, 'Reload lost trailing UI input')
  const closeText = `${reloadText}\n\nCLOSE-${randomUUID()}`
  // Intentionally close immediately after the UI input event. No manual save/flush follows this edit.
  socket.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: `${setEditor(closeText)}; window.close()`, userGesture: true } }))
  await waitFor('graceful application close', () => !alive())
  assert.equal(child.exitCode, 0, 'Application did not exit normally after close-save handshake')
  const closedState = JSON.parse(await readFile(path.join(firstFolder, '.draftdock', 'state.json'), 'utf8'))
  assert.equal(closedState.drafts.wechat.markdown, closeText, 'Immediate close lost trailing UI input')
  const logs = await readFile(path.join(profile, 'logs', 'draftdock.log'), 'utf8')
  assert(logs.includes('renderer.ready') && logs.includes('app.quit'), 'Lifecycle diagnostics missing')
  assert(!logs.includes('preload.error') && !logs.includes('main.uncaughtException'), 'Packaged runtime logged a startup crash')
  console.log('PASS: two-article scan, immediate-switch save, image order/selection, crop generation, narrow layout, four-platform bundles, source history, reload and immediate-close save')
  console.log(`Evidence: ${profile}`)
} finally {
  socket?.close()
  if (alive() && child.pid) await new Promise(resolve => {
    const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    kill.on('exit', resolve); kill.on('error', resolve)
  })
}
