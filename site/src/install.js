import { boot, reduced } from './main.js'

// The README's example output for the desk race, typed out line by line when it comes into view.
const OUT = `✗ last desk · together · A USER SILENTLY LOST
    Manvith was told "Confirmed: the desk is yours, Manvith." and their work was kept.
    Sudeep was told "Confirmed: the desk is yours, Sudeep." and their work was SILENTLY LOST.
✓ last desk · first-then-second · clean
    Manvith was told "Confirmed: the desk is yours, Manvith." and their work was kept.
    Sudeep was told "Sorry, someone else just booked it." and their work was refused, and told so.
✓ last desk · second-then-first · clean`

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const paint = line => esc(line).replace(/(A USER SILENTLY LOST|SILENTLY LOST)/, '<mark class="t-lost">$1</mark>').replace(/^(✗|✓)/, m => `<b class="${m === '✗' ? 't-x' : 't-ok'}">${m}</b>`)
const code = document.querySelector('.term-out code')
const lines = OUT.split('\n')

function type() {
  if (reduced) { code.innerHTML = lines.map(paint).join('\n'); return }
  let i = 0, c = 0
  const tick = () => {
    if (i >= lines.length) { code.innerHTML = lines.map(paint).join('\n'); return }
    c = Math.min(lines[i].length, c + 3)
    code.innerHTML = [...lines.slice(0, i).map(paint), esc(lines[i].slice(0, c)) + '<i class="caret"></i>'].join('\n')
    if (c >= lines[i].length) { i++; c = 0; setTimeout(tick, lines[i]?.startsWith(' ') ? 160 : 700) } else setTimeout(tick, 14)
  }
  tick()
}
new IntersectionObserver(([e], io) => { if (e.isIntersecting) { io.disconnect(); type() } }, { threshold: .4 }).observe(code)
boot()
