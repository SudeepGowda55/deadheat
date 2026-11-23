// The photo-finish world: two lanes, a proxy line where both saves freeze, an app at the end, and a slit camera
// that only sees the line and prints the race over time. Everything here is a labelled simulation whose order,
// arrival and verdicts come from the real Kanboard runs (src/data/runs.json).
import * as THREE from 'three'

// Colours are the brand's sRGB values used as-is, so shaders, CSS and the clear colour match exactly.
THREE.ColorManagement.enabled = false

const INK = new THREE.Color('#101113'), WHITE = new THREE.Color('#ffffff'), GREY = new THREE.Color('#8e9399'), RED = new THREE.Color('#ff2d1a')
const LANE_Z = [-1.15, 1.15]
const START = -9.2, LINE = 0, APP = 6.2
const f = v => Number(v).toFixed(3) // GLSL needs float literals
export const CYCLE = 10 // seconds of one simulated race

const ease = {
  out: t => 1 - (1 - t) ** 3,
  in: t => t * t * t,
  io: t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
}
const clamp01 = v => Math.min(1, Math.max(0, v))
const span = (t, a, b) => clamp01((t - a) / (b - a))

// One race as a pure function of time t (0..CYCLE). spec: { first: lane that reaches the line first,
// release: [lane, lane] or 'together', outcome: ['lost'|'kept'|'refused', ...] }.
export function raceAt(t, spec) {
  const arrive = [0, 0]
  arrive[spec.first] = 2.4; arrive[1 - spec.first] = 3.9
  const REL = 4.6
  const leave = [REL, REL]
  if (spec.release !== 'together') leave[spec.release[1]] = REL + .45
  const lanes = [0, 1].map(i => {
    const go = span(t, .5, arrive[i])
    let x = START + 1 + (LINE - .5 - START - 1) * ease.out(go)
    const frozen = t >= arrive[i] && t < leave[i] ? 1 : 0
    const out = span(t, leave[i], leave[i] + .8)
    if (t >= leave[i]) x = LINE - .5 + (APP - .55 - LINE + .5) * ease.in(out)
    const landed = leave[i] + .8
    const o = spec.outcome[i]
    const done = span(t, landed + .1, landed + 1.5)
    let diss = 0, merge = 0, refused = 0
    if (t > landed) {
      if (o === 'lost') diss = ease.out(done)
      else if (o === 'kept') merge = ease.io(span(t, landed, landed + .7))
      else { refused = span(t, landed, landed + .25); x -= 1.6 * ease.out(span(t, landed, landed + 1.2)) }
    }
    const alpha = span(t, .1, .6) * (1 - span(t, CYCLE - 1.1, CYCLE - .4))
    return { x, frozen, diss, merge, refused, alpha, held: frozen ? t - arrive[i] : 0, landed: t > landed + .2, outcome: o, leaving: t >= leave[i] && t < landed }
  })
  const flash = Math.max(0, 1 - Math.abs(t - REL) / .35) + (spec.release !== 'together' ? Math.max(0, 1 - Math.abs(t - REL - .45) / .3) * .7 : 0)
  return { lanes, flash, released: t >= REL, arrive, REL }
}

const groundVS = `varying vec3 vW; varying float vD;
void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }`
// Newsprint halftone laid on the ground in world space: an ink lane, a white lane, flowing speed streaks, the red line.
const groundFS = `precision highp float;
varying vec3 vW; varying float vD;
uniform float uTime, uFlash, uFogNear, uFogFar;
uniform vec3 uInk, uWhite, uGrey, uRed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1)))*43758.5); }
// halftone coverage for a tone, falling back to the flat tone where the dots get smaller than a pixel
float halftone(vec2 p, float cell, float tone){
  vec2 q = p/cell;
  vec2 g = fract(q) - .5; float r = sqrt(clamp(tone, 0., 1.))*.6;
  float d = length(g); float w = fwidth(d);
  float dots = 1. - smoothstep(r - w, r + w, d);
  float flat_ = min(1., tone*1.13);
  return mix(dots, flat_, smoothstep(.12, .4, length(fwidth(q))));
}
void main(){
  vec2 p = vW.xz;
  float inA = smoothstep(.98, .9, abs(p.y + 1.15)), inB = smoothstep(.98, .9, abs(p.y - 1.15));
  float onTrack = smoothstep(${f(START - 1.6)}, ${f(START - .8)}, p.x) * step(p.x, ${f(APP + .1)});
  float row = floor(p.y*6.);
  float streak = smoothstep(.6, 1., sin(p.x*.9 - uTime*(2.2 + hash(vec2(row, 1.))*1.6) + hash(vec2(row, 3.))*6.28));
  float tInk = mix(.05, .42 + .3*streak, inA*onTrack);
  float tWhite = (.38 + .32*streak)*inB*onTrack;
  vec3 c = uGrey;
  float cell = .16;
  c = mix(c, uInk, halftone(p, cell, tInk)*.9);
  c = mix(c, uWhite, halftone(p + cell*.5, cell, tWhite));
  float lw = fwidth(p.y)*1.2;
  float lines = (1. - smoothstep(.02, .02 + lw, abs(p.y))) + (1. - smoothstep(.02, .02 + lw, abs(abs(p.y) - 2.3)));
  c = mix(c, uWhite, clamp(lines, 0., 1.)*onTrack);
  // ruler ticks along the near edge
  float tick = (1. - smoothstep(.012, .012 + fwidth(p.x)*1.5, abs(fract(p.x*.5) - .5) - .488)) * step(2.34, p.y) * step(p.y, 2.62);
  c = mix(c, uInk, tick*.8*onTrack);
  float rl = (1. - smoothstep(.025 + uFlash*.05, .025 + uFlash*.05 + fwidth(p.x)*1.5, abs(p.x))) * step(abs(p.y), 2.3);
  c = mix(c, uRed, rl);
  c = mix(c, uRed, uFlash*.28*exp(-abs(p.x)*1.4)*step(abs(p.y), 2.3));
  float fog = smoothstep(uFogNear, uFogFar, vD);
  gl_FragColor = vec4(mix(c, uGrey, fog), 1.);
}`

const trafficVS = `attribute vec4 aSeed;
uniform float uTime, uPx, uSlit;
varying float vLane, vA, vFog;
void main(){
  float lane = step(.5, aSeed.x);
  float speed = mix(1.4, 3.6, aSeed.w);
  float len = ${(APP - START + 1.2).toFixed(2)};
  float x = mod(aSeed.y*len + uTime*speed, len) + ${(START - .6).toFixed(2)};
  float z = mix(${f(LANE_Z[0])}, ${f(LANE_Z[1])}, lane) + (aSeed.z - .5)*1.55;
  float y = .03 + .65*pow(fract(aSeed.z*17.3 + aSeed.w*3.1), 3.);
  vec4 mv = modelViewMatrix*vec4(x, y, z, 1.);
  gl_Position = projectionMatrix*mv;
  float s = mix(1.2, 3.4, fract(aSeed.y*91.7));
  gl_PointSize = uSlit > .5 ? 2.5 : s*uPx*(15./-mv.z);
  vLane = lane; vFog = smoothstep(24., 42., -mv.z);
  vA = smoothstep(${f(START - .6)}, ${f(START + .6)}, x) * (1. - smoothstep(${f(APP - .4)}, ${f(APP)}, x));
}`
const dotFS = `precision highp float;
varying float vLane, vA, vFog;
uniform vec3 uInk, uWhite, uGrey;
void main(){
  float d = length(gl_PointCoord - .5); if (d > .5) discard;
  vec3 c = mix(uWhite, uInk, vLane);
  gl_FragColor = vec4(mix(c, uGrey, vFog), vA*(1. - smoothstep(.38, .5, d)));
}`

// A save: a page of dots standing in its lane. It presses against the line while frozen, blows off into
// halftone when lost, folds into the app when kept, and turns striped and backs off when refused.
const packetVS = `attribute vec4 aGrid; // u, v, lane, random
uniform vec4 uP[2]; // x, alpha, diss, merge
uniform vec4 uQ[2]; // refused, frozen, time, 0
uniform float uPx;
varying float vA, vLane, vInkiness;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  int i = int(aGrid.z + .5);
  vec4 P = uP[i]; vec4 Q = uQ[i];
  float u = aGrid.x, v = aGrid.y, r = aGrid.w;
  float w = 1.25*(1. - .3*Q.y);
  vec3 pos = vec3(P.x + (u - .5)*w + Q.y*.19, .1 + v*.86, mix(${f(LANE_Z[0])}, ${f(LANE_Z[1])}, aGrid.z) + (r - .5)*.05);
  // a frozen save shivers against the line
  pos.x += Q.y*sin(Q.z*40. + v*20.)*.008;
  float d = P.z;
  vec3 dir = normalize(vec3(hash(r*13.1) - .35, hash(r*71.7)*.9 + .2, hash(r*5.3) - .5));
  pos += dir*d*d*2.8 + vec3(.4, 1.1, 0.)*d;
  pos.x = mix(pos.x, ${f(APP - .12)} + (u - .5)*.06, P.w);
  vec4 mv = modelViewMatrix*vec4(pos, 1.);
  gl_Position = projectionMatrix*mv;
  // text lines on the page: every third row is lighter
  float line = step(.5, fract(v*9.));
  float size = (3.4 + 1.3*line)*(1. + d*2.4)*(1. - P.w*.6);
  gl_PointSize = size*uPx*(16./-mv.z);
  float stripes = step(.5, fract((u*26. + v*17.)/3.));
  vA = P.y*(1. - d)*(1. - P.w)*mix(1., stripes, Q.x);
  vLane = aGrid.z; vInkiness = line;
}`
const packetFS = `precision highp float;
varying float vA, vLane, vInkiness;
uniform vec3 uInk, uWhite;
void main(){
  float d = length(gl_PointCoord - .5); if (d > .5 || vA < .01) discard;
  vec3 c = mix(uInk, uWhite, vLane);
  gl_FragColor = vec4(c, vA*(1. - smoothstep(.4, .5, d)));
}`

const motesVS = `attribute vec3 aSeed; uniform float uTime, uPx; varying float vA;
void main(){
  vec3 p = vec3(mod(aSeed.x*34. + uTime*.18, 34.) - 17., .2 + aSeed.y*4.5 + sin(uTime*.3 + aSeed.z*6.28)*.25, (aSeed.z - .5)*16.);
  vec4 mv = modelViewMatrix*vec4(p, 1.); gl_Position = projectionMatrix*mv;
  gl_PointSize = (1. + aSeed.y*1.6)*uPx*(14./-mv.z); vA = .4*(1. - smoothstep(16., 40., -mv.z));
}`
const motesFS = `precision highp float; varying float vA; uniform vec3 uInk;
void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(uInk, vA); }`

const quadVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`
// Shifts the finish print left and writes what the slit sees into the newest columns.
const historyFS = `precision highp float; varying vec2 vUv;
uniform sampler2D uPrev, uSlit; uniform float uShift, uMark;
void main(){
  float edge = 1. - uShift;
  vec4 c = vUv.x < edge ? texture2D(uPrev, vec2(vUv.x + uShift, vUv.y)) : texture2D(uSlit, vec2(.5, vUv.y));
  if (uMark > .5 && vUv.x >= edge) c = vec4(1., .176, .102, 1.);
  gl_FragColor = c;
}`
const printFS = `precision highp float; varying vec2 vUv;
uniform sampler2D uHist; uniform vec2 uSize;
void main(){
  vec3 c = texture2D(uHist, vUv).rgb;
  // newsprint grain over the print, and the newest edge fades in like a developing strip
  vec2 g = fract(gl_FragCoord.xy/3.) - .5;
  c *= .94 + .06*step(length(g), .3);
  gl_FragColor = vec4(c, 1.);
}`

export function createWorld(canvas, { specs, reduced = false, onRelease } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  let dpr = Math.min(devicePixelRatio || 1, 1.5)
  renderer.setPixelRatio(dpr)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(GREY)
  renderer.autoClear = false

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 80)
  const common = { uInk: { value: INK }, uWhite: { value: WHITE }, uGrey: { value: GREY }, uRed: { value: RED }, uTime: { value: 0 }, uPx: { value: 1 } }

  const groundMat = new THREE.ShaderMaterial({ vertexShader: groundVS, fragmentShader: groundFS, uniforms: { ...common, uFlash: { value: 0 }, uFogNear: { value: 22 }, uFogFar: { value: 42 } } })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 50), groundMat)
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  // passing requests: reads go straight through the proxy, both lanes
  const N = matchMedia('(max-width: 700px)').matches ? 4200 : 7600
  const tg = new THREE.BufferGeometry()
  const seeds = new Float32Array(N * 4)
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random()
  tg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
  tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100)
  const trafficMat = new THREE.ShaderMaterial({ vertexShader: trafficVS, fragmentShader: dotFS, uniforms: { ...common, uSlit: { value: 0 } }, transparent: true, depthWrite: false })
  const traffic = new THREE.Points(tg, trafficMat)
  traffic.layers.enableAll()
  scene.add(traffic)

  const M = 2600
  const mg = new THREE.BufferGeometry()
  const ms = new Float32Array(M * 3)
  for (let i = 0; i < M * 3; i++) ms[i] = Math.random()
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 3))
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3))
  mg.boundingSphere = tg.boundingSphere
  scene.add(new THREE.Points(mg, new THREE.ShaderMaterial({ vertexShader: motesVS, fragmentShader: motesFS, uniforms: common, transparent: true, depthWrite: false })))

  // the two saves
  const COLS = 36, ROWS = 26
  const pg = new THREE.BufferGeometry()
  const grid = new Float32Array(2 * COLS * ROWS * 4)
  let k = 0
  for (let lane = 0; lane < 2; lane++) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) grid.set([c / (COLS - 1), r / (ROWS - 1), lane, Math.random()], 4 * k++)
  pg.setAttribute('aGrid', new THREE.BufferAttribute(grid, 4))
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(k * 3), 3))
  pg.boundingSphere = tg.boundingSphere
  const P = [new THREE.Vector4(), new THREE.Vector4()], Q = [new THREE.Vector4(), new THREE.Vector4()]
  const packetMat = new THREE.ShaderMaterial({ vertexShader: packetVS, fragmentShader: packetFS, uniforms: { ...common, uP: { value: P }, uQ: { value: Q } }, transparent: true, depthWrite: false })
  scene.add(new THREE.Points(pg, packetMat))

  // solid stand-ins of the saves, seen only by the slit camera, so the print shows clean bars
  const boxes = [INK, WHITE].map((c, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.25, .86, .5), new THREE.MeshBasicMaterial({ color: c, transparent: true }))
    m.position.set(0, .53, LANE_Z[i]); m.layers.set(1); scene.add(m); return m
  })

  // the proxy: two ink posts and the red hairline between them
  const postMat = new THREE.MeshBasicMaterial({ color: INK })
  for (const z of [-2.45, 2.45]) { const post = new THREE.Mesh(new THREE.BoxGeometry(.05, 2.5, .05), postMat); post.position.set(0, 1.25, z); scene.add(post) }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, 4.95), postMat); beam.position.set(0, 2.5, 0); scene.add(beam)
  const redMat = new THREE.LineBasicMaterial({ color: RED })
  const hair = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2.45), new THREE.Vector3(0, 2.46, 2.45), new THREE.Vector3(0, 2.46, -2.45), new THREE.Vector3(0, 0, -2.45)]), redMat)
  scene.add(hair)
  const glowMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.46), glowMat); glow.rotation.y = Math.PI / 2; glow.position.set(0, 1.23, 0); scene.add(glow)

  // the browsers at the start of each lane, and the app at the end
  const browsers = LANE_Z.map((z, i) => {
    const g = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, .06), new THREE.MeshBasicMaterial({ color: INK })); frame.position.y = .62
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.38, .78), new THREE.MeshBasicMaterial({ color: i ? WHITE : new THREE.Color('#d7dadd') })); screen.position.set(0, .58, .035)
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.38, .06), new THREE.MeshBasicMaterial({ color: RED.clone().lerp(INK, .9) })); bar.position.set(0, 1.0, .035)
    g.add(frame, screen, bar); g.position.set(START, 0, z); g.rotation.y = .5; scene.add(g); return g
  })
  const appMat = new THREE.MeshBasicMaterial({ color: WHITE })
  const app = new THREE.Mesh(new THREE.BoxGeometry(.24, 2.1, 4.9), appMat); app.position.set(APP, 1.05, 0); scene.add(app)
  const appEdge = new THREE.LineSegments(new THREE.EdgesGeometry(app.geometry), new THREE.LineBasicMaterial({ color: INK })); appEdge.position.copy(app.position); scene.add(appEdge)

  // slit camera: orthographic, a few millimetres wide, looking at the line from high on the side
  const slit = new THREE.OrthographicCamera(-.02, .02, 2.1, -2.1, .1, 40)
  slit.position.set(0, 7, 7.5); slit.lookAt(0, .35, 0); slit.layers.set(1)
  const slitRT = new THREE.WebGLRenderTarget(4, 256, { depthBuffer: true })
  const HW = 1024
  const histRT = [0, 1].map(() => new THREE.WebGLRenderTarget(HW, 256, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }))
  const quad = new THREE.PlaneGeometry(2, 2)
  const histMat = new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: historyFS, uniforms: { uPrev: { value: null }, uSlit: { value: slitRT.texture }, uShift: { value: 0 }, uMark: { value: 0 } }, depthTest: false })
  const printMat = new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: printFS, uniforms: { uHist: { value: null }, uSize: { value: new THREE.Vector2() } }, depthTest: false })
  const histScene = new THREE.Scene(); histScene.add(new THREE.Mesh(quad, histMat))
  const printScene = new THREE.Scene(); printScene.add(new THREE.Mesh(quad, printMat))
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let ping = 0
  for (const rt of histRT) { renderer.setRenderTarget(rt); renderer.setClearColor(GREY); renderer.clear() }
  renderer.setRenderTarget(null)

  // camera framing: side-on for wide screens, from behind the browsers for portrait ones
  const view = { w: 1, h: 1, portrait: false, band: null }
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  const shots = {
    wide: [
      { pos: [-2.2, 9.4, 19.6], look: [-2.0, .55, 0] }, // hero
      { pos: [-5.2, 5.4, 13.0], look: [-4.2, .2, 0] }, // two users
      { pos: [-1.6, 4.0, 10.2], look: [-1.0, .4, 0] }, // frozen
      { pos: [1.0, 5.2, 12.6], look: [1.4, .2, 0] }, // release
      { pos: [2.8, 5.0, 11.6], look: [2.9, .3, 0] }, // verdict
      { pos: [-1.4, 7.4, 17.0], look: [-1.2, -.1, 0] }, // fix
    ],
    tall: [
      { pos: [-21.5, 13.5, 13.5], look: [-.8, 1.6, 0] },
      { pos: [-18.5, 9.4, 10.4], look: [-4.5, .6, 0] },
      { pos: [-12.5, 7.4, 8.6], look: [.2, .8, 0] },
      { pos: [-14.5, 9.2, 10.2], look: [1.6, .7, 0] },
      { pos: [-11.5, 9.4, 10.6], look: [4.0, .7, 0] },
      { pos: [-21.5, 13.5, 13.5], look: [-.8, 1.0, 0] },
    ],
  }
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3()
  function framing(s) {
    const list = view.portrait ? shots.tall : shots.wide
    const i = Math.min(list.length - 2, Math.floor(s)), f = ease.io(clamp01(s - i))
    tmpA.fromArray(list[i].pos).lerp(tmpB.fromArray(list[i + 1].pos), f); cam.pos.copy(tmpA)
    tmpA.fromArray(list[i].look).lerp(tmpB.fromArray(list[i + 1].look), f); cam.look.copy(tmpA)
  }

  function resize() {
    const r = canvas.getBoundingClientRect()
    view.w = Math.max(1, r.width); view.h = Math.max(1, r.height); view.portrait = view.w / view.h < .9
    renderer.setSize(view.w, view.h, false)
    camera.aspect = view.w / view.h
    camera.fov = view.portrait ? 40 : 32
    // the lanes sit in the lower middle of the stage; the copy owns the top
    camera.setViewOffset(view.w, view.h, 0, view.portrait ? -view.h * .16 : -view.h * .1 - Math.max(0, 900 - view.h) * .2, view.w, view.h)
    camera.updateProjectionMatrix()
    common.uPx.value = renderer.getPixelRatio() * Math.min(1.4, view.h / 900)
  }

  // public state
  const state = { mode: 'auto', story: 0, storyTarget: 0, pointer: [0, 0], visible: true }
  let t0 = performance.now(), last = t0, autoT = 0, order = 0, lastReleased = false, printAcc = 0, printMark = false, lastStoryTarget = 0
  const listeners = []
  const anchors = { laneA: new THREE.Vector3(START, 1.3, LANE_Z[0]), laneB: new THREE.Vector3(START, 1.3, LANE_Z[1]), proxy: new THREE.Vector3(0, 2.75, 0), app: new THREE.Vector3(APP, 2.35, 0), pkA: new THREE.Vector3(), pkB: new THREE.Vector3(), vA: new THREE.Vector3(APP - .3, 1.25, LANE_Z[0]), vB: new THREE.Vector3(APP - .3, .6, LANE_Z[1]), line: new THREE.Vector3(0, 1.2, 0) }
  const proj = new THREE.Vector3()
  const screen = {}

  function frameState(now) {
    const time = (now - t0) / 1000
    if (state.mode === 'auto') {
      if (!reduced) autoT += Math.min(.05, (now - last) / 1000)
      if (autoT >= CYCLE) { autoT -= CYCLE; order = (order + 1) % specs.auto.length }
      return { time, spec: specs.auto[order], t: reduced ? 4.2 : autoT, specIndex: order }
    }
    // story: chapters 1..5 map to one race, scrubbed; the last chapter replays the fixed app
    const s = state.story
    const c = s - 1
    if (c < 4) {
      const keys = [0, 1.6, 4.4, 5.7, 8.4]
      const i = Math.max(0, Math.min(3, Math.floor(c))), f = clamp01(c - i)
      return { time, spec: specs.story, t: keys[i] + (keys[i + 1] - keys[i]) * f, specIndex: -1 }
    }
    return { time, spec: specs.fixed, t: Math.min(8.4, 3.6 + clamp01(c - 4) * 6), specIndex: -2 }
  }

  function render(now) {
    const dt = Math.min(.1, (now - last) / 1000)
    const fs = frameState(now)
    last = now
    state.story += (state.storyTarget - state.story) * (reduced ? 1 : Math.min(1, dt * 7))
    const race = raceAt(fs.t, fs.spec)
    common.uTime.value = reduced ? 3 : fs.time
    groundMat.uniforms.uFlash.value = race.flash
    glowMat.opacity = race.flash * .1
    race.lanes.forEach((l, i) => {
      P[i].set(l.x, l.alpha, l.diss, l.merge)
      Q[i].set(l.refused, l.frozen, fs.time, 0)
      boxes[i].position.x = l.x + l.frozen * .19
      boxes[i].material.opacity = l.alpha * (1 - l.diss) * (1 - l.merge)
      boxes[i].visible = boxes[i].material.opacity > .02
      anchors[i ? 'pkB' : 'pkA'].set(l.x, .95, LANE_Z[i])
    })
    const kept = race.lanes.reduce((m, l) => Math.max(m, l.merge * (1 - l.merge) * 4), 0)
    appMat.color.copy(WHITE).lerp(GREY, kept * .5)
    if (race.released && !lastReleased) { printMark = true; onRelease?.() }
    lastReleased = race.released

    framing(state.mode === 'auto' ? 0 : Math.min(5, state.story))
    camera.position.copy(cam.pos)
    camera.position.x += state.pointer[0] * .5; camera.position.y += state.pointer[1] * .25
    camera.lookAt(cam.look)

    // main view
    renderer.setRenderTarget(null)
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, view.w, view.h)
    renderer.setClearColor(GREY); renderer.clear()
    renderer.render(scene, camera)

    // slit camera and the finish print
    trafficMat.uniforms.uSlit.value = 1
    renderer.setRenderTarget(slitRT); renderer.setClearColor(GREY); renderer.clear(); renderer.render(scene, slit)
    trafficMat.uniforms.uSlit.value = 0
    // reduced motion: the print only moves when the reader scrolls the story
    printAcc += reduced ? Math.abs(state.storyTarget - lastStoryTarget) * 300 : dt * 70
    lastStoryTarget = state.storyTarget
    const cols = Math.floor(printAcc)
    if (cols > 0) {
      printAcc -= cols
      histMat.uniforms.uPrev.value = histRT[ping].texture
      histMat.uniforms.uShift.value = cols / HW
      histMat.uniforms.uMark.value = printMark ? 1 : 0
      printMark = false
      renderer.setRenderTarget(histRT[1 - ping]); renderer.render(histScene, flatCam)
      ping = 1 - ping
    }
    renderer.setRenderTarget(null)
    if (view.band) {
      const b = view.band
      renderer.setViewport(b.x, view.h - b.y - b.h, b.w, b.h)
      renderer.setScissor(b.x, view.h - b.y - b.h, b.w, b.h)
      renderer.setScissorTest(true)
      printMat.uniforms.uHist.value = histRT[ping].texture
      renderer.render(printScene, flatCam)
      renderer.setScissorTest(false)
    }

    camera.updateMatrixWorld()
    for (const key in anchors) {
      proj.copy(anchors[key]).project(camera)
      screen[key] = [(proj.x * .5 + .5) * view.w, (-proj.y * .5 + .5) * view.h, proj.z < 1]
    }
    for (const fn of listeners) fn({ race, fs, screen })
  }

  // keep it smooth: step the resolution down if frames stay slow
  let slow = 0, raf = 0, prev = performance.now()
  function loop(now) {
    raf = requestAnimationFrame(loop)
    if (!state.visible) { last = prev = now; return }
    render(now)
    slow = now - prev > 22 ? slow + 1 : Math.max(0, slow - 1)
    prev = now
    if (slow > 60 && dpr > 1) { dpr = Math.max(1, dpr - .25); renderer.setPixelRatio(dpr); resize(); slow = 0 }
  }
  resize()
  raf = requestAnimationFrame(loop)

  return {
    renderer,
    resize,
    setBand(rect) { view.band = rect },
    setMode(m) { state.mode = m },
    setStory(s) { state.storyTarget = s; if (reduced) state.story = s },
    setPointer(x, y) { state.pointer = [x, y] },
    setVisible(v) { state.visible = v },
    onFrame(fn) { listeners.push(fn) },
    get specIndex() { return order },
    dispose() { cancelAnimationFrame(raf); renderer.dispose() },
  }
}
