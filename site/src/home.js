import { boot, freezeRelease, ScrollTrigger, reduced } from './main.js'
import runs from './data/runs.json'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const ORDER_NAME = { together: 'released together', 'first-then-second': 'Manvith, then Sudeep', 'second-then-first': 'Sudeep, then Manvith' }
const lane = name => name === 'Manvith' ? 0 : 1

// Every simulated race takes its shape from a real one: who reached the proxy first, the release order, the verdicts.
const spec = r => ({
  order: r.order,
  first: lane(r.held[0].lane),
  release: r.release.together ? 'together' : r.release.order.map(lane),
  outcome: r.users.map(u => u.outcome),
  answered: r.users.map(u => u.answered),
})
const specs = {
  auto: runs.released.results.map(spec),
  story: spec(runs.released.results[0]),
  fixed: spec(runs.fixed.results[0]),
}

// real facts quoted in the chapters
const together = runs.released.results[0]
const sudeepHeld = together.held.find(h => h.lane === 'Sudeep').t
$('[data-fact=waited]').textContent = `${(together.release.t - sudeepHeld).toFixed(1)} s`
$('[data-fact=gap]').textContent = `${Math.round((Math.max(...together.answered.map(a => a.t)) - together.release.t) * 1000)} ms`
$('[data-fact=pathA]').textContent = `frozen: ${together.held[0].method} ${together.held[0].path}`

boot()

const stage = $('.stage')
const canvas = $('.world')
const tags = Object.fromEntries($$('[data-at]').map(el => [el.dataset.at, el]))
const chapters = $$('.chapter')
const printOrder = $('.print-order')
let world = null, s = 0

// hero headline: the two halves race to the line from opposite sides and are released together
const heroHead = () => freezeRelease([{ el: $('.hh-l'), dir: 1 }, { el: $('.hh-r'), dir: -1 }, { el: $('.hh-q'), dir: -1 }], { delay: .25 })

const VERDICT = { lost: 'silently lost', kept: 'kept', refused: 'refused' }
function hud({ race, fs, screen }) {
  const narrow = innerWidth < 700
  // align the split headline with the 3D line once, on wide screens
  if (fs.specIndex >= 0 && screen.line && !narrow) {
    const x = Math.round(screen.line[0])
    if (Math.abs(x - (hud.x ?? -99)) > .5) { hud.x = x; stage.style.setProperty('--line-x', `${x}px`); stage.style.setProperty('--gate-y', `${Math.round(screen.proxy[1])}px`) }
  }
  const sp = fs.spec
  for (const [key, el] of Object.entries(tags)) {
    const p = screen[key]
    if (!p) continue
    el.style.transform = `translate3d(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px, 0)`
  }
  race.lanes.forEach((l, i) => {
    const tag = tags[i ? 'pkB' : 'pkA'], v = tags[i ? 'vB' : 'vA']
    const text = l.alpha < .3 || l.landed ? '' : l.frozen ? 'save · frozen' : l.leaving ? 'save · released' : 'save'
    if (tag.textContent !== text) tag.textContent = text
    tag.classList.toggle('on', !!text)
    tag.classList.toggle('frozen', !!l.frozen)
    const out = l.landed && l.alpha > .3 ? l.outcome : ''
    const vt = out ? `${VERDICT[out]}${out === 'refused' ? ' · 409' : ''}` : ''
    if (v.dataset.v !== out) { v.dataset.v = out; v.className = `verdict ${out}`; v.innerHTML = out ? `${vt}<small>${i ? 'Sudeep' : 'Manvith'} · answered ${sp.answered[i]}${out === 'lost' ? ', no warning' : ''}</small>` : '' }
    v.classList.toggle('on', !!out)
  })
  const label = fs.specIndex === -2 ? 'released together · after the fix' : `${ORDER_NAME[sp.order]} · Kanboard 1.2.58`
  if (printOrder.textContent !== label) printOrder.textContent = label
}

function bandRect() {
  const w = $('.print-window').getBoundingClientRect(), c = canvas.getBoundingClientRect()
  return { x: w.left - c.left + 1.5, y: w.top - c.top + 1.5, w: w.width - 3, h: w.height - 3 }
}

// the 3D world loads in parallel with the rest of the page and fades in after its first frame
import('./scene.js').then(({ createWorld }) => {
  try {
    world = createWorld(canvas, { specs, reduced })
  } catch (err) {
    stage.classList.add('no-gl'); console.warn('WebGL unavailable', err); heroHead(); return
  }
  world.setBand(bandRect())
  world.onFrame(hud)
  let first = true
  world.onFrame(() => { if (first) { first = false; stage.classList.add('ready'); heroHead() } })
  addEventListener('resize', () => { world.resize(); world.setBand(bandRect()); hud.x = null })
  new IntersectionObserver(([e]) => world.setVisible(e.isIntersecting)).observe(stage)
  addEventListener('pointermove', e => world.setPointer(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5), { passive: true })
})

// the pinned story: hero, then five chapters, all scrubbed by one trigger tweening one number
let active = -1
ScrollTrigger.create({
  trigger: '.stage-wrap', start: 'top top', end: 'bottom bottom', scrub: true,
  onUpdate: self => {
    s = self.progress * 6
    stage.style.setProperty('--hero-out', Math.min(1, Math.max(0, (s - .25) / .55)).toFixed(3))
    stage.classList.toggle('in-story', s >= .8)
    if (world) {
      world.setMode(s >= .8 ? 'story' : 'auto')
      world.setStory(Math.max(1, s))
    }
    const ch = s < 1 ? -1 : Math.min(4, Math.floor(s - 1))
    if (ch !== active) {
      chapters.forEach((c, i) => c.classList.toggle('on', i === ch))
      if (ch >= 0) freezeRelease([{ el: chapters[ch].querySelector('h2'), dir: ch % 2 ? -1 : 1 }])
      active = ch
    }
  },
})

// the rounds grid: a red line sweeps down with the scroll and each order flips to its real state as it passes
const cells = $$('.gr-row span')
ScrollTrigger.create({
  trigger: '.grid-rounds', start: 'top 75%', end: 'bottom 45%', scrub: true,
  onUpdate: self => {
    const p = self.progress
    $('.sweep').style.transform = `translateY(${(p * 100).toFixed(1)}%)`
    cells.forEach((c, i) => c.classList.toggle('set', p > (i + 1) / (cells.length + 1)))
    $$('.gr-row').forEach((r, i) => r.classList.toggle('done', p > (i * 3 + 3) / (cells.length + 1)))
  },
})
if (reduced) { cells.forEach(c => c.classList.add('set')); $$('.gr-row').forEach(r => r.classList.add('done')) }

