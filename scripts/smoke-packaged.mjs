import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const exe = path.resolve(process.argv[2] ?? 'release/win-unpacked/稿间 DraftDock.exe')
const profile = await mkdtemp(path.join(tmpdir(), 'draftdock-smoke-'))
const port = 19000 + Math.floor(Math.random() * 1000)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.DRAFTDOCK_CONTENT_ROOT
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
    if (result.result?.result?.value && JSON.parse(result.result.result.value).text.includes('选择内容根目录')) break
    await new Promise(r => setTimeout(r, 200))
  }
  const state = JSON.parse(result.result.result.value)
  console.log(JSON.stringify({ exe, profile, ...state }, null, 2))
  assert.equal(state.bridge, 'object', 'Preload bridge missing')
  assert(state.text.includes('选择内容根目录'), 'Onboarding did not render')
  const ipc = await call('Runtime.evaluate', { expression: 'window.draftdock.getLibrary()', awaitPromise: true, returnByValue: true })
  assert(!ipc.result.exceptionDetails, 'Library IPC failed')
  assert.equal(ipc.result.result.value.rootPath, null)
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
