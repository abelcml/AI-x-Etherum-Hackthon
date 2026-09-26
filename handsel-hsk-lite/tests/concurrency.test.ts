import { describe, expect, it } from 'vitest'
import { mapLimit } from '@/lib/concurrency'

describe('mapLimit', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Later items resolve first, so completion order != input order.
    const out = await mapLimit([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      return `${i}:${ms}`
    })
    expect(out).toEqual(['0:30', '1:10', '2:20'])
  })

  it('never runs more than `limit` tasks at once', async () => {
    let running = 0
    let peak = 0
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
    })
    expect(peak).toBe(4)
  })

  it('still completes every item when there are fewer items than the limit', async () => {
    const out = await mapLimit([1, 2], 10, async (n) => n * 2)
    expect(out).toEqual([2, 4])
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (n) => n)).toEqual([])
  })

  it('processes all items even with a limit of 1 (serial)', async () => {
    const order: number[] = []
    await mapLimit([1, 2, 3], 1, async (n) => {
      order.push(n)
    })
    expect(order).toEqual([1, 2, 3])
  })
})
