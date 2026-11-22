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
// A save the app answered with a server error was not lost silently: the user saw it fail. A 4xx answer is the
// app saying no, so it counts as refused, unless the page told the user the save had worked.
const claimsSuccess = told => /\b(success|saved|updated|confirmed|done)\b/i.test(told ?? '') && !/\bnot\b/i.test(told ?? '')
export const outcome = ({ kept, refused, answered, told }) => kept ? 'kept' : refused || (answered >= 400 && answered < 500 && !claimsSuccess(told)) ? 'refused' : answered >= 500 ? 'crashed' : 'lost'

export function verdict({ held, users, invariant, errors }) {
  if (errors.length) return 'error'
  if (!held) return 'no-race'
  if (users.some(u => u.outcome === 'lost')) return 'lost'
  if (users.some(u => u.outcome === 'crashed')) return 'crashed'
  return invariant === false ? 'broken' : 'clean'
}

export function appControl({ url, start, reset, cwd = process.cwd() }) {
  let child = null
  const stop = () => { if (child) { try { process.kill(-child.pid) } catch {} child = null } }
  const answers = () => fetch(url, { redirect: 'manual' }).then(() => true, () => false)
  const pause = ms => new Promise(r => setTimeout(r, ms))
  return {
    stop,
    async restart() {
      stop()
      if (reset) execSync(reset, { cwd, stdio: 'ignore' })
      if (!start) return
      // Racing an app Dead Heat did not start (or one that has not let go of its port yet) would test stale data.
      for (let i = 0; i < 40 && await answers(); i++) await pause(250)
      if (await answers()) throw new Error(`Something is already answering on ${url}. Stop it first: Dead Heat starts the app itself.`)
      child = spawn(start, { cwd, shell: true, detached: true, stdio: 'ignore' })
      let died = null
      child.once('exit', code => { died = code })
      for (let i = 0; i < 240; i++) {
        if (await answers()) return
        if (died !== null) throw new Error(`"${start}" exited with code ${died} before ${url} answered`)
        await pause(500)
      }
      throw new Error(`The app did not answer on ${url} within two minutes of "${start}"`)
    },
  }
}

const said = value => /^\s*(yes|true)\b/i.test(String(value ?? ''))

export async function runRace(race, { app, order = 'together', ports = [4801, 4802], chromePorts = [9341, 9342], headless = true, out, emit = () => {},
  drive = kaneRun, launch = launchChrome, shoot = screenshot } = {}) {
  if (race.users?.length !== 2) throw new Error(`Race "${race.name}" needs exactly two users`)
  if (!race.users[0].name || race.users[0].name === race.users[1].name) throw new Error(`Race "${race.name}": the two users need different names`)
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
  let chromes = []
  const step = lane => s => log({ event: 'step', lane: lane.user.name, status: s.status, remark: s.remark })
  const shots = []
  const picture = async (lane, tag) => {
    const t = (Date.now() - t0) / 1000
    const file = out ? await shoot(lane.chrome.endpoint, join(out, `${order}-${lane.user.name}-${tag}.jpg`)).catch(() => null) : null
    if (file) shots.push({ lane: lane.user.name, tag, t, file })
  }
  const run = async (lane, phase, objective, startUrl) => {
    log({ event: 'kane', lane: lane.user.name, phase, objective })
    let r = await drive(objective, { url: startUrl, cdpEndpoint: lane.chrome.endpoint, onStep: step(lane) })
    // Kane CLI's exit code 2 is its own trouble (Chrome, network), not the app's: try once more. Never for the
    // action itself, where a second attempt would be a second save.
    if (r.status === 'error' && phase !== 'do') r = await drive(objective, { url: startUrl, cdpEndpoint: lane.chrome.endpoint, onStep: step(lane) })
    log({ event: 'kane_end', lane: lane.user.name, phase, status: r.status, summary: r.one_liner, why: r.status === 'passed' ? undefined : r.reason || r.summary || r.stderr, credits: r.credits_consumed, link: r.test_url })
    // A user who could not even perform the action leaves nothing to judge.
    // The action is judged by the proxy instead (below): Kane CLI often calls it failed because the page has not
    // changed yet, which is exactly what a frozen save looks like.
    if (phase === 'do') return r
    if (r.status === 'error' || r.status === 'timeout' || (r.status === 'failed' && phase !== 'kept' && phase !== 'invariant')) errors.push(`${lane.user.name} ${phase}: ${r.reason || r.stderr || r.status}`)
    // Without Kane CLI's answer there is nothing to say about what the user was told.
    else if (phase === 'read' && !r.final_state) errors.push(`${lane.user.name} read: Kane CLI returned no answer`)
    return r
  }
  try {
    await proxy.ready
    // One Chrome per user. If one fails to start, the one that did is still closed below.
    const launched = await Promise.allSettled(chromePorts.map(port => launch(port, { headless })))
    chromes = launched.filter(l => l.status === 'fulfilled').map(l => l.value)
    const failed = launched.find(l => l.status === 'rejected')
    if (failed) throw failed.reason
    lanes = race.users.map((user, i) => ({ user, origin: `http://127.0.0.1:${ports[i]}`, chrome: chromes[i] }))
    // 1. Both users get to the point where they have read the old state.
    await Promise.all(lanes.map(lane => lane.user.setup ? run(lane, 'setup', lane.user.setup, lane.origin + (race.path || '/')) : null))
    // A user who could not even reach the starting point (for example their Chrome died) leaves nothing to race.
    if (errors.length) {
      log({ event: 'verdict', order, verdict: 'error' })
      return { race: race.name, order, verdict: 'error', held: false, users: race.users.map(u => ({ name: u.name, told: null, answered: null, kept: false, refused: false, links: [null, null], keptSummary: null, outcome: null })),
        invariant: null, invariantSummary: null, errors, credits: timeline.reduce((sum, e) => sum + (e.event === 'kane_end' ? Number(e.credits) || 0 : 0), 0), seconds: (Date.now() - t0) / 1000, timeline, shots }
    }
    // 2. Both act. Each save is frozen until the other one has arrived.
    armed = true
    const frozen = proxy.released.then(async r => { await Promise.all(lanes.map(lane => picture(lane, 'released'))); return r })
    const acts = await Promise.all(lanes.map(lane => run(lane, 'do',
      `${lane.user.do} Do this once: do not repeat the action or try again, even if the result looks wrong.`,
      lane.user.setup ? undefined : lane.origin + (race.path || '/'))))
    // A user acted if their save reached the proxy, whatever Kane CLI made of the page afterwards.
    acts.forEach((a, i) => { if (!timeline.some(e => e.event === 'held' && e.lane === names[i])) errors.push(`${names[i]} do: the save never reached the app (${a.reason || a.stderr || a.status})`) })
    const released = await Promise.race([frozen, new Promise(r => setTimeout(r, 1000, null))])
    // A race happened only if both saves were frozen together and both went out.
    const held = released?.reason === 'all lanes held' && released.order.length === 2
    // What each user was told is read only once the app has answered both saves; read earlier, the page
    // may still be waiting on its frozen request and show nothing.
    for (let i = 0; i < 40 && held && !names.every(n => timeline.some(e => e.event === 'answered' && e.lane === n)); i++) await new Promise(r => setTimeout(r, 250))
    await new Promise(r => setTimeout(r, 1500)) // let the page draw the answer
    await Promise.all(lanes.map(lane => picture(lane, 'told')))
    const reads = held ? await Promise.all(lanes.map(lane => run(lane, 'read',
      `Do not click, type, reload or navigate: read the page exactly as it is now, including small error text next to form fields. ` +
      `Store as 'told' the exact message the page shows about the result of the last save, or the word nothing if it shows none. Store as 'refused' the word yes if this is true, otherwise the word no: ${lane.user.refused}`))) : []
    // 3. After a reload, is each user's work really there?
    const look = 'Do not type, edit, save or submit anything; opening pages and following links to look is fine.'
    const checks = held ? await Promise.all(lanes.map(lane => run(lane, 'kept', `${look} Verify this, and fail if it is not true: ${lane.user.kept}`, lane.origin + (race.path || '/')))) : []
    if (held) await Promise.all(lanes.map(lane => picture(lane, 'kept')))
    const whole = held && race.invariant ? await run(lanes[0], 'invariant', `${look} Verify this, and fail if it is not true: ${race.invariant}`, lanes[0].origin + (race.path || '/')) : null
    // A save that reaches the app after the release (a retry, or a check that "fixed" what it saw) can repair a
    // lost update before it is checked, so the order cannot be judged.
    const releasedAt = timeline.find(e => e.event === 'release')?.t ?? Infinity
    for (const name of names) if (timeline.some(e => e.event === 'pass' && e.lane === name && e.t > releasedAt && matches({ method: e.method, url: e.path })))
      errors.push(`${name} saved again after the race, so this order cannot be judged (Kane CLI repeated the action)`)
    const users = lanes.map((lane, i) => {
      const state = reads[i]?.final_state || {}
      const u = { name: lane.user.name, told: /^\s*nothing\s*$/i.test(state.told ?? '') ? null : state.told ?? null, answered: timeline.find(e => e.event === 'answered' && e.lane === lane.user.name)?.status ?? null, kept: checks[i]?.status === 'passed', refused: said(state.refused),
        links: [acts[i].test_url ?? null, checks[i]?.test_url ?? null], keptSummary: checks[i]?.summary ?? null } // links are always [action, check]
      return { ...u, outcome: held ? outcome(u) : null }
    })
    const invariant = whole ? whole.status === 'passed' : null
    const credits = timeline.reduce((sum, e) => sum + (e.event === 'kane_end' ? Number(e.credits) || 0 : 0), 0)
    const result = { race: race.name, order, verdict: verdict({ held, users, invariant, errors }), held: Boolean(held), users, invariant,
      invariantSummary: whole?.summary ?? null, errors, credits, seconds: (Date.now() - t0) / 1000, timeline, shots }
    log({ event: 'verdict', order, verdict: result.verdict })
    return result
  } finally {
    // Wait for each Chrome to exit: the next order reuses its debugging port.
    await Promise.all(chromes.map(c => c.close()))
    await proxy.close()
  }
}
