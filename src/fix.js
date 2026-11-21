// The loop with a coding agent: race, hand over the failure, let the agent change the app, race again.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { explain } from './report.js'

export function brief(results, attempt) {
  const failed = results.filter(r => r.verdict !== 'clean')
  return [`# Dead Heat brief, attempt ${attempt}`, '',
    'Two real users acted at the same time in real browsers. Their save requests were frozen at a proxy and released in the order shown.',
    'Kane CLI then checked, after a reload, whether each user\'s work was still there. These orders failed:', '',
    ...failed.flatMap(r => [`## ${r.race} · ${r.order} · ${r.verdict}`, '', explain(r), '', 'Frozen requests:',
      ...r.timeline.filter(e => e.event === 'held').map(e => `- ${e.lane}: ${e.method} ${e.path}`),
      ...r.users.filter(u => u.keptSummary).map(u => `- Kane CLI on ${u.name}'s screen after reload: ${u.keptSummary.replace(/\n/g, ' ')}`), '']),
    'Fix the server so that a user is never told yes for work the app does not keep: make the check and the write one atomic step,',
    'or reject the stale write and tell that user. Change the application only. Do not edit deadheat.json or weaken its checks.', ''].join('\n')
}

export async function fix({ raceAll, code, configPath, command, max, cwd = process.cwd(), emit }) {
  if (!command) throw new Error('No agent command. Use --with "your-agent {brief}" or set "agent" in deadheat.json')
  const races = readFileSync(configPath, 'utf8')
  for (let attempt = 1; ; attempt++) {
    const results = await raceAll()
    const exit = code(results)
    if (exit !== 1 || attempt > max) return exit
    const path = resolve('.deadheat', `brief-${attempt}.md`)
    writeFileSync(path, brief(results, attempt))
    emit({ event: 'agent', attempt, brief: path, t: 0 })
    console.error(`\nHanding ${path} to the agent (attempt ${attempt} of ${max})`)
    execSync(command.includes('{brief}') ? command.replaceAll('{brief}', path) : `${command} < ${path}`, { cwd, stdio: ['inherit', process.stderr, process.stderr], env: { ...process.env, DEADHEAT_BRIEF: path } })
    // The agent must fix the app, not the test.
    if (readFileSync(configPath, 'utf8') !== races) { writeFileSync(configPath, races); throw new Error('The agent edited the race file. It was restored and the run stopped.') }
  }
}
