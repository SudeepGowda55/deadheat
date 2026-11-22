import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fix } from '../src/fix.js'

const lost = { race: 'r', order: 'together', verdict: 'lost', errors: [], invariant: null, timeline: [{ event: 'held', lane: 'A', method: 'POST', path: '/book', t: 1 }],
  users: [{ name: 'A', told: 'yes', outcome: 'kept', links: [] }, { name: 'B', told: 'yes', outcome: 'lost', links: [], keptSummary: 'B is not there' }] }
const code = results => results.every(r => r.verdict === 'clean') ? 0 : 1

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'deadheat fix ')) // a space, on purpose
  const config = join(dir, 'deadheat.json'), app = join(dir, 'app.txt')
  writeFileSync(config, '{"races":[]}'); writeFileSync(app, 'unsafe')
  process.chdir(dir) // briefs go to .deadheat/ in the working directory
  // The app is "fixed" when app.txt says safe; the fake race reads it.
  const raceAll = async () => [readFileSync(app, 'utf8') === 'safe' ? { ...lost, verdict: 'clean' } : lost]
  return { dir, config, app, raceAll }
}

test('the agent gets a brief, changes the app, and the loop stops once every order is clean', async () => {
  const { dir, config, app, raceAll } = setup()
  const exit = await fix({ raceAll, code, configPath: config, command: `grep -q "B was told" {brief} && printf safe > '${app}'`, max: 3, cwd: dir, emit: () => {} })
  assert.equal(exit, 0)
  assert.ok(existsSync(join(dir, '.deadheat', 'brief-1.md')) && !existsSync(join(dir, '.deadheat', 'brief-2.md')))
})

test('an agent that edits the race file is stopped and the file restored', async () => {
  const { dir, config, raceAll } = setup()
  await assert.rejects(fix({ raceAll, code, configPath: config, command: `printf '{}' > '${config}'`, max: 3, cwd: dir, emit: () => {} }), /edited the race file/)
  assert.equal(readFileSync(config, 'utf8'), '{"races":[]}')
})

test('it gives up after --max attempts', async () => {
  const { dir, config, raceAll } = setup()
  let calls = 0
  const counting = async () => { calls++; return raceAll() }
  assert.equal(await fix({ raceAll: counting, code, configPath: config, command: 'true', max: 2, cwd: dir, emit: () => {} }), 1)
  assert.equal(calls, 3) // the first race, then one race after each of the two attempts
})
