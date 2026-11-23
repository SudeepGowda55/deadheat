import { boot, gsap, ScrollTrigger, reduced } from './main.js'
import { highlight } from './code.js'
import runs from './data/runs.json'
import race from './data/kanboard-race.json?raw'

document.querySelector('[data-json]').innerHTML = highlight(race.trim())
boot()

// ---- the replay: real timestamps from the two Kanboard reports -------------
const NS = 'http://www.w3.org/2000/svg'
const svg = document.querySelector('.replay-svg')
const verdicts = document.querySelector('.replay-verdicts')
const ORDER = { together: 'released together', 'first-then-second': 'Manvith, then Sudeep', 'second-then-first': 'Sudeep, then Manvith' }
const WORDS = { kept: 'kept', refused: 'refused, and told so', lost: 'SILENTLY LOST', crashed: 'not saved: the app answered with a server error' }
const LABEL = { kept: 'kept', refused: 'refused', lost: 'silently lost', crashed: 'crashed' }
// the same sentence the CLI prints for each user (src/report.js explain)
const said = u => u.told ? `was told "${u.told}"` : u.answered ? `saw no warning (the app answered ${u.answered} to the save)` : 'saw no message'
const explain = u => u.outcome === 'refused' && !u.told ? `${u.name}'s save was refused by the app (it answered ${u.answered}), so their work was not saved.`
  : u.outcome === 'kept' && !u.told ? `${u.name}'s save went through (the app answered ${u.answered}) and their work was kept.`
  : `${u.name} ${said(u)} and their work was ${WORDS[u.outcome]}.`

let run = 'released', order = 'together'
const el = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; svg.append(n); return n }

function draw() {
  const r = runs[run].results.find(x => x.order === order)
  svg.replaceChildren()
  const times = [...r.held.map(h => h.t), r.release.t, ...r.answered.map(a => a.t)]
  const lo = Math.min(...times), hi = Math.max(...times), pad = Math.max(.8, (hi - lo) * .18)
  const t0 = lo - pad * 1.6, t1 = hi + pad
  const narrow = innerWidth < 700, W = narrow ? 520 : 1000
  svg.setAttribute('viewBox', `0 0 ${W} 220`)
  const X = t => (narrow ? 90 : 130) + (t - t0) / (t1 - t0) * (W - (narrow ? 200 : 400))
  const rows = { Manvith: 62, Sudeep: 132 }
  // axis
  const step = t1 - t0 > 8 ? 2 : t1 - t0 > 3 ? 1 : .5
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    el('line', { x1: X(t), x2: X(t), y1: 182, y2: 188, class: 'ax' })
    if (!narrow || Math.round(t / step) % 2 === 0) el('text', { x: X(t), y: 205, class: 'axt' }, `${+t.toFixed(1)} s`)
  }
  el('line', { x1: X(t0), x2: X(t1), y1: 182, y2: 182, class: 'ax' })
  const anim = []
  for (const [name, y] of Object.entries(rows)) {
    const h = r.held.find(x => x.lane === name), a = r.answered.find(x => x.lane === name), u = r.users.find(x => x.name === name)
    el('text', { x: 0, y: y + 5, class: 'who' }, name)
    el('line', { x1: X(t0), x2: X(h.t), y1: y, y2: y, class: 'way' })
    const bar = el('rect', { x: X(h.t), y: y - 12, width: Math.max(2, X(r.release.t) - X(h.t)), height: 24, class: 'frozen' })
    anim.push(bar)
    const held = r.release.t - h.t
    el('text', { x: X(h.t) - 8, y: y - 18, class: 'lbl end' }, `frozen ${held >= 1 ? held.toFixed(1) + ' s' : Math.round(held * 1000) + ' ms'}`)
    const ax = X(a.t) + 10
    el('line', { x1: X(r.release.t), x2: ax, y1: y, y2: y, class: 'after' })
    el('rect', { x: ax, y: y - 12, width: 44, height: 24, class: `ans ans-${u.outcome}` })
    el('text', { x: ax + 22, y: y + 5, class: `anst ans-${u.outcome}` }, String(a.status))
    el('text', { x: ax + 54, y: y + 5, class: 'lbl' }, `${narrow ? '+' : 'answered '}${Math.round((a.t - r.release.t) * 1000)} ms${narrow ? '' : ' after the release'}`)
  }
  const rl = el('line', { x1: X(r.release.t), x2: X(r.release.t), y1: 22, y2: 182, class: 'rel' })
  const relText = r.release.together ? 'released together' : `released ${r.release.order.join(', then ')}`
  el('text', { x: X(r.release.t) - 6, y: 20, class: 'relt' }, `${relText} · ${r.release.t.toFixed(1)} s`)
  svg.setAttribute('aria-label', `${run === 'released' ? 'Kanboard 1.2.58 as released' : 'Kanboard after the fix'}, ${ORDER[order]}: ${r.users.map(explain).join(' ')}`)
  verdicts.innerHTML = r.users.map(u => `<div class="rv rv-${u.outcome}"><em class="v ${u.outcome === 'lost' ? 'v-lost' : ''}">${LABEL[u.outcome]}</em><p>${explain(u)}</p></div>`).join('')
    + `<div class="rv-meta mono"><span>${r.verdict === 'clean' ? 'clean' : 'a user silently lost'}</span><span>${r.seconds.toFixed(0)} s</span><span>${r.credits.toFixed(0)} credits</span></div>`
  if (reduced) return
  gsap.from(anim, { attr: { width: 0 }, duration: .7, ease: 'power3.out', stagger: .08 })
  gsap.from(rl, { attr: { y2: 22 }, duration: .35, delay: .55, ease: 'power3.out' })
  gsap.from(verdicts.children, { y: 18, opacity: 0, duration: .45, delay: .75, stagger: .07, ease: 'power3.out' })
}
for (const b of document.querySelectorAll('[data-run], [data-order]')) b.addEventListener('click', () => {
  const key = b.dataset.run ? 'run' : 'order'
  if (key === 'run') run = b.dataset.run; else order = b.dataset.order
  for (const o of b.parentElement.children) o.setAttribute('aria-selected', String(o === b))
  draw()
})
draw()
let wasNarrow = innerWidth < 700
addEventListener('resize', () => { if ((innerWidth < 700) !== wasNarrow) { wasNarrow = !wasNarrow; draw() } })

// ---- lanes diagram: the saves travel, freeze at the line, and go on together --
if (!reduced) {
  const tl = gsap.timeline({ repeat: -1, repeatDelay: .6 })
  tl.fromTo('.pk-a', { x: -560 }, { x: 0, duration: 1.2, ease: 'power2.out' })
    .fromTo('.pk-b', { x: -560 }, { x: 0, duration: 2, ease: 'power2.out' }, 0)
    .to('.lanes .red', { attr: { 'stroke-width': 5 }, duration: .12, yoyo: true, repeat: 1 }, 2.5)
    .to(['.pk-a', '.pk-b'], { x: 420, opacity: 0, duration: .7, ease: 'power2.in' }, 2.5)
    .set(['.pk-a', '.pk-b'], { opacity: 1, x: -560 })
}

// ---- the fix loop: scrolling walks the run around the loop ----------------
ScrollTrigger.create({
  trigger: '.loop', start: 'top 80%', end: 'bottom 35%', scrub: true,
  onUpdate: self => {
    const p = self.progress, a = p * Math.PI * 2 - Math.PI / 2
    document.querySelector('.loop-run').style.strokeDashoffset = String(1 - p)
    const dot = document.querySelector('.loop-dot')
    dot.setAttribute('cx', 260 + Math.cos(a) * 200); dot.setAttribute('cy', 260 + Math.sin(a) * 200)
    document.querySelectorAll('.ls').forEach((s, i) => s.classList.toggle('on', p >= i / 4 - .02))
    document.querySelector('.loop-center').classList.toggle('on', p > .97)
  },
})
