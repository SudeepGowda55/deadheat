import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matcher, outcome, runRace, verdict } from '../src/race.js'
import { startDesk } from '../examples/desk/desk.js'

test('hold patterns match method and path, and default to any write', () => {
  assert.ok(matcher('POST /book')({ method: 'POST', url: '/book' }))
  assert.ok(matcher('put /api/tasks/*')({ method: 'PUT', url: '/api/tasks/12?x=1' }))
  assert.ok(!matcher('POST /book')({ method: 'POST', url: '/booking' }))
  assert.ok(matcher()({ method: 'DELETE', url: '/x' }) && !matcher()({ method: 'GET', url: '/x' }))
})

test('a user whose work is gone is refused if told so and lost if not', () => {
  assert.deepEqual([{ kept: true }, { kept: false, refused: true }, { kept: false, refused: false }].map(outcome), ['kept', 'refused', 'lost'])
  assert.equal(verdict({ held: true, users: [{ outcome: 'kept' }, { outcome: 'lost' }], invariant: null, errors: [] }), 'lost')
  assert.equal(verdict({ held: true, users: [{ outcome: 'kept' }, { outcome: 'refused' }], invariant: null, errors: [] }), 'clean')
  assert.equal(verdict({ held: true, users: [{ outcome: 'kept' }, { outcome: 'kept' }], invariant: false, errors: [] }), 'broken')
  assert.equal(verdict({ held: false, users: [], invariant: null, errors: [] }), 'no-race')
  assert.equal(outcome({ kept: false, refused: false, answered: 500 }), 'crashed')
  assert.equal(verdict({ held: true, users: [{ outcome: 'kept' }, { outcome: 'crashed' }], invariant: null, errors: [] }), 'crashed')
})

// Stands in for Kane CLI: books through the lane like a browser would and answers the two kinds of question.
const fakeUser = async (objective, { url, cdpEndpoint }) => {
  const origin = url ? new URL(url).origin : cdpEndpoint.origin
  if (objective.includes('Verify this')) {
    const page = await fetch(origin).then(r => r.text())
    return { status: page.includes(`Booked by ${objective.match(/Booked by (\w+)/)[1]}`) ? 'passed' : 'failed' }
  }
  const name = objective.match(/Type "(\w+)"/)[1]
  const page = await fetch(`${origin}/book`, { method: 'POST', body: new URLSearchParams({ name }) }).then(r => r.text())
  return { status: 'passed', final_state: { told: page.match(/id="message">([^<]*)/)[1], refused: page.includes('someone else') ? 'yes' : 'no' } }
}
const race = { name: 'last desk', hold: 'POST /book', users: ['Manvith', 'Sudeep'].map(name => ({ name, do: `Type "${name}" and book.`,
  kept: `The status says Booked by ${name}`, refused: 'the page says someone else booked it' })) }
const options = (appPort, ports, order) => ({ app: { url: `http://127.0.0.1:${appPort}` }, ports, order, drive: fakeUser, shoot: async () => null,
  launch: async port => ({ endpoint: { origin: `http://127.0.0.1:${ports[port - 1]}` }, close() {} }), chromePorts: [1, 2] })

test('the unsafe desk loses one booking silently when both land together', async () => {
  const desk = await startDesk(4731)
  const result = await runRace(race, options(4731, [4732, 4733], 'together'))
  desk.close()
  assert.equal(result.verdict, 'lost')
  assert.deepEqual(result.users.map(u => u.outcome).sort(), ['kept', 'lost'])
  assert.ok(result.users.every(u => u.told.startsWith('Confirmed')))
})

test('one after the other, the second user is refused honestly', async () => {
  const desk = await startDesk(4741)
  const result = await runRace(race, options(4741, [4742, 4743], 'first-then-second'))
  desk.close()
  assert.equal(result.verdict, 'clean')
  assert.deepEqual(result.users.map(u => u.outcome), ['kept', 'refused'])
})

test('the safe desk stays clean when both land together', async () => {
  const desk = await startDesk(4751, { safe: true })
  const result = await runRace(race, options(4751, [4752, 4753], 'together'))
  desk.close()
  assert.equal(result.verdict, 'clean')
})
