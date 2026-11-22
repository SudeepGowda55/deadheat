#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { browsers } from '../src/browser.js'
import { fix } from '../src/fix.js'
import { runs } from '../src/kane.js'
import { ORDERS, appControl, runRace } from '../src/race.js'
import { printEvent, printResult, writeReport } from '../src/report.js'

const HELP = `deadheat: two real users, one instant.

  deadheat race [name]        race every order (or --orders together) and report who silently lost
  deadheat fix --with "cmd"   race, hand the failure to your coding agent, restart the app, race again
  deadheat init               write an example deadheat.json

  --config <file>   default deadheat.json        --orders <a,b>   ${ORDERS.join(', ')}
  --headed          show both browsers           --agent          NDJSON on stdout for coding agents
  --max <n>         fix attempts, default 3      --with <cmd>     agent command; {brief} is the brief's path

Exit code: 0 clean, 1 a user silently lost, a save crashed the app, or an invariant broke, 2 the race could not be run.`

const EXAMPLE = { app: { url: 'http://127.0.0.1:3000', start: 'npm start', reset: '' }, races: [{ name: 'last desk', hold: 'POST /book', users: [
  { name: 'Manvith', setup: '', do: 'Type "Manvith" into the name field and click "Book the desk".', kept: 'The page says the desk is booked by Manvith.', refused: 'the page says someone else booked the desk' },
  { name: 'Sudeep', setup: '', do: 'Type "Sudeep" into the name field and click "Book the desk".', kept: 'The page says the desk is booked by Sudeep.', refused: 'the page says someone else booked the desk' }] }] }

const { values: flags, positionals: [command, name] } = parseArgs({ allowPositionals: true, options: { config: { type: 'string', default: 'deadheat.json' },
  orders: { type: 'string' }, headed: { type: 'boolean' }, agent: { type: 'boolean' }, with: { type: 'string' }, max: { type: 'string', default: '3' }, help: { type: 'boolean', short: 'h' } } })

if (flags.help || !command) { console.log(HELP); process.exit(0) }
if (command === 'init') {
  if (existsSync(flags.config)) { console.error(`${flags.config} already exists`); process.exit(2) }
  writeFileSync(flags.config, JSON.stringify(EXAMPLE, null, 2) + '\n'); console.log(`Wrote ${flags.config}. Describe your two users, then run: deadheat race`); process.exit(0)
}
if (!existsSync(flags.config)) { console.error(`No ${flags.config} here. Run: deadheat init`); process.exit(2) }

const configPath = resolve(flags.config)
let config
try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch (error) { console.error(`${flags.config} is not valid JSON: ${error.message}`); process.exit(2) }
const problem = !config.app?.url ? 'app.url is missing' : !Array.isArray(config.races) || !config.races.length ? 'races is missing or empty'
  : config.races.map(r => r.users?.length !== 2 ? `race "${r.name}" needs exactly two users`
    : !r.users[0].name || r.users[0].name === r.users[1].name ? `race "${r.name}": the two users need different names`
    // Without "refused", an honest "sorry, taken" could not be told apart from a silent loss.
    : r.users.find(u => !u.do || !u.kept || !u.refused) ? `race "${r.name}": every user needs "do", "kept" and "refused"` : null).find(Boolean)
if (problem) { console.error(`${flags.config}: ${problem}`); process.exit(2) }
const max = Number(flags.max)
if (!Number.isInteger(max) || max < 0) { console.error(`--max must be a whole number, got ${flags.max}`); process.exit(2) }
// Commands, the app and the reports all work from the race file's folder, wherever deadheat is run from.
process.chdir(dirname(configPath))
const races = config.races.filter(r => !name || r.name === name)
if (!races.length) { console.error(`No race called "${name}" in ${flags.config}`); process.exit(2) }
const orders = flags.orders ? flags.orders.split(',') : ORDERS
const bad = orders.find(o => !ORDERS.includes(o))
if (bad) { console.error(`Unknown order "${bad}". Use: ${ORDERS.join(', ')}`); process.exit(2) }
const emit = flags.agent ? e => console.log(JSON.stringify(e)) : printEvent
const app = appControl(config.app)
// The app runs in its own process group, so Ctrl-C would otherwise leave it running.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const child of [...browsers, ...runs]) child.kill()
  app.stop(); process.exit(signal === 'SIGTERM' ? 143 : 130)
})
const slugs = new Map(races.map((race, i) => [race, race.name.replace(/\W+/g, '-').toLowerCase()]))
for (const [race, slug] of slugs) if ([...slugs.values()].indexOf(slug) !== races.indexOf(race)) slugs.set(race, `${slug}-${races.indexOf(race) + 1}`)

// Every order of every race, with the app reset and restarted before each one.
async function raceAll() {
  const results = []
  for (const race of races) for (const order of orders) {
    await app.restart()
    results.push(await runRace(race, { app: config.app, order, headless: !flags.headed, out: join('.deadheat', slugs.get(race)), emit, ports: config.ports, chromePorts: config.chromePorts }))
  }
  const report = writeReport(results, '.deadheat')
  if (flags.agent) console.log(JSON.stringify({ event: 'report', report, results: results.map(({ timeline, ...r }) => r) }))
  else printResult(results, report)
  return results
}

// A proven failure in any order wins over an order that could not be run.
const code = results => results.some(r => ['lost', 'crashed', 'broken'].includes(r.verdict)) ? 1 : results.some(r => r.verdict === 'error' || r.verdict === 'no-race') ? 2 : 0
let exit = 2
try {
  if (command === 'race') exit = code(await raceAll())
  else if (command === 'fix') exit = await fix({ raceAll, code, configPath, command: flags.with || config.agent, max, cwd: config.app.cwd, emit })
  else console.error(HELP)
} catch (error) { console.error(`deadheat: ${error.message}`) } finally { app.stop() }
process.exit(exit)
