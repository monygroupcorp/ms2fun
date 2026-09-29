// Renders content/posts.json + content/primitives.json into one page built for a phone: every
// post in a tap-to-copy block, its image beside it, and the primitive inventory underneath.
//
// This exists because the alternative is hand-writing a bespoke HTML page per campaign beat, and
// a pipeline whose first step is "write the page again" is not a pipeline. Add a post to the JSON
// and re-run; nothing else changes.
//
//   node tools/posts/render.mjs [out.html]
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const posts = JSON.parse(fs.readFileSync(path.join(root, 'content/posts.json'), 'utf8'))
const prims = JSON.parse(fs.readFileSync(path.join(root, 'content/primitives.json'), 'utf8'))
const outFile = process.argv[2] || path.join(root, 'tools/posts/out/queue.html')

// Assets are served from the committed copies: a phone can open a URL and cannot open a laptop.
// The ref matters — the assets live on the branch that added them until it merges, and a page full
// of 404s looks exactly like a page that works until someone taps Save. POSTS_ASSET_REF overrides;
// tools/posts/check-assets.sh fails if the ref in use does not actually serve them.
const REF = process.env.POSTS_ASSET_REF || 'testnet-announcement-campaign'
const RAW = `https://raw.githubusercontent.com/monygroupcorp/ms2fun/${REF}/tools/brand/assets`
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const STATUS = {
  posted:  ['posted',  '#0a7a2f'],
  ready:   ['ready',   '#000'],
  drafted: ['draft',   '#666'],
  blocked: ['blocked', '#c00'],
}

const postBlock = (p) => {
  const [label, colour] = STATUS[p.status] || ['?', '#666']
  const thread = p.body.length > 1
  return `
<article class="item" id="${p.id}">
  <header>
    <span class="id">${p.id}</span>
    <span class="badge" style="--c:${colour}">${label}${thread ? ` · ${p.body.length} posts` : ''}</span>
  </header>
  ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
  ${p.asset ? (p.asset.endsWith('.mp4')
      ? `<div class="media"><video src="${RAW}/${p.asset}" controls loop muted playsinline preload="metadata" poster="${RAW}/noesis-mainliner-poster.png"></video>
         <a class="save" href="${RAW}/${p.asset}" download="${p.asset}">Save ${p.asset}</a></div>`
      : `<div class="media"><img src="${RAW}/${p.asset}" alt="" loading="lazy">
         <a class="save" href="${RAW}/${p.asset}" download="${p.asset}">Save ${p.asset}</a></div>`) : ''}
  ${p.body.map((b, i) => `
  <div class="post">
    ${thread ? `<span class="n">${i + 1}/${p.body.length}</span>` : ''}
    <pre class="copy" data-copy>${esc(b)}</pre>
    <button class="cp" type="button">Copy</button>
  </div>`).join('')}
</article>`
}

const campaigns = posts.campaigns.map((c) => `
<section>
  <h2>${esc(c.name)}</h2>
  ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
  ${c.posts.map(postBlock).join('\n')}
</section>`).join('\n')

const byGroup = {}
for (const p of prims.primitives) (byGroup[p.group] ||= []).push(p)
const THREAD = { written: ['written', '#0a7a2f'], drafted: ['drafted', '#666'], 'not-started': ['not started', '#c00'] }

const inventory = Object.entries(byGroup).map(([g, rows]) => `
  <tr class="grp"><td colspan="4">${g}</td></tr>
  ${rows.map((r) => {
    const [tl, tc] = THREAD[r.thread] || ['?', '#666']
    return `<tr>
      <td><b>${esc(r.name)}</b><div class="w">${esc(r.what)}</div>${r.note ? `<div class="w warn">${esc(r.note)}</div>` : ''}</td>
      <td class="mono">${r.deployed ? '<span class="yes">on sepolia</span>' : '<span class="no">not deployed</span>'}</td>
      <td class="mono">${r.route ? `<a href="https://noesis.gwei.domains${r.route}">${r.route}</a>` : '—'}</td>
      <td class="mono"><span class="badge" style="--c:${tc}">${tl}</span></td>
    </tr>`
  }).join('')}`).join('')

const counts = ['written', 'drafted', 'not-started'].map((s) => `${s}: ${prims.primitives.filter((p) => p.thread === s).length}`).join(' · ')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>noesis — posting queue</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--display:'Syne',Arial,sans-serif;--body:'Archivo',Helvetica,Arial,sans-serif;--mono:'IBM Plex Mono',monospace;
      --bg:#fff;--bg2:#fafafa;--fg:#000;--fg2:#666;--fg3:#999;--rule:#000;--rule2:#e0e0e0}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--bg2:#151515;--fg:#fff;--fg2:#999;--fg3:#777;--rule:#fff;--rule2:#333}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--body);line-height:1.55;font-size:16px}
.wrap{max-width:720px;margin:0 auto;padding:32px 16px 96px}
.kick{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--fg2)}
h1{font-family:var(--display);font-weight:800;font-size:38px;line-height:1;letter-spacing:-.025em;margin:10px 0 8px}
.lede{color:var(--fg2);font-size:15px;margin-bottom:28px}
h2{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
   border-bottom:2px solid var(--rule);padding-bottom:8px;margin:44px 0 18px}
.item{border:2px solid var(--rule);border-radius:2px;margin-bottom:20px;overflow:hidden}
.item>header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;
             background:var(--bg2);border-bottom:1px solid var(--rule2)}
.id{font-family:var(--mono);font-size:12px;letter-spacing:.08em}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
       border:1.5px solid var(--c);color:var(--c);padding:2px 7px;border-radius:2px;white-space:nowrap}
.note{font-size:13.5px;color:var(--fg2);padding:12px 14px 0}
.warn{color:#c00}
.media{padding:14px}
.media img,.media video{display:block;width:100%;border:1px solid var(--rule2);border-radius:2px}
.save{display:inline-block;margin-top:10px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
      text-transform:uppercase;border:2px solid var(--rule);border-radius:2px;padding:10px 14px;
      text-decoration:none;color:var(--bg);background:var(--fg)}
.post{padding:14px;border-top:1px dashed var(--rule2);position:relative}
.n{font-family:var(--mono);font-size:11px;color:var(--fg3);display:block;margin-bottom:8px}
pre.copy{font-family:var(--body);font-size:15.5px;white-space:pre-wrap;word-wrap:break-word;
         background:var(--bg2);border:1px solid var(--rule2);border-radius:2px;padding:14px;-webkit-user-select:all;user-select:all}
.cp{margin-top:10px;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;
    border:2px solid var(--rule);background:var(--bg);color:var(--fg);border-radius:2px;padding:10px 16px;cursor:pointer}
.cp.done{background:var(--fg);color:var(--bg)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-align:left;
   color:var(--fg3);padding:0 8px 8px 0;border-bottom:2px solid var(--rule)}
td{padding:10px 8px 10px 0;border-bottom:1px solid var(--rule2);vertical-align:top}
tr.grp td{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;
          color:var(--fg3);padding-top:18px;border-bottom:1px solid var(--rule)}
.w{color:var(--fg2);font-size:12.5px;margin-top:3px}
.mono{font-family:var(--mono);font-size:11.5px}
.yes{color:#0a7a2f}.no{color:#c00}
.scroll{overflow-x:auto}
a{color:inherit}
</style></head><body><div class="wrap">

<div class="kick">noesis · posting queue · ${prims._asof}</div>
<h1>What to post next</h1>
<p class="lede">Generated from <span class="mono">content/posts.json</span> and
<span class="mono">content/primitives.json</span>. Tap a block to select it, or hit Copy. Images and
video load from the committed assets, so this works on a phone.</p>

${campaigns}

<h2>Primitive inventory · ${counts}</h2>
<div class="scroll"><table>
<thead><tr><th>primitive</th><th>status</th><th>where</th><th>thread</th></tr></thead>
<tbody>${inventory}</tbody>
</table></div>

<script>
document.querySelectorAll('.cp').forEach((b) => {
  b.addEventListener('click', async () => {
    const t = b.parentElement.querySelector('[data-copy]').textContent
    try { await navigator.clipboard.writeText(t) }
    catch { const r = document.createRange(); r.selectNodeContents(b.parentElement.querySelector('[data-copy]'))
            const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
    b.textContent = 'Copied'; b.classList.add('done')
    setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done') }, 1400)
  })
})
</script>
</div></body></html>`

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, html)
console.log(`${outFile} — ${posts.campaigns.reduce((n, c) => n + c.posts.length, 0)} items, ${prims.primitives.length} primitives`)
