import { boot, gsap, reduced } from './main.js'
import { diffRows } from './code.js'
import diff from './data/agent-fix.diff?raw'

// the patch, read from the repository at build time
document.querySelector('.diff code').innerHTML = diffRows(diff)
const lines = diff.split('\n')
const add = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length, del = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length
const files = lines.filter(l => l.startsWith('diff --git')).length
document.querySelector('.diff-stat').textContent = `${files} files · +${add} −${del}`
boot()

// before and after: drag the red line
const box = document.querySelector('.compare'), top = box.querySelector('.compare-top'), line = box.querySelector('.compare-line')
let pos = 50
const set = p => {
  pos = Math.min(100, Math.max(0, p))
  top.style.clipPath = `inset(0 ${100 - pos}% 0 0)`
  line.style.left = `${pos}%`
  line.setAttribute('aria-valuenow', String(Math.round(pos)))
}
const fromEvent = e => { const r = box.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 100) }
box.addEventListener('pointerdown', e => { box.setPointerCapture(e.pointerId); fromEvent(e); box.classList.add('dragging') })
box.addEventListener('pointermove', e => { if (box.classList.contains('dragging')) fromEvent(e) })
box.addEventListener('pointerup', () => box.classList.remove('dragging'))
line.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') set(pos - 4); if (e.key === 'ArrowRight') set(pos + 4) })
set(50)
// a first sweep shows that it moves
if (!reduced) {
  const o = { p: 50 }
  new IntersectionObserver(([e], io) => { if (!e.isIntersecting) return; io.disconnect()
    gsap.timeline().to(o, { p: 22, duration: .9, ease: 'power2.inOut', onUpdate: () => set(o.p) }).to(o, { p: 64, duration: 1.1, ease: 'power2.inOut', onUpdate: () => set(o.p) }).to(o, { p: 50, duration: .7, ease: 'power2.out', onUpdate: () => set(o.p) })
  }, { threshold: .5 }).observe(box)
}

// the live reports
const frame = document.querySelector('.viewer iframe'), open = document.querySelector('.viewer-open')
for (const b of document.querySelectorAll('[data-src]')) b.addEventListener('click', () => {
  for (const o of b.parentElement.children) o.setAttribute('aria-selected', String(o === b))
  frame.src = b.dataset.src; open.href = b.dataset.src
  frame.title = b.dataset.src.includes('fixed') ? 'Dead Heat report for Kanboard after the fix' : 'Dead Heat report for Kanboard 1.2.58'
})
