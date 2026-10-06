import type { SaveDraftInput } from '../../shared/types'

export class DraftBuffer {
  private pending = new Map<string, SaveDraftInput>()
  private chain: Promise<void> = Promise.resolve()
  constructor(private save: (input: SaveDraftInput) => Promise<void>) {}
  static key(input: Pick<SaveDraftInput, 'articleFolder' | 'platform'>): string { return `${input.articleFolder}\0${input.platform}` }
  set(input: SaveDraftInput): void { this.pending.set(DraftBuffer.key(input), structuredClone(input)) }
  get size(): number { return this.pending.size }
  flush(): Promise<void> {
    const task = this.chain.catch(() => {}).then(async () => {
      while (this.pending.size) {
        for (const [key, input] of [...this.pending]) {
          await this.save(input)
          if (this.pending.get(key) === input) this.pending.delete(key)
        }
      }
    })
    this.chain = task
    return task
  }
}
