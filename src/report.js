// What a person reads after a race: the terminal summary and a Markdown report next to the screenshots.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORDS = { kept: 'kept', refused: 'refused, and told so', lost: 'SILENTLY LOST' }
const HEAD = { clean: 'clean', lost: 'A USER SILENTLY LOST', broken: 'INVARIANT BROKEN', 'no-race': 'no race happened', error: 'could not run' }
const REPO = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).repository?.url ?? null
const time = t => `${t.toFixed(1).padStart(6)}s`

export function printEvent(e) {
  if (e.event === 'held') console.log(`${time(e.t)}  ■ ${e.lane}'s ${e.method} ${e.path} is frozen`)
  else if (e.event === 'release') console.log(`${time(e.t)}  ▶ released ${e.together ? 'together' : e.order.join(', then ')}${e.reason.startsWith('timeout') ? ` (${e.reason})` : ''}`)
  else if (e.event === 'kane') console.log(`${time(e.t)}  ${e.lane} · ${e.phase} · Kane CLI started`)
  else if (e.event === 'kane_end') console.log(`${time(e.t)}  ${e.lane} · ${e.phase} · ${e.status}${e.summary ? ` · ${e.summary}` : ''}`)
}

export function explain(r) {
  if (r.verdict === 'no-race') return 'Both saves were never frozen at the same time, so nothing was proven. Check the "hold" pattern and that each "do" really ends in a save.'
  if (r.verdict === 'error') return r.errors.join('; ')
  const lines = r.users.map(u => `${u.name} was told "${u.told ?? 'nothing'}" and their work was ${WORDS[u.outcome]}.`)
  if (r.invariant === false) lines.push(`The invariant did not hold: ${r.invariantSummary ?? ''}`.trim())
  return lines.join(' ')
}

export function printResult(results, report) {
  console.log('')
  for (const r of results) console.log(`${r.verdict === 'clean' ? '✓' : '✗'} ${r.race} · ${r.order} · ${HEAD[r.verdict]}\n    ${explain(r)}`)
  const credits = results.reduce((sum, r) => sum + r.credits, 0)
  console.log(`\n${results.filter(r => r.verdict === 'clean').length} of ${results.length} orders clean · ${credits.toFixed(0)} Kane credits · report: ${report}`)
}

export function writeReport(results, dir) {
  mkdirSync(dir, { recursive: true })
  const md = ['# Dead Heat report', '']
  for (const r of results) {
    md.push(`## ${r.race} · ${r.order}: ${HEAD[r.verdict]}`, '', explain(r), '')
    if (r.users.length) md.push('| User | Told | Work after reload | Kane CLI runs |', '|---|---|---|---|',
      ...r.users.map(u => `| ${u.name} | ${u.told ?? ''} | ${WORDS[u.outcome] ?? ''} | ${u.links.map((l, i) => `[${i ? 'check' : 'action'}](${l})`).join(' ')} |`), '')
    md.push('```', ...r.timeline.filter(e => ['held', 'release', 'kane_end'].includes(e.event)).map(e => `${time(e.t)}  ${e.event === 'held' ? `${e.lane} frozen at ${e.method} ${e.path}`
      : e.event === 'release' ? `released ${e.together ? 'together' : e.order.join(', then ')}` : `${e.lane} ${e.phase}: ${e.status}`}`), '```', '')
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(dir, 'report.md'), md.join('\n'))
  // One self-contained page: the screenshots travel inside it, so it can be attached to a pull request as is.
  const inline = results.map(r => ({ ...r, shots: (r.shots || []).map(({ file, ...s }) => ({ ...s, src: `data:image/jpeg;base64,${readFileSync(file).toString('base64')}` })) }))
  const data = JSON.stringify({ generated: new Date().toISOString(), repo: REPO, results: inline }).replace(/</g, '\\u003c')
  writeFileSync(join(dir, 'report.html'), readFileSync(new URL('./report.html', import.meta.url), 'utf8').replace(/\/\*DEADHEAT_DATA\*\/.*?\/\*END\*\//s, () => data))
  return join(dir, 'report.html')
}
