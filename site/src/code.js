// A small highlighter for the three kinds of code the site shows: JSON race files, shell lines and the PHP patch.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TOKEN = /(\/\/.*$|^\s*\*.*$|\/\*\*.*$|#.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(\s*:)?|(\$[A-Za-z_]\w*)|\b(public|protected|private|function|return|if|else|isset|array|null|true|false|throw|new|try|catch|unset|empty|int|foreach|as|class|extends)\b/gm

export function highlight(src) {
  let out = '', last = 0
  src.replace(TOKEN, (m, comment, str, colon, variable, keyword, at) => {
    out += esc(src.slice(last, at))
    if (comment) out += `<span class="c">${esc(m)}</span>`
    else if (str) out += colon ? `<span class="k">${esc(str)}</span>${esc(colon)}` : `<span class="s">${esc(str)}</span>`
    else if (variable) out += `<span class="n">${esc(m)}</span>`
    else out += `<span class="k">${esc(m)}</span>`
    last = at + m.length
    return m
  })
  return out + esc(src.slice(last))
}

// A unified diff as rows: file headers, hunk headers, added, removed and context lines.
export function diffRows(diff) {
  return diff.replace(/\n$/, '').split('\n').map(line => {
    const kind = /^(diff --git|index |--- |\+\+\+ )/.test(line) ? 'file' : line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
    const body = kind === 'file' || kind === 'hunk' ? esc(line) : `<i>${esc(line[0] || ' ')}</i>${highlight(line.slice(1))}`
    return `<span class="dl dl-${kind}">${body}</span>`
  }).join('')
}

// self-check, cheap enough to run in development only
if (import.meta.env?.DEV) {
  console.assert(highlight('"a": "b"') === '<span class="k">"a"</span>: <span class="s">"b"</span>', 'json highlight')
  console.assert(diffRows('+$x = 1;').includes('dl-add') && diffRows('+$x = 1;').includes('<span class="n">$x</span>'), 'diff rows')
}
