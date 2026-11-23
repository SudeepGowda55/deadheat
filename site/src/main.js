// Shared by every page: smooth scroll, the dot-gain page transition, the two-racer cursor, freeze-and-release
// headlines, magnetic buttons, release presses, reveals and copy buttons.
import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)
export { gsap, ScrollTrigger }

export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches
const $$ = (s, r = document) => [...r.querySelectorAll(s)]

// ---- smooth scroll -------------------------------------------------------
export const lenis = reduced ? null : new Lenis({ autoRaf: false, lerp: .11 })
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add(t => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  window.__lenis = lenis
}

// the nav gets its rule once the page moves under it
const navEl = document.querySelector('.nav')
const onScroll = () => navEl?.classList.toggle('scrolled', scrollY > 8)
addEventListener('scroll', onScroll, { passive: true }); onScroll()

// ---- page transition: newsprint dot gain ---------------------------------
// Leaving: halftone dots swell from the click point until the page is solid ink, and the red line marks the instant.
// Arriving: the dots shrink back to nothing from the same point.
const veil = document.querySelector('.veil')
const vc = veil?.querySelector('canvas')
const ctx = vc?.getContext('2d')
function drawVeil(p, ox, oy) {
  const w = innerWidth, h = innerHeight, d = Math.min(devicePixelRatio, 2)
  if (vc.width !== w * d) { vc.width = w * d; vc.height = h * d }
  ctx.setTransform(d, 0, 0, d, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#101113'
  const cell = 22, far = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy))
  ctx.beginPath()
  for (let y = cell / 2; y < h + cell; y += cell) for (let x = cell / 2; x < w + cell; x += cell) {
    const local = Math.min(1, Math.max(0, p * 1.5 - Math.hypot(x - ox, y - oy) / far * .5))
    if (local <= 0) continue
    const r = local * cell * .74
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2)
  }
  ctx.fill()
}
const label = veil?.querySelector('.veil-label'), vline = veil?.querySelector('.veil-line')
function go(href, name, x, y) {
  try { sessionStorage.setItem('dh-t', JSON.stringify({ x: x / innerWidth, y: y / innerHeight, name })) } catch {}
  if (reduced) { location.href = href; return }
  veil.classList.add('on')
  label.textContent = name
  vline.style.left = `${x}px`
  const o = { p: 0 }
  gsap.timeline({ onComplete: () => { location.href = href } })
    .to(o, { p: 1, duration: .62, ease: 'power2.in', onUpdate: () => drawVeil(o.p, x, y) })
    .fromTo(vline, { scaleY: 0 }, { scaleY: 1, duration: .22, ease: 'power3.out' }, .42)
    .fromTo(label, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: .25, ease: 'power3.out' }, .45)
    .to({}, { duration: .1 })
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]')
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return
  const url = new URL(a.href, location.href)
  if (url.origin !== location.origin || url.pathname.startsWith('/reports/')) return
  if (url.pathname === location.pathname) { if (url.hash) return; e.preventDefault(); lenis ? lenis.scrollTo(0) : scrollTo(0, 0); return }
  e.preventDefault()
  const name = a.dataset.name || ({ '/': 'Story', '/how/': 'How it works', '/proof/': 'Proof', '/install/': 'Install' })[url.pathname] || a.textContent.trim()
  go(url.pathname + url.hash, name, e.clientX || innerWidth / 2, e.clientY || innerHeight / 2)
})
function arrive() {
  let info = null
  try { info = JSON.parse(sessionStorage.getItem('dh-t')); sessionStorage.removeItem('dh-t') } catch {}
  if (!info || !veil) return document.documentElement.classList.remove('t-in')
  const x = info.x * innerWidth, y = info.y * innerHeight
  veil.classList.add('on')
  document.documentElement.classList.remove('t-in')
  label.textContent = info.name
  vline.style.left = `${x}px`
  if (reduced) { veil.classList.remove('on'); return }
  drawVeil(1, x, y)
  const o = { p: 1 }
  gsap.timeline({ onComplete: () => veil.classList.remove('on') })
    .set(label, { opacity: 1 }).set(vline, { scaleY: 1 })
    .to(label, { opacity: 0, x: 30, duration: .25, ease: 'power2.in' }, .12)
    .to(vline, { scaleY: 0, transformOrigin: '50% 100%', duration: .3, ease: 'power2.in' }, .15)
    .to(o, { p: 0, duration: .7, ease: 'power2.out', onUpdate: () => drawVeil(o.p, x, y) }, .2)
}
arrive()
addEventListener('pageshow', e => { if (e.persisted) { veil?.classList.remove('on'); document.documentElement.classList.remove('t-in') } })

// ---- cursor: two racers chasing one line ---------------------------------
// The red hairline is the pointer. Manvith (ink) and Sudeep (white) chase it at different speeds and only meet
// it when the pointer rests: a dead heat. Over a control both freeze against the line; a press releases them.
if (finePointer && !reduced) {
  const cur = document.querySelector('.cursor')
  const [a, b, line] = ['.c-a', '.c-b', '.c-line'].map(s => cur.querySelector(s))
  const p = { x: innerWidth / 2, y: innerHeight / 2 }, A = { ...p }, B = { ...p }
  let hover = null, pressT = 0
  document.documentElement.classList.add('has-cursor')
  addEventListener('pointermove', e => { p.x = e.clientX; p.y = e.clientY; cur.classList.add('live') }, { passive: true })
  document.addEventListener('pointerleave', () => cur.classList.remove('live'))
  addEventListener('pointerdown', () => { pressT = performance.now() })
  document.addEventListener('pointerover', e => { hover = e.target.closest('a, button, [role=tab], input, summary, .drag'); cur.classList.toggle('hover', !!hover) })
  gsap.ticker.add(() => {
    const since = (performance.now() - pressT) / 1000
    const burst = since < .45 ? Math.sin(since / .45 * Math.PI) * 26 : 0
    const gap = hover ? 9 : 0
    A.x += (p.x - gap - A.x) * .3; A.y += (p.y - 5 - A.y) * .3
    B.x += (p.x - gap - B.x) * .13; B.y += (p.y + 5 - B.y) * .13
    const tie = Math.abs(A.x - B.x) < 1.2 && Math.abs(p.x - gap - A.x) < 1.2
    a.style.transform = `translate3d(${A.x - 9 + burst}px, ${A.y - 4}px, 0)`
    b.style.transform = `translate3d(${B.x - 9 + burst * .8}px, ${B.y - 4}px, 0)`
    line.style.transform = `translate3d(${p.x - 1}px, ${p.y - 13}px, 0) scaleY(${hover ? 1.6 : tie ? 1.3 : 1})`
    cur.classList.toggle('tie', tie && !hover)
  })
}

// ---- headlines: freeze, then release -------------------------------------
// Words race in from their side, stop just short of their place and wait for the slowest one, like the first
// save waiting at the proxy. Then every word is released at the same instant and a red hairline marks it.
function split(el) {
  if (el.dataset.split) return $$('.w', el)
  el.dataset.split = '1'
  const words = []
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 3) {
      const frag = document.createDocumentFragment()
      node.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return
        if (/^\s+$/.test(part)) { frag.append(part); return }
        const w = document.createElement('span'); w.className = 'w'; w.textContent = part; frag.append(w); words.push(w)
      })
      node.replaceWith(frag)
    } else if (node.nodeType === 1) { node.classList.add('w'); words.push(node) }
  }
  return words
}
export function freezeRelease(groups, { delay = 0, onRelease } = {}) {
  // groups: [{ el, dir }]; dir 1 = arrives from the left, -1 = from the right; 0 = alternate per line
  const all = []
  for (const { el, dir } of groups) {
    const words = split(el)
    const tops = [...new Set(words.map(w => w.offsetTop))]
    words.forEach(w => { const line = tops.indexOf(w.offsetTop); all.push({ w, dir: dir || (line % 2 ? -1 : 1), line }) })
  }
  if (reduced || !all.length) { onRelease?.(); return }
  const tl = gsap.timeline({ delay })
  all.forEach(({ w, dir, line }, i) => {
    const far = (innerWidth * .35 + Math.random() * 120) * -dir
    gsap.set(w, { x: far, opacity: 0 })
    tl.to(w, { x: -dir * 14, opacity: 1, duration: .55 + Math.random() * .25, ease: 'power3.out' }, line * .09 + (i % 5) * .03)
  })
  const flash = groups[0].el.closest('[data-flash]') || groups[0].el
  tl.add(() => {
    onRelease?.()
    const l = document.createElement('i'); l.className = 'release-flash'; flash.append(l)
    gsap.fromTo(l, { scaleY: 0, opacity: 1 }, { scaleY: 1, duration: .16, ease: 'power4.out', onComplete: () => gsap.to(l, { opacity: 0, duration: .5, delay: .25, onComplete: () => l.remove() }) })
  }, '+=0.22')
  tl.to(all.map(a => a.w), { x: 0, duration: .13, ease: 'power3.in' }, '<')
}
// every heading marked data-head plays once when it comes into view (the hero runs its own)
function headings() {
  for (const el of $$('[data-head]')) {
    if (el.closest('.hero') || el.closest('.chapter')) continue
    if (!reduced) split(el).forEach(w => gsap.set(w, { opacity: 0 }))
    ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => freezeRelease([{ el, dir: 0 }]) })
  }
}

// ---- buttons: magnetic, and a press is a release -------------------------
function buttons() {
  for (const el of $$('.btn, .gh, .chip, .copy')) {
    if (finePointer && !reduced) {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect()
        gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * .22, y: (e.clientY - r.top - r.height / 2) * .3, duration: .35, ease: 'power3.out' })
      })
      el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: .6, ease: 'elastic.out(1, .45)' }))
    }
    el.addEventListener('pointerdown', e => {
      const r = el.getBoundingClientRect()
      const s = document.createElement('i'); s.className = 'press'; s.style.left = `${e.clientX - r.left}px`
      el.append(s); setTimeout(() => s.remove(), 600)
    })
  }
}

// ---- reveals and copy buttons --------------------------------------------
function reveals() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -8% 0px' })
  $$('[data-rise]').forEach(el => io.observe(el))
}
function copies() {
  for (const b of $$('[data-copy]')) b.addEventListener('click', async () => {
    const text = b.dataset.copy || b.closest('.cmd')?.querySelector('code')?.textContent || ''
    try { await navigator.clipboard.writeText(text); b.dataset.state = 'copied' } catch { b.dataset.state = 'press ctrl c' }
    b.querySelector('span').textContent = b.dataset.state === 'copied' ? 'copied' : 'select and copy'
    setTimeout(() => { b.querySelector('span').textContent = 'copy'; delete b.dataset.state }, 1600)
  })
}

export function boot() {
  headings(); buttons(); reveals(); copies()
  addEventListener('load', () => ScrollTrigger.refresh())
}
