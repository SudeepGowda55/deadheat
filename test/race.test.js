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
  assert.equal(outcome({ kept: false, refused: false, answered: 409, told: null }), 'refused')
  assert.equal(outcome({ kept: false, refused: false, answered: 409, told: 'Task updated successfully.' }), 'lost')
  assert.equal(outcome({ kept: false, refused: false, answered: 200, told: null }), 'lost')
  assert.equal(verdict({ held: true, users: [{ outcome: 'kept' }, { outcome: 'crashed' }], invariant: null, errors: [] }), 'crashed')
})

const shown = new Map()
// Stands in for Kane CLI: books through the lane like a browser would and answers the two kinds of question.
const fakeUser = async (objective, { url, cdpEndpoint }) => {
  const origin = url ? new URL(url).origin : cdpEndpoint.origin
  if (objective.includes('Verify this')) {
    const page = await fetch(origin).then(r => r.text())
    return { status: page.includes(`Booked by ${objective.match(/Booked by (\w+)/)[1]}`) ? 'passed' : 'failed' }
  }
  if (objective.includes('read the page exactly as it is now')) {
    const page = shown.get(origin) // what this user's browser is showing after its save
    return { status: 'passed', final_state: { told: page.match(/id="message">([^<]*)/)[1], refused: page.includes('someone else') ? 'yes' : 'no' } }
  }
  const name = objective.match(/Type "(\w+)"/)[1]
  shown.set(origin, await fetch(`${origin}/book`, { method: 'POST', body: new URLSearchParams({ name }) }).then(r => r.text()))
  return { status: 'passed' }
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

test('a read that stored no answer makes the order unjudgeable, never a silent loss', async () => {
  const desk = await startDesk(4761)
  const blank = async (objective, o) => objective.includes('read the page exactly as it is now') ? { status: 'passed', final_state: {} } : fakeUser(objective, o)
  const result = await runRace(race, { ...options(4761, [4762, 4763], 'first-then-second'), drive: blank })
  desk.close()
  assert.equal(result.verdict, 'error')
  assert.ok(result.errors.some(e => e.includes('did not store what the page said')))
})

test("an action is retried only when Kane CLI failed before the save left the browser", async () => {
  const desk = await startDesk(4771)
  let failedOnce = false
  const flaky = async (objective, o) => {
    if (objective.includes('Type "Sudeep"') && !failedOnce) { failedOnce = true; return { status: 'error', exitCode: 2, stderr: 'Chrome failed: fetch failed' } }
    return fakeUser(objective, o)
  }
  const result = await runRace(race, { ...options(4771, [4772, 4773], 'first-then-second'), drive: flaky })
  desk.close()
  assert.equal(result.verdict, 'clean')
  assert.deepEqual(result.users.map(u => u.outcome), ['kept', 'refused'])
})
