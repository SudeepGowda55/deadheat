#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fix } from '../src/fix.js'
import { ORDERS, appControl, runRace } from '../src/race.js'
import { printEvent, printResult, writeReport } from '../src/report.js'

const HELP = `deadheat: two real users, one instant.

  deadheat race [name]        race every order (or --orders together) and report who silently lost
  deadheat fix --with "cmd"   race, hand the failure to your coding agent, restart the app, race again
  deadheat init               write an example deadheat.json

  --config <file>   default deadheat.json        --orders <a,b>   ${ORDERS.join(', ')}
  --headed          show both browsers           --agent          NDJSON on stdout for coding agents
  --max <n>         fix attempts, default 3      --with <cmd>     agent command; {brief} is the brief's path

Exit code: 0 clean, 1 a user silently lost or an invariant broke, 2 the race could not be run.`

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
  : config.races.map(r => r.users?.length !== 2 ? `race "${r.name}" needs exactly two users` : r.users.find(u => !u.do || !u.kept) ? `race "${r.name}": every user needs "do" and "kept"` : null).find(Boolean)
if (problem) { console.error(`${flags.config}: ${problem}`); process.exit(2) }
const races = config.races.filter(r => !name || r.name === name)
if (!races.length) { console.error(`No race called "${name}" in ${flags.config}`); process.exit(2) }
const orders = flags.orders ? flags.orders.split(',') : ORDERS
const bad = orders.find(o => !ORDERS.includes(o))
if (bad) { console.error(`Unknown order "${bad}". Use: ${ORDERS.join(', ')}`); process.exit(2) }
const emit = flags.agent ? e => console.log(JSON.stringify(e)) : printEvent
const app = appControl(config.app)
// The app runs in its own process group, so Ctrl-C would otherwise leave it running.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.stop(); process.exit(130) })

// Every order of every race, with the app reset and restarted before each one.
async function raceAll() {
  const results = []
  for (const race of races) for (const order of orders) {
    await app.restart()
    const slug = race.name.replace(/\W+/g, '-').toLowerCase()
    results.push(await runRace(race, { app: config.app, order, headless: !flags.headed, out: join('.deadheat', slug), emit, ports: config.ports, chromePorts: config.chromePorts }))
  }
  const report = writeReport(results, '.deadheat')
  if (flags.agent) console.log(JSON.stringify({ event: 'report', report, results: results.map(({ timeline, ...r }) => r) }))
  else printResult(results, report)
  return results
}

const code = results => results.some(r => r.verdict === 'error' || r.verdict === 'no-race') ? 2 : results.every(r => r.verdict === 'clean') ? 0 : 1
let exit = 2
try {
  if (command === 'race') exit = code(await raceAll())
  else if (command === 'fix') exit = await fix({ raceAll, code, configPath, command: flags.with || config.agent, max: Number(flags.max), cwd: config.app.cwd, emit })
  else console.error(HELP)
} catch (error) { console.error(`deadheat: ${error.message}`) } finally { app.stop() }
process.exit(exit)
