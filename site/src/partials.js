import { REPO, SITE, VIDEO_URL } from './config.js'

const LINKS = [['/', 'Story'], ['/how/', 'How it works'], ['/proof/', 'Proof'], ['/install/', 'Install']]
const GH = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

export const nav = route => `
<div class="veil" aria-hidden="true"><canvas></canvas><p class="veil-label"></p><i class="veil-line"></i></div>
<div class="cursor" aria-hidden="true"><i class="c-a"></i><i class="c-b"></i><i class="c-line"></i></div>
<header class="nav">
  <a class="mark" href="/" aria-label="Dead Heat home"><i><b></b></i>Dead Heat</a>
  <nav aria-label="Pages"><ul>${LINKS.map(([href, label]) => `<li><a href="${href}"${href === route ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}</ul></nav>
  <a class="gh" href="${REPO}" target="_blank" rel="noreferrer" aria-label="GitHub repository">${GH}</a>
</header>`

export const foot = () => `
<footer class="foot">
  <div class="foot-line" aria-hidden="true"></div>
  <div class="foot-row">
    <a class="mark" href="/"><i><b></b></i>Dead Heat</a>
    <p>Built for the <a href="https://www.kaneclihack.sh/" target="_blank" rel="noreferrer">KaneCLI Online Hackathon</a> by team Matcrypt (Sudeep and Manvith). MIT licence.</p>
    <ul>${LINKS.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}<li><a href="${REPO}" target="_blank" rel="noreferrer">GitHub</a></li></ul>
  </div>
</footer>`

// Rendered only when VIDEO_URL is set; otherwise the section does not exist.
export const video = () => !VIDEO_URL ? '' : `
<section class="sec video" aria-label="Demo video">
  <h2 class="h2" data-head>Watch one dead heat.</h2>
  <div class="frame"><iframe src="${VIDEO_URL}" title="Dead Heat demo video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
</section>`

const PAGES = {
  '/': ['Dead Heat · Two real users. One instant.', 'Dead Heat makes two real users press save at the same instant, then has Kane CLI check who silently lost. Kanboard 1.2.58 lost an edit in all three orders.'],
  '/how/': ['How it works · Dead Heat', 'How Dead Heat works: one proxy lane per user, both saves frozen, released together or in either order, then Kane CLI judges each user kept, refused or lost.'],
  '/proof/': ['Proof · Dead Heat', 'The real Kanboard 1.2.58 reports: one user’s edit silently lost in every order, then a coding agent’s patch that refuses the stale save with 409 Conflict.'],
  '/install/': ['Install · Dead Heat', 'Install Kane CLI and Dead Heat, run the six-minute desk example, reproduce the Kanboard race, then hand any silent loss to your coding agent with deadheat fix.'],
}
export const routes = Object.keys(PAGES)

export const head = route => {
  const [title, description] = PAGES[route]
  const url = SITE + route
  return `<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dead Heat">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="627">
<meta property="og:image:alt" content="Dead Heat: two save requests frozen at a finish line, one silently lost">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="theme-color" content="#8e9399">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=B612+Mono:wght@400;700&family=Kanit:ital,wght@1,800&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<script>try{if(sessionStorage.getItem('dh-t'))document.documentElement.classList.add('t-in')}catch(e){}</script>`
}
