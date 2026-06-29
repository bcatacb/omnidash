import crypto from 'crypto'

// RFC 6238 TOTP — SHA1, 6 digits, 30s step — from a base32 secret.
// Used to auto-fill TikTok's authenticator 2FA step (the manual relay of a
// 30s-rotating code through a human is too slow / boundary-prone).
export function totp(secret: string, atMs: number = Date.now()): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/[^A-Za-z2-7]/g, '').toUpperCase()) {
    const v = B32.indexOf(ch)
    if (v >= 0) bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}
