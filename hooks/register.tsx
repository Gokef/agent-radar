import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Snapshot } from '../types'

const PANE = 'agent-radar'
const TITLE = 'Agent Radar'
const POLL_MS = 4000

const snapshot = atom({ plugin: 'agent-radar', key: 'snapshot' } as const, {
  rows: [],
  scannedAt: 0,
} as Snapshot)

// ---------- drawing helpers ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const PALETTE = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#86efac', '#fcd34d', '#fdba74', '#5eead4', '#a5b4fc']
const hue = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const STATUS = {
  working: { color: '#22d3ee', label: 'WORKING' },
  waiting: { color: '#34d399', label: '✓ DONE' },
  idle: { color: '#64748b', label: 'IDLE' },
  sleeping: { color: '#818cf8', label: 'ASLEEP' },
} as const

const W = 560
const CARD_H = 78
const SUB_H = 20

const STYLE = `
  .bg-grid { animation: drift 18s linear infinite; }
  @keyframes drift { to { transform: translate(-40px, -40px); } }
  .sweep { transform-box: view-box; transform-origin: 36px 36px; animation: spin 3.2s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .blip { animation: blip 3.2s ease-out infinite; opacity: 0; }
  @keyframes blip { 0%,8% { opacity: 0 } 12% { opacity: 1 } 60%,100% { opacity: 0 } }
  .ring { transform-box: fill-box; transform-origin: center; animation: ring 1.8s ease-out infinite; }
  @keyframes ring { from { transform: scale(1); opacity: .9 } to { transform: scale(3.2); opacity: 0 } }
  .breathe { animation: breathe 2.6s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: .35 } }
  .flow { stroke-dasharray: 60 240; animation: flow 2.4s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -300; } }
  .scan { animation: scan 2.2s cubic-bezier(.6,0,.4,1) infinite; }
  @keyframes scan { from { transform: translateX(-120px) } to { transform: translateX(${W}px) } }
  .dot { animation: dot 1.2s ease-in-out infinite; }
  .dot.d2 { animation-delay: .2s } .dot.d3 { animation-delay: .4s }
  @keyframes dot { 0%,80%,100% { opacity: .15 } 40% { opacity: 1 } }
  .orbit { transform-box: view-box; animation: spin 4s linear infinite; }
  .card { animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) } }
  .zz { animation: zz 2.4s ease-in-out infinite; opacity: 0; }
  @keyframes zz { 0% { opacity: 0; transform: translate(0,4px) } 40% { opacity: 1 } 100% { opacity: 0; transform: translate(8px,-12px) } }
  .card:hover .glass { fill: #18213a; }
  .shimmer { animation: shimmer 2.8s linear infinite; }
  @keyframes shimmer { from { transform: translateX(-200px) } to { transform: translateX(${W + 200}px) } }
  text { font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif; }
  .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
`

const card = (row: AgentRow, y: number, i: number) => {
  const st = STATUS[row.status]
  const h = CARD_H + row.subagents.length * SUB_H
  const isWorking = row.status === 'working'
  const ox = 30
  const oy = y + 30
  const parts: string[] = []

  parts.push(`<g class="card" style="animation-delay:${i * 70}ms">`)
  parts.push(
    `<rect class="glass" x="12" y="${y}" width="${W - 24}" height="${h}" rx="12" fill="#121a2e" stroke="#1f2a44"/>`,
  )
  if (isWorking) {
    // light running around the card's edge
    parts.push(
      `<rect x="12" y="${y}" width="${W - 24}" height="${h}" rx="12" fill="none" stroke="url(#edge)" stroke-width="1.6" pathLength="300" class="flow"/>`,
    )
    // shimmer over the card
    parts.push(
      `<g clip-path="url(#clip${i})"><rect class="shimmer" x="0" y="${y}" width="140" height="${h}" fill="url(#shine)"/></g>`,
    )
    parts.push(
      `<clipPath id="clip${i}"><rect x="12" y="${y}" width="${W - 24}" height="${h}" rx="12"/></clipPath>`,
    )
  }

  // status orb
  if (isWorking) {
    parts.push(`<circle class="ring" cx="${ox}" cy="${oy}" r="5" fill="none" stroke="${st.color}" stroke-width="1.5"/>`)
    parts.push(
      `<circle class="ring" style="animation-delay:.9s" cx="${ox}" cy="${oy}" r="5" fill="none" stroke="${st.color}" stroke-width="1.5"/>`,
    )
  }
  parts.push(
    `<circle cx="${ox}" cy="${oy}" r="5.5" fill="${st.color}" filter="url(#glow)" class="${row.status === 'waiting' ? 'breathe' : ''}"/>`,
  )
  // a satellite circling the orb for each subagent
  row.subagents.forEach((a, k) => {
    const dur = 2.4 + k * 0.7
    parts.push(
      `<g class="orbit" style="transform-origin:${ox}px ${oy}px;animation-duration:${dur}s;animation-delay:-${k * 0.8}s"><circle cx="${ox + 12 + k * 3}" cy="${oy}" r="2.2" fill="${a.isActive ? '#a78bfa' : '#475569'}"/></g>`,
    )
  })

  // texts
  parts.push(
    `<text x="50" y="${y + 26}" font-size="14" font-weight="600" fill="#e2e8f0">${esc(clip(row.title, 42))}</text>`,
  )
  parts.push(
    `<text x="${W - 26}" y="${y + 24}" font-size="9.5" font-weight="700" letter-spacing="1.2" text-anchor="end" fill="${st.color}" class="${row.status === 'waiting' ? 'breathe' : ''}">${st.label}</text>`,
  )
  if (row.status === 'sleeping')
    parts.push(
      `<text x="${ox + 8}" y="${oy - 6}" font-size="10" font-weight="700" fill="${st.color}" class="zz">z</text>`,
      `<text x="${ox + 8}" y="${oy - 6}" font-size="12" font-weight="700" fill="${st.color}" class="zz" style="animation-delay:1.2s">z</text>`,
    )
  parts.push(
    `<text x="${W - 26}" y="${y + 38}" font-size="10" text-anchor="end" fill="#64748b">${esc(row.ago)}</text>`,
  )
  if (row.task)
    parts.push(
      `<text x="50" y="${y + 44}" font-size="11.5" fill="#94a3b8">“${esc(clip(row.task, 64))}”</text>`,
    )
  const doing = clip(row.doing, 70)
  parts.push(
    `<text x="50" y="${y + 64}" font-size="11" class="mono" fill="${isWorking ? '#67e8f9' : '#64748b'}">${isWorking ? '▸ ' : ''}${esc(doing)}${
      isWorking
        ? `<tspan class="dot"> .</tspan><tspan class="dot d2">.</tspan><tspan class="dot d3">.</tspan>`
        : ''
    }</text>`,
  )

  row.subagents.forEach((a, k) => {
    const sy = y + CARD_H + k * SUB_H - 4
    parts.push(
      `<path d="M38 ${sy - 12} V ${sy - 4} H 50" fill="none" stroke="#334155"/>`,
      `<circle cx="56" cy="${sy - 4}" r="3" fill="${a.isActive ? '#a78bfa' : '#475569'}" class="${a.isActive ? 'breathe' : ''}"/>`,
      `<text x="66" y="${sy}" font-size="10.5" fill="#c4b5fd">${esc(a.name)}</text>`,
      `<text x="${66 + Math.min(a.name.length, 28) * 6 + 10}" y="${sy}" font-size="10.5" class="mono" fill="#64748b">${esc(clip(a.doing, 52))}</text>`,
    )
  })

  if (isWorking) {
    // progress scanner along the bottom
    parts.push(
      `<g clip-path="url(#clip${i})"><rect class="scan" x="0" y="${y + h - 2}" width="120" height="2" fill="url(#beam)"/></g>`,
    )
  }
  parts.push('</g>')
  return { svg: parts.join(''), h }
}

const drawSvg = (snap: Snapshot) => {
  const rows = snap.rows
  const working = rows.filter(r => r.status === 'working').length
  const waiting = rows.filter(r => r.status === 'waiting').length

  // group by project, keeping the order the scan ranked them in
  const groups = new Map<string, AgentRow[]>()
  for (const r of rows) groups.set(r.project, [...(groups.get(r.project) ?? []), r])

  const body: string[] = []
  let y = 84
  let i = 0
  for (const [project, list] of groups) {
    const c = hue(project)
    const isLive = list.some(r => r.status === 'working')
    body.push(
      `<g class="card" style="animation-delay:${i * 70}ms">`,
      `<rect x="12" y="${y}" width="${Math.min(W - 24, project.length * 7.4 + 64)}" height="22" rx="11" fill="${c}" fill-opacity=".12" stroke="${c}" stroke-opacity=".5"/>`,
      `<path d="M24 ${y + 6} h5 l2 2 h7 v8 h-14 z" fill="${c}" ${isLive ? 'class="breathe"' : ''}/>`,
      `<text x="44" y="${y + 15}" font-size="11" font-weight="700" letter-spacing=".6" fill="${c}">${esc(project)}</text>`,
      `<text x="${Math.min(W - 24, project.length * 7.4 + 64) + 20}" y="${y + 15}" font-size="10" fill="#64748b">${list.length} session${list.length === 1 ? '' : 's'}</text>`,
      `</g>`,
    )
    y += 30
    for (const r of list) {
      const { svg, h } = card(r, y, i++)
      body.push(svg)
      y += h + 10
    }
    y += 8
  }
  if (rows.length === 0) {
    body.push(
      `<text x="${W / 2}" y="${y + 30}" font-size="13" text-anchor="middle" fill="#64748b">${esc(snap.error ? 'Scan failed: ' + clip(snap.error, 60) : snap.scannedAt ? 'No Claude sessions in the last 6 hours.' : 'Scanning…')}</text>`,
    )
    y += 60
  }
  const H = Math.max(y + 10, 160)

  const blips = rows.slice(0, 6).map((r, k) => {
    const a = (k / Math.max(1, Math.min(rows.length, 6))) * Math.PI * 2 + 0.6
    const d = r.status === 'working' ? 10 : r.status === 'waiting' ? 16 : 21
    return `<circle class="blip" style="animation-delay:${(a / (Math.PI * 2)) * 3.2}s" cx="${36 + Math.cos(a) * d}" cy="${36 + Math.sin(a) * d}" r="2" fill="${STATUS[r.status].color}"/>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>${STYLE}</style>
<defs>
  <linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#0f0a24"/></linearGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1e293b" stroke-width=".6"/></pattern>
  <linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
  <linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity="0"/><stop offset=".7" stop-color="#22d3ee"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#7dd3fc" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="sweepg" cx="0" cy="0" r="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".55"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${W}" height="${H}" rx="14" fill="url(#bgg)"/>
<g opacity=".7"><rect class="bg-grid" x="0" y="0" width="${W + 80}" height="${H + 80}" fill="url(#grid)"/></g>

<g>
  <circle cx="36" cy="36" r="24" fill="#0b1324" stroke="#164e63"/>
  <circle cx="36" cy="36" r="16" fill="none" stroke="#164e63" stroke-dasharray="2 3"/>
  <circle cx="36" cy="36" r="8" fill="none" stroke="#164e63"/>
  <g class="sweep"><path d="M36 36 L60 36 A24 24 0 0 0 52.97 19.03 Z" fill="url(#sweepg)"/><line x1="36" y1="36" x2="60" y2="36" stroke="#67e8f9" stroke-width="1.2"/></g>
  ${blips.join('')}
  <circle cx="36" cy="36" r="2" fill="#67e8f9"/>
</g>
<text x="72" y="32" font-size="16" font-weight="800" letter-spacing="3" fill="#e2e8f0">AGENT RADAR</text>
<text x="72" y="50" font-size="11" fill="#94a3b8"><tspan fill="#22d3ee" font-weight="700">${working}</tspan> working  ·  <tspan fill="#34d399" font-weight="700">${waiting}</tspan> done  ·  <tspan fill="#818cf8" font-weight="700">${rows.filter(r => r.status === 'sleeping').length}</tspan> asleep  ·  ${rows.length} sessions  ·  ${groups.size} projects</text>
<circle cx="${W - 30}" cy="30" r="3.5" fill="#22c55e" class="breathe"/>
<text x="${W - 40}" y="34" font-size="10" text-anchor="end" fill="#4ade80" letter-spacing="1">LIVE</text>
<line x1="12" y1="68" x2="${W - 12}" y2="68" stroke="#1f2a44"/>
${body.join('\n')}
</svg>`
}

// ---------- scanning ----------

let isScanning = false
const URL_ = 'http://localhost:47474'

// Starts the localhost page server for this session's life (if another
// session already runs it, the new one just exits) and opens it in the browser.
const openWebsite = async ($: EngineInterface) => {
  void (async () => {
    try {
      const server = $.process.spawn({ argv: ['node', `${$.plugin.root}/hooks/server.mjs`, '47474'] })
      for await (const _ of server) {
        /* keep the server running */
      }
    } catch {}
  })()
  await $.clock.sleep(700)
  await $.process.run(['cmd', '/c', 'start', '', URL_])
}

const scan = async ($: EngineInterface) => {
  if (isScanning) return
  isScanning = true
  try {
    const script = `${$.plugin.root}/hooks/scan.mjs`
    const { exitCode, stdout, stderr } = await $.process.run(['node', script], { timeoutMs: 15000 })
    const next: Snapshot =
      exitCode === 0
        ? { rows: JSON.parse(stdout).map(({ mtime, ...r }: AgentRow & { mtime: number }) => r), scannedAt: 1 }
        : { rows: [], error: stderr.trim() || `exit ${exitCode}`, scannedAt: 1 }
    const before = await read($, snapshot)
    // Toast in the app when another session finishes and waits on the person.
    const was = new Map(before.rows.map(r => [r.id, r.status]))
    const me = await $.session.id()
    for (const r of next.rows) {
      const old = was.get(r.id)
      if (r.id !== me && old && old !== 'waiting' && r.status === 'waiting')
        $.ui.toast(`✓ ${r.title} (${r.project}) is done. See it at http://localhost:47474`)
    }
    // Only redraw when something visible changed, so the animations keep running smoothly.
    if (JSON.stringify(before) !== JSON.stringify(next)) await update($, snapshot, () => next)
  } catch (err) {
    await update($, snapshot, () => ({ rows: [], error: String(err), scannedAt: 1 }))
  } finally {
    isScanning = false
  }
}

// Replies typed on the localhost page are dropped in data/outbox by the
// server; this sends each one to its session and records the result.
const handled = new Set<string>()
async function relayReplies($: EngineInterface) {
  const outbox = `${$.plugin.root}/data/outbox`
  const sent = `${$.plugin.root}/data/sent`
  let entries
  try { entries = await $.fs.list(outbox) } catch { return }
  for (const f of entries) {
    if (!f.name.endsWith('.json') || handled.has(f.name)) continue
    handled.add(f.name)
    if (await $.fs.exists(`${sent}/${f.name}`)) continue
    try {
      const msg = JSON.parse(await $.fs.read(`${outbox}/${f.name}`)) as { rid: string; id: string; text: string; at: number }
      if ((await $.clock.now()) - msg.at > 10 * 60e3) {
        await $.fs.write(`${sent}/${f.name}`, JSON.stringify({ ok: false, reason: 'expired' }))
        continue
      }
      const result = await $.session.send({ to: { sessionId: msg.id }, text: msg.text })
      await $.fs.write(`${sent}/${f.name}`, JSON.stringify({ ok: result.isDelivered, reason: result.reason ?? null }))
      $.ui.toast(result.isDelivered ? 'Agent Radar: reply sent' : `Agent Radar: reply not delivered (${result.reason})`)
    } catch (err) {
      await $.fs.write(`${sent}/${f.name}`, JSON.stringify({ ok: false, reason: String(err) }))
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'agent-radar',
      description: 'Open the animated pane of Claude sessions and agents by project',
    })
    void $.ui.open({ id: PANE, title: TITLE, rows: 40 })
    void scan($)
    $.clock.every(POLL_MS, () => scan($))
    $.clock.every(1500, () => relayReplies($))
    void $.session.id().then(id => $.fs.write(`${$.plugin.root}/data/relay.json`, JSON.stringify({ sessionId: id }))).catch(() => {})
    return started
  })

  on('command.run', { command: 'agent-radar' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, rows: 40 })
    void scan($)
    return { text: 'Agent Radar opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapshot)
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {snap.rows.length === 0 && <Text dimColor>Scanning…</Text>}
          {snap.rows.map(r => (
            <Text color={r.status === 'working' ? 'cyan' : r.status === 'waiting' ? 'green' : r.status === 'sleeping' ? 'blue' : 'gray'}>
              {r.status === 'working' ? '●' : r.status === 'waiting' ? '✓' : r.status === 'sleeping' ? 'z' : '○'} {r.project} · {r.title} — {r.doing}
            </Text>
          ))}
        </Box>
      )
    }
    const { Box, Svg, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button label="⛶ Open full radar in browser" onPress={() => openWebsite($)} />
          <Text dimColor>{URL_}</Text>
        </Box>
        <Svg source={drawSvg(snap)} alt={`Agent Radar: ${snap.rows.length} Claude sessions`} isInteractive={true} />
      </Box>
    )
  })
}
