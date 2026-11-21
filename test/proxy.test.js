import http from 'node:http'
import net from 'node:net'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startProxy } from '../src/proxy.js'
import { startDesk } from '../examples/desk/desk.js'

const book = (port, name) => fetch(`http://127.0.0.1:${port}/book`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ name }) }).then(r => r.headers.get('location'))
const hold = req => req.method === 'POST'

async function race(safe, ports) {
  const desk = await startDesk(ports[0], { safe })
  const proxy = startProxy({ upstream: `http://127.0.0.1:${ports[0]}`, lanes: [{ name: 'A', port: ports[1] }, { name: 'B', port: ports[2] }], hold })
  const a = book(ports[1], 'Manvith')
  await new Promise(r => setTimeout(r, 300)) // A is frozen while B is still on the way
  const told = await Promise.all([a, book(ports[2], 'Sudeep')])
  await proxy.close(); desk.close()
  return told.filter(l => l.includes('told=')).length
}

test('two frozen bookings released together are both told yes by the unsafe desk', async () => assert.equal(await race(false, [4711, 4712, 4713]), 2))
test('the safe desk tells only one of them yes', async () => assert.equal(await race(true, [4721, 4722, 4723]), 1))

test('websocket upgrades pass through a lane', async () => {
  const app = http.createServer().on('upgrade', (req, socket) => socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello'))
  await new Promise(r => app.listen(4761, '127.0.0.1', r))
  const proxy = startProxy({ upstream: 'http://127.0.0.1:4761', lanes: [{ name: 'A', port: 4762 }], hold })
  const reply = await new Promise(resolve => {
    const socket = net.connect(4762, '127.0.0.1', () => socket.write('GET /live HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
    let text = ''
    socket.on('data', d => { text += d }).on('end', () => resolve(text))
  })
  await proxy.close(); app.close()
  assert.match(reply, /101 Switching Protocols[\s\S]*hello$/)
})

test('a save retried while frozen waits too, and the abandoned one never reaches the app', async () => {
  const seen = []
  const app = http.createServer((req, res) => { seen.push(req.url); res.end('ok') })
  await new Promise(r => app.listen(4771, '127.0.0.1', r))
  const events = []
  const proxy = startProxy({ upstream: 'http://127.0.0.1:4771', lanes: [{ name: 'A', port: 4772 }, { name: 'B', port: 4773 }], hold, log: e => events.push(e.event) })
  const impatient = new AbortController()
  fetch('http://127.0.0.1:4772/save?try=1', { method: 'POST', signal: impatient.signal }).catch(() => {})
  await new Promise(r => setTimeout(r, 150))
  impatient.abort()
  const retry = fetch('http://127.0.0.1:4772/save?try=2', { method: 'POST' })
  await new Promise(r => setTimeout(r, 150))
  assert.deepEqual(seen, [], 'nothing reaches the app while one lane is still on its way')
  await Promise.all([retry, fetch('http://127.0.0.1:4773/save?b', { method: 'POST' })])
  await proxy.close(); app.close()
  assert.deepEqual(seen.sort(), ['/save?b', '/save?try=2'])
  assert.ok(events.includes('abandoned') && events.includes('held_again'))
})

test('a redirect to the app\'s own address is kept inside the lane', async () => {
  const app = http.createServer((req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:4781/next?x=1' }); res.end() })
  await new Promise(r => app.listen(4781, '127.0.0.1', r))
  const proxy = startProxy({ upstream: 'http://127.0.0.1:4781', lanes: [{ name: 'A', port: 4782 }], hold })
  const location = await fetch('http://127.0.0.1:4782/', { redirect: 'manual' }).then(r => r.headers.get('location'))
  await proxy.close(); app.close()
  assert.equal(location, 'http://127.0.0.1:4782/next?x=1')
})
