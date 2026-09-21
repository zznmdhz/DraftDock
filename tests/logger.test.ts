import { test, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLogger } from '../src/main/logger'

test('records stack and session, rotates bounded logs, tolerates unwritable location', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'draftdock-logs-'))
  try {
    const logger = createLogger(dir, 1, 2)
    logger.write('error', 'failure', new Error('test failure'))
    const entry = JSON.parse(readFileSync(logger.file, 'utf8'))
    expect(entry.session).toBeTruthy()
    expect(JSON.parse(entry.details).stack).toContain('test failure')
    for (let i = 0; i < 4; i++) logger.write('info', 'next')
    expect(existsSync(`${logger.file}.2`)).toBe(true)
    expect(existsSync(`${logger.file}.3`)).toBe(false)
    expect(() => createLogger(logger.file).write('error', 'cannot.write')).not.toThrow()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
