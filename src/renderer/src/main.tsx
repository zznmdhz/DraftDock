import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

const report = (event: string, error: unknown): void => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(event, message)
  window.draftdock?.report({ level: 'error', event, message })
}
window.addEventListener('error', (event) => report('uncaught', event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => {
  report('unhandledrejection', event.reason)
  const notice = document.getElementById('operation-error') ?? document.createElement('div')
  notice.id = 'operation-error'
  notice.setAttribute('role', 'alert')
  notice.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;padding:18px;background:#fff0ec;color:#962b16;z-index:10000;border:1px solid #f4b5a2;border-radius:10px'
  notice.textContent = `操作未完成：${event.reason?.message ?? String(event.reason)}。详情已记录，可通过帮助菜单打开日志。`
  notice.onclick = () => notice.remove()
  document.body.appendChild(notice)
})
class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: React.ErrorInfo) { report('react.crash', `${error.stack}\n${info.componentStack}`) }
  render() { return this.state.failed ? <Failure /> : this.props.children }
}
function Failure() {
  return <div style={{ padding: 48, fontFamily: 'sans-serif' }}><h1>稿间暂时无法显示页面</h1><p>启动异常已记录。请打开日志文件夹，将日志提供给维护者。</p><button onClick={() => window.draftdock ? window.draftdock.requestReload() : location.reload()}>重新加载</button> <button onClick={() => { void window.draftdock?.openLogs() }}>打开日志文件夹</button><p>如果按钮无响应，请按 Alt 打开“帮助”菜单。</p></div>
}
function Root() {
  React.useEffect(() => { window.draftdock?.report({ level: 'info', event: 'ready', message: 'React mounted; desktop bridge available' }) }, [])
  return <App />
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary>{window.draftdock ? <Root /> : <Failure />}</ErrorBoundary></React.StrictMode>
)
