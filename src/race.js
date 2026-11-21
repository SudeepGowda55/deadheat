// One race: two users read, both writes are frozen, they are released in a chosen order, and Kane CLI
// then checks what each user was told against what the app actually kept.
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchChrome, screenshot } from './browser.js'
import { kaneRun } from './kane.js'
import { startProxy } from './proxy.js'

export const ORDERS = ['together', 'first-then-second', 'second-then-first']

// "POST /book" or "PUT /api/tasks/*". With no pattern, the first request that is not a read is held.
export function matcher(pattern) {
  if (!pattern) return req => !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  const [method, path] = pattern.trim().split(/\s+/)
  const shape = new RegExp('^' + path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^?]*') + '(\\?.*)?$')
  return req => req.method === method.toUpperCase() && shape.test(req.url)
}

// kept: their work is there. refused: it is not, and the app told them so. lost: it is not, and the app said nothing.
export const outcome = ({ kept, refused }) => kept ? 'kept' : refused ? 'refused' : 'lost'

export function verdict({ held, users, invariant, errors }) {
  if (errors.length) return 'error'
  if (!held) return 'no-race'
  if (users.some(u => u.outcome === 'lost')) return 'lost'
  return invariant === false ? 'broken' : 'clean'
}

export function appControl({ url, start, reset, cwd = process.cwd() }) {
  let child = null
  const stop = () => { if (child) { try { process.kill(-child.pid) } catch {} child = null } }
  return {
    stop,
    async restart() {
      stop()
      if (reset) execSync(reset, { cwd, stdio: 'ignore' })
      if (!start) return
      child = spawn(start, { cwd, shell: true, detached: true, stdio: 'ignore' })
      for (let i = 0; i < 240; i++) {
        if (await fetch(url, { redirect: 'manual' }).then(() => true, () => false)) return
        await new Promise(r => setTimeout(r, 500))
      }
      throw new Error(`The app did not answer on ${url} within two minutes of "${start}"`)
    },
  }
}

const said = value => /^\s*(yes|true)\b/i.test(String(value ?? ''))

export async function runRace(race, { app, order = 'together', ports = [4801, 4802], chromePorts = [9341, 9342], headless = true, out, emit = () => {},
  drive = kaneRun, launch = launchChrome, shoot = screenshot } = {}) {
  if (race.users?.length !== 2) throw new Error(`Race "${race.name}" needs exactly two users`)
  const t0 = Date.now(), timeline = [], errors = []
  let lanes = []
  const log = event => {
    const e = { t: (Date.now() - t0) / 1000, ...event }
    timeline.push(e); emit(e)
  }
  if (out) mkdirSync(out, { recursive: true })
  const names = race.users.map(u => u.name)
  const matches = matcher(race.hold)
  let armed = false
  const proxy = startProxy({ upstream: app.url, lanes: names.map((name, i) => ({ name, port: ports[i] })), hold: req => armed && matches(req),
    order: order === 'together' ? 'together' : order === 'first-then-second' ? names : [...names].reverse(), log,
    beforeRelease: () => Promise.race([Promise.all(lanes.map(lane => picture(lane, 'frozen'))), new Promise(r => setTimeout(r, 1500))]) })
  const chromes = await Promise.all(chromePorts.map(port => launch(port, { headless })))
  lanes = race.users.map((user, i) => ({ user, origin: `http://127.0.0.1:${ports[i]}`, chrome: chromes[i] }))
  const step = lane => s => log({ event: 'step', lane: lane.user.name, status: s.status, remark: s.remark })
  const shots = []
  const picture = async (lane, tag) => {
    const t = (Date.now() - t0) / 1000
    const file = out ? await shoot(lane.chrome.endpoint, join(out, `${order}-${lane.user.name}-${tag}.jpg`)).catch(() => null) : null
    if (file) shots.push({ lane: lane.user.name, tag, t, file })
  }
  const run = async (lane, phase, objective, startUrl) => {
    log({ event: 'kane', lane: lane.user.name, phase, objective })
    const r = await drive(objective, { url: startUrl, cdpEndpoint: lane.chrome.endpoint, onStep: step(lane) })
    log({ event: 'kane_end', lane: lane.user.name, phase, status: r.status, summary: r.one_liner, credits: r.credits_consumed, link: r.test_url })
    if (r.status === 'error' || r.status === 'timeout') errors.push(`${lane.user.name} ${phase}: ${r.reason || r.stderr || r.status}`)
    return r
  }
  try {
    // 1. Both users get to the point where they have read the old state.
    await Promise.all(lanes.map(lane => lane.user.setup ? run(lane, 'setup', lane.user.setup, lane.origin + (race.path || '/')) : null))
    // 2. Both act. Each save is frozen until the other one has arrived.
    armed = true
    const frozen = proxy.released.then(async r => { await Promise.all(lanes.map(lane => picture(lane, 'released'))); return r })
    const acts = await Promise.all(lanes.map(lane => run(lane, 'do',
      `${lane.user.do} Then store as 'told' the exact message the page shows about the result, or the word nothing if it shows none.` +
      (lane.user.refused ? ` Also store as 'refused' the word yes if this is true, otherwise the word no: ${lane.user.refused}` : ''),
      lane.user.setup ? undefined : lane.origin + (race.path || '/'))))
    const held = proxy.heldLanes().length === 2 && (await Promise.race([frozen, new Promise(r => setTimeout(r, 1000, null))]))?.reason === 'all lanes held'
    await Promise.all(lanes.map(lane => picture(lane, 'told')))
    // 3. After a reload, is each user's work really there?
    const checks = held ? await Promise.all(lanes.map(lane => run(lane, 'kept', `Verify this, and fail if it is not true: ${lane.user.kept}`, lane.origin + (race.path || '/')))) : []
    await Promise.all(lanes.map(lane => picture(lane, 'kept')))
    const whole = held && race.invariant ? await run(lanes[0], 'invariant', `Verify this, and fail if it is not true: ${race.invariant}`, lanes[0].origin + (race.path || '/')) : null
    const users = lanes.map((lane, i) => {
      const state = acts[i].final_state || {}
      const u = { name: lane.user.name, told: state.told ?? null, kept: checks[i]?.status === 'passed', refused: said(state.refused),
        links: [acts[i].test_url, checks[i]?.test_url].filter(Boolean), keptSummary: checks[i]?.summary ?? null }
      return { ...u, outcome: held ? outcome(u) : null }
    })
    const invariant = whole ? whole.status === 'passed' : null
    const credits = timeline.reduce((sum, e) => sum + (e.event === 'kane_end' ? Number(e.credits) || 0 : 0), 0)
    const result = { race: race.name, order, verdict: verdict({ held, users, invariant, errors }), held: Boolean(held), users, invariant,
      invariantSummary: whole?.summary ?? null, errors, credits, seconds: (Date.now() - t0) / 1000, timeline, shots }
    log({ event: 'verdict', order, verdict: result.verdict })
    return result
  } finally {
    chromes.forEach(c => c.close())
    await proxy.close()
  }
}
