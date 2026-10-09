import { test } from '@japa/runner'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sendMoph } from '#services/moph_notify'
import { buildLineMessages } from '#services/notifier'

/**
 * MOPH Notify client against a local fake server (never calls the real API).
 * The real API answers HTTP 200 even for a bad key, so success must come from
 * the JSON body's `status`.
 */
async function fakeMoph(replies: Array<{ http: number; body: string }>) {
  const seen: Array<{ headers: Record<string, any>; body: any }> = []
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw) })
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
      res.writeHead(reply.http, { 'Content-Type': 'application/json' })
      res.end(reply.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    seen,
    target: { apiUrl: `http://127.0.0.1:${port}/send`, clientKey: 'ck', secretKey: 'sk' },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test.group('moph_notify.sendMoph', () => {
  test('HTTP 200 + body status 200 is a success, keys go in headers', async ({ assert }) => {
    const fake = await fakeMoph([{ http: 200, body: '{"status":200,"message":"Succesfully"}' }])
    const r = await sendMoph(fake.target, [{ type: 'text', text: 'hi' }])
    await fake.close()
    assert.isTrue(r.ok)
    assert.equal(fake.seen[0].headers['client-key'], 'ck')
    assert.equal(fake.seen[0].headers['secret-key'], 'sk')
    assert.deepEqual(fake.seen[0].body, { messages: [{ type: 'text', text: 'hi' }] })
  })

  test('HTTP 200 + body status 401 is a failure and is not retried', async ({ assert }) => {
    const fake = await fakeMoph([{ http: 200, body: '{"status":401,"message":"Unauthorized"}' }])
    const r = await sendMoph(fake.target, [{ type: 'text', text: 'hi' }])
    await fake.close()
    assert.isFalse(r.ok)
    assert.equal(r.apiStatus, 401)
    assert.equal(r.attempts, 1)
  })

  test('5xx is retried, then succeeds', async ({ assert }) => {
    const fake = await fakeMoph([
      { http: 502, body: 'bad gateway' },
      { http: 200, body: '{"status":200}' },
    ])
    const r = await sendMoph(fake.target, [{ type: 'text', text: 'hi' }])
    await fake.close()
    assert.isTrue(r.ok)
    assert.equal(r.attempts, 2)
  })
})

test.group('notifier.buildLineMessages', () => {
  const card = {
    text: 'คำขอใหม่ REQ-2570-0001',
    title: 'คำขอใหม่',
    color: '#1E40AF',
    rows: [['เรื่อง', 'ทดสอบ']] as Array<[string, string]>,
    url: 'http://hisreport.local/admin/requests/1',
  }

  test('text format appends the link', ({ assert }) => {
    const [m] = buildLineMessages('text', card)
    assert.deepEqual(m, { type: 'text', text: `${card.text}\n${card.url}` })
  })

  test('flex format is a small body-only bubble with altText and a button', ({ assert }) => {
    const [m] = buildLineMessages('flex', card)
    assert.equal(m.type, 'flex')
    if (m.type !== 'flex') return
    assert.equal(m.altText, card.text)
    assert.notProperty(m.contents, 'header')
    assert.notProperty(m.contents, 'footer')
    assert.include(JSON.stringify(m.contents), card.url)
    assert.isBelow(JSON.stringify(m.contents).length, 3000)
  })

  test('flex without an absolute URL has no button', ({ assert }) => {
    const [m] = buildLineMessages('flex', { ...card, url: '/admin/requests/1' })
    assert.notInclude(JSON.stringify(m), '"uri"')
  })
})
