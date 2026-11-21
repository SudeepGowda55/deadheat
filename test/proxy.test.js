import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startProxy } from '../src/proxy.js'
import { startDesk } from './fixtures/desk.js'

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
