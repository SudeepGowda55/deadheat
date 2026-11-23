// Copies the real Kanboard reports, screenshot and patch from the repository into the site, and extracts the
// facts the site shows (verdicts, what each user was told, freeze and release times) into src/data/runs.json.
// When the repository around the site is not there (a build that only sees `site/`), the committed copies are used.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const repo = new URL('../../', import.meta.url)
const site = new URL('../', import.meta.url)
const from = p => new URL(p, repo)

if (!existsSync(from('docs/kanboard-report.html'))) {
  console.log('sync: repository docs not found, using the committed copies')
  process.exit(0)
}

for (const f of ['kanboard-report.html', 'kanboard-fixed-report.html', 'kanboard-report.png'])
  copyFileSync(from(`docs/${f}`), new URL(`public/reports/${f}`, site))
copyFileSync(from('examples/kanboard/agent-fix.diff'), new URL('src/data/agent-fix.diff', site))
copyFileSync(from('examples/kanboard/deadheat.json'), new URL('src/data/kanboard-race.json', site))

const runs = {}
for (const [key, file] of [['released', 'kanboard-report.html'], ['fixed', 'kanboard-fixed-report.html']]) {
  const html = readFileSync(from(`docs/${file}`), 'utf8')
  const json = html.match(/const DATA = (\{"generated"[\s\S]*?\});\n/)
  if (!json) throw new Error(`sync: no report data in ${file}`)
  const data = JSON.parse(json[1])
  runs[key] = {
    generated: data.generated,
    results: data.results.map(r => ({
      order: r.order, verdict: r.verdict, seconds: r.seconds, credits: r.credits,
      users: r.users.map(u => ({ name: u.name, told: u.told, answered: u.answered, outcome: u.outcome })),
      held: r.timeline.filter(e => e.event === 'held').map(e => ({ t: e.t, lane: e.lane, method: e.method, path: e.path })),
      release: r.timeline.filter(e => e.event === 'release').map(e => ({ t: e.t, order: e.order, together: e.together }))[0] ?? null,
      answered: r.timeline.filter(e => e.event === 'answered').map(e => ({ t: e.t, lane: e.lane, status: e.status })),
    })),
  }
}
writeFileSync(new URL('src/data/runs.json', site), JSON.stringify(runs, null, 2) + '\n')
console.log('sync: reports, screenshot, patch and runs.json updated')
