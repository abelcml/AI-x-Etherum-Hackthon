/**
 * IPFS content addressing — borrowed from the IPFS + ENS lab.
 *
 * The lab's lesson: a static, content-addressed artifact needs no server — its
 * CID *is* its identity, and anyone can verify the bytes match the hash. We use
 * that for proofs and deliverables: computing the CIDv1 (raw codec, sha-256,
 * base32) locally gives every certificate a permanent, verifiable identifier —
 * `ipfs://<cid>` — resolvable on any public gateway once pinned. Pinning is
 * best-effort (only if a pinning endpoint is configured); the CID is derived
 * with zero dependencies so we always have the content address either way.
 */
import { createHash } from 'node:crypto'

const B32 = 'abcdefghijklmnopqrstuvwxyz234567' // RFC 4648 base32, lowercase, no padding

function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

/** CIDv1, raw codec (0x55), sha2-256 multihash, multibase base32 ('b' prefix).
 *  Raw+sha256 CIDv1 base32 always starts with "bafkrei". */
export function cidV1Raw(bytes: Uint8Array | Buffer): string {
  const digest = createHash('sha256').update(bytes instanceof Uint8Array ? Buffer.from(bytes) : bytes).digest()
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]) // 0x12=sha2-256, 0x20=32 bytes
  const cid = Buffer.concat([Buffer.from([0x01, 0x55]), multihash]) // 0x01=CIDv1, 0x55=raw
  return 'b' + base32(cid)
}

/** Content id of a JSON object (canonical stringify). */
export function cidOfJson(obj: unknown): string {
  return cidV1Raw(Buffer.from(JSON.stringify(obj), 'utf8'))
}

/** Public gateway URL for a CID. */
export function gatewayUrl(cid: string, gateway = 'https://ipfs.io'): string {
  return `${gateway.replace(/\/$/, '')}/ipfs/${cid}`
}

/**
 * Best-effort pin to an IPFS pinning service. Configure IPFS_PIN_ENDPOINT
 * (an /api/v0/add-compatible URL, e.g. an IPFS node or Infura/Pinata gateway)
 * and optionally IPFS_PIN_TOKEN. Returns the CID on success, null otherwise —
 * pinning never blocks the caller.
 */
export async function pinBytes(bytes: Uint8Array | Buffer): Promise<string | null> {
  const endpoint = process.env.IPFS_PIN_ENDPOINT
  if (!endpoint) return null
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)]))
    const headers: Record<string, string> = {}
    if (process.env.IPFS_PIN_TOKEN) headers.authorization = `Bearer ${process.env.IPFS_PIN_TOKEN}`
    const res = await fetch(endpoint, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { Hash?: string; cid?: string; IpfsHash?: string } | null
    return data?.Hash ?? data?.cid ?? data?.IpfsHash ?? null
  } catch {
    return null
  }
}
