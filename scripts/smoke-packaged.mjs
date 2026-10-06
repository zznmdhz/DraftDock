import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const exe = path.resolve(process.argv[2] ?? 'release/win-unpacked/稿间 DraftDock.exe')
const profile = await mkdtemp(path.join(tmpdir(), 'draftdock-smoke-'))
const port = 19000 + Math.floor(Math.random() * 1000)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.DRAFTDOCK_CONTENT_ROOT
if (process.argv[3]) {
  const copy = path.join(profile, 'content')
  await cp(path.resolve(process.argv[3]), copy, { recursive: true })
  env.DRAFTDOCK_CONTENT_ROOT = copy
}
const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--enable-logging'], { env, stdio: 'inherit' })
child.on('exit', (code, signal) => console.log('Application exited', { code, signal }))
let socket
try {
  let page
  for (let i = 0; i < 100; i++) {
    assert(child.exitCode === null, `Application exited early: ${child.exitCode}`)
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); if (page) break } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  assert(page, 'No renderer debug target')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = e => { const data = JSON.parse(e.data); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id) } }
  const call = (method, params) => new Promise((resolve, reject) => {
    const key = ++id
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000)
    pending.set(key, result => { clearTimeout(timeout); resolve(result) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  let result
  for (let i = 0; i < 50; i++) {
    result = await call('Runtime.evaluate', { expression: 'JSON.stringify({bridge:typeof window.draftdock, text:document.body.innerText})', returnByValue: true })
    if (result.result?.result?.value && JSON.parse(result.result.result.value).text.includes(env.DRAFTDOCK_CONTENT_ROOT ? '正文与交付' : '选择内容根目录')) break
    await new Promise(r => setTimeout(r, 200))
  }
  const state = JSON.parse(result.result.result.value)
  console.log(JSON.stringify({ exe, profile, bridge: state.bridge, rendered: true }, null, 2))
  assert.equal(state.bridge, 'object', 'Preload bridge missing')
  assert(state.text.includes(env.DRAFTDOCK_CONTENT_ROOT ? '正文与交付' : '选择内容根目录'), 'Application did not render')
  const ipc = await call('Runtime.evaluate', { expression: 'window.draftdock.getLibrary()', awaitPromise: true, returnByValue: true })
  assert(!ipc.result.exceptionDetails, 'Library IPC failed')
  if (!env.DRAFTDOCK_CONTENT_ROOT) assert.equal(ipc.result.result.value.rootPath, null)
  else {
    const article = ipc.result.result.value.articles[0]
    assert(article.sourceFiles.length > 0)
    assert(article.images.length > 0)
    console.log('Package scan:', { sources: article.sourceFiles.map(f => f.name), images: article.images.length, title: article.title })
    if (article.sourceFiles.length > 1) {
      const change = await call('Runtime.evaluate', { expression: `window.draftdock.selectSources(${JSON.stringify(article.folderPath)},${JSON.stringify(article.sourceFiles.map(f => f.path))})`, awaitPromise: true, returnByValue: true })
      assert(!change.result.exceptionDetails)
      assert.equal(change.result.result.value.articles[0].selectedSources.length, article.sourceFiles.length)
    }
    await call('Runtime.evaluate', { expression: `document.querySelector('.mini-button.accent').click()` })
    await new Promise(r => setTimeout(r, 500))
    const crop = await call('Runtime.evaluate', { expression: `JSON.stringify({ min: Number(document.querySelector('#zoom').min), ratio: document.querySelector('.result-stage').getBoundingClientRect().width / document.querySelector('.result-stage').getBoundingClientRect().height })`, returnByValue: true })
    const measured = JSON.parse(crop.result.result.value)
    assert(measured.min < 1)
    assert(Math.abs(measured.ratio - 900 / 383) < 0.01)
    await call('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => b.textContent === '完整显示').click()` })
    await new Promise(r => setTimeout(r, 300))
    const small = await call('Runtime.evaluate', { expression: `Number(document.querySelector('#zoom').value)`, returnByValue: true })
    assert(small.result.result.value < 1)
    const output = await call('Runtime.evaluate', { expression: `window.draftdock.generateAsset(${JSON.stringify({ articleFolder: article.folderPath, sourcePath: article.images[0].path, platform: 'wechat', presetId: 'smoke-small', width: 900, height: 383, mode: 'cover', background: '#f5f3ee', composition: { zoom: small.result.result.value, offsetX: 0, offsetY: 0 } })})`, awaitPromise: true, returnByValue: true })
    assert(!output.result.exceptionDetails, JSON.stringify(output.result.exceptionDetails))
    console.log('Zoom-out export:', output.result.result.value.outputPath)
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(profile, 'startup.png'), Buffer.from(screenshot.result.data, 'base64'))
  await call('Runtime.evaluate', { expression: 'window.draftdock.report({level:"error",event:"smoke.injected",message:"diagnostics test"})' })
  await new Promise(r => setTimeout(r, 300))
  const logs = await readFile(path.join(profile, 'logs', 'draftdock.log'), 'utf8')
  assert(logs.includes('renderer.ready'))
  assert(logs.includes('renderer.smoke.injected'))
  assert(!logs.includes('preload.error'))
  console.log(`PASS: actual packaged UI, preload, IPC, renderer logs; screenshot: ${profile}\\startup.png`)
} finally {
  socket?.close()
  if (child.pid) await new Promise(resolve => { const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); kill.on('exit', resolve) })
}
