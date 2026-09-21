import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export function createLogger(directory: string, maxBytes = 5 * 1024 * 1024, backups = 5) {
  const file = path.join(directory, 'draftdock.log')
  const session = `${Date.now()}-${process.pid}`
  function write(level: string, event: string, details?: unknown): void {
    try {
      mkdirSync(directory, { recursive: true })
      if (existsSync(file) && statSync(file).size >= maxBytes) {
        if (existsSync(`${file}.${backups}`)) unlinkSync(`${file}.${backups}`)
        for (let i = backups - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`)
        renameSync(file, `${file}.1`)
      }
      const serialized = JSON.stringify(details, (_key, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value)
      appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), session, pid: process.pid, level, event, details: serialized?.slice(0, 16000) }) + '\n', 'utf8')
    } catch (error) { console.error('DraftDock log write failed', error) }
  }
  return { directory, file, write }
}
