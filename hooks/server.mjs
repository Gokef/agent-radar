// Serves the full-window Agent Radar page on this computer only (127.0.0.1).
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { Indexer } from './index.mjs'

const PORT = Number(process.argv[2] || 47474)
const here = dirname(fileURLToPath(import.meta.url))
// Working data lives in one fixed folder, so the mod finds it whichever copy of the
// server is running (for example the one started at login).
const DATA = join(homedir(), '.claude', 'agent-radar')
// Replies typed on the page wait here until the Claude Code mod sends them.
const OUTBOX = join(DATA, 'outbox')
const SENT = join(DATA, 'sent')
mkdirSync(OUTBOX, { recursive: true })
mkdirSync(SENT, { recursive: true })

// What "Finish work" asks the agent to do.
const FINISH_PROMPT = [
  'Agent Radar: please finish your work in this session.',
  '',
  'Do one last tidy-up check:',
  '- uncommitted or unsaved changes',
  '- leftover temporary or scratch files you created',
  '- servers, watchers or background processes you started',
  '- anything half-done',
  '',
  'Fix only small, safe things. Do not commit, push or delete anything without asking me.',
  '',
  'Then give me a short, simple report (5 bullet points at most): what you did in this session, what you tidied up, and anything left for me to decide.',
].join('\n')

// Sessions asked to finish: { [sessionId]: { at, rid, doneAt? } }, kept across restarts.
const FINISHING = join(DATA, 'finishing.json')
const loadFinishing = () => { try { return JSON.parse(readFileSync(FINISHING, 'utf8')) } catch { return {} } }
const saveFinishing = f => writeFileSync(FINISHING, JSON.stringify(f))
const sentResult = rid => { try { return JSON.parse(readFileSync(join(SENT, `${rid}.json`), 'utf8')) } catch { return null } }

// Marks rows that are finishing (working on their report) or finished (report in, asleep).
function applyFinishing(rows) {
  const fin = loadFinishing()
  let changed = false
  for (const r of rows) {
    const f = fin[r.id]
    if (!f) continue
    const sent = sentResult(f.rid)
    if (sent && !sent.ok) { delete fin[r.id]; changed = true; continue } // the request never arrived
    if (!f.doneAt && (r.messageAt ?? 0) > f.at && r.status !== 'working') { f.doneAt = r.messageAt; changed = true }
    if (f.doneAt) {
      // new work after the report wakes it up again
      if (r.status === 'working' && (r.lastAt ?? 0) > f.doneAt + 5000) { delete fin[r.id]; changed = true; continue }
      r.status = 'sleeping'
      r.finished = true
      r.reportAt = f.doneAt
      r.doing = 'finished · final report ready'
    } else {
      r.finishing = true
      if (Date.now() - f.at > 2 * 3600e3) { delete fin[r.id]; changed = true } // gave up waiting
    }
  }
  if (changed) saveFinishing(fin)
  return rows
}

const index = new Indexer()
let refreshedAt = 0
const fresh = () => {
  if (Date.now() - refreshedAt > 1000) { index.refresh(); refreshedAt = Date.now() }
  return index
}
setInterval(fresh, 2500)

const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`])
const json = (res, data, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}
const body = req => new Promise((ok, fail) => {
  let d = ''
  req.on('data', c => { d += c; if (d.length > 1e5) req.destroy() })
  req.on('end', () => { try { ok(JSON.parse(d || '{}')) } catch (e) { fail(e) } })
})

const server = createServer(async (req, res) => {
  // Only this computer's own page may talk to the server: block other sites
  // (and DNS-rebinding tricks) from reading sessions or sending replies.
  if (!HOSTS.has(req.headers.host ?? '')) return res.writeHead(403).end()
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'POST') {
    const origin = req.headers.origin ?? ''
    if (![...HOSTS].some(h => origin === `http://${h}`) || req.headers['x-radar'] !== '1') return res.writeHead(403).end()
    let data
    try { data = await body(req) } catch { return json(res, { error: 'bad json' }, 400) }

    if (url.pathname === '/reply') {
      const text = String(data.text ?? '').trim()
      if (!data.id || !text) return json(res, { error: 'missing id or text' }, 400)
      const rid = randomUUID()
      writeFileSync(join(OUTBOX, `${rid}.json`), JSON.stringify({ rid, id: String(data.id), text: text.slice(0, 4000), at: Date.now() }))
      return json(res, { rid })
    }
    if (url.pathname === '/finish') {
      const id = String(data.id ?? '')
      if (!id) return json(res, { error: 'missing id' }, 400)
      const rid = randomUUID()
      writeFileSync(join(OUTBOX, `${rid}.json`), JSON.stringify({ rid, id, text: FINISH_PROMPT, at: Date.now() }))
      const fin = loadFinishing()
      fin[id] = { at: Date.now(), rid }
      saveFinishing(fin)
      return json(res, { rid })
    }
    if (url.pathname === '/finish-cancel') {
      const fin = loadFinishing()
      delete fin[String(data.id ?? '')]
      saveFinishing(fin)
      return json(res, { ok: true })
    }
    if (url.pathname === '/open-folder') {
      const cwd = fresh().cwdOf(String(data.id ?? ''))
      if (!cwd || !existsSync(cwd)) return json(res, { error: 'folder not found' }, 404)
      spawn('explorer.exe', [cwd], { detached: true, stdio: 'ignore' }).unref()
      return json(res, { ok: true })
    }
    return res.writeHead(404).end()
  }

  switch (url.pathname) {
    case '/rows': {
      let relayId = null
      try { relayId = JSON.parse(readFileSync(join(DATA, 'relay.json'), 'utf8')).sessionId } catch {}
      return json(res, { rows: applyFinishing(fresh().rows()), relayId })
    }
    case '/summary': return json(res, fresh().summary())
    case '/timeline': return json(res, fresh().timeline(Math.min(24, Number(url.searchParams.get('h')) || 6)))
    case '/reply-status': {
      const rid = url.searchParams.get('rid') ?? ''
      const file = join(SENT, `${rid.replace(/[^a-f0-9-]/g, '')}.json`)
      if (existsSync(file)) return json(res, JSON.parse(readFileSync(file, 'utf8')))
      const waiting = existsSync(join(OUTBOX, `${rid.replace(/[^a-f0-9-]/g, '')}.json`))
      return json(res, { pending: waiting })
    }
    case '/':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(readFileSync(join(here, 'page.html')))
  }
  res.writeHead(404).end()
})

server.on('error', err => {
  // Another session already serves the radar on this port: nothing to do.
  if (err.code === 'EADDRINUSE') { console.log('already running'); process.exit(0) }
  throw err
})
server.listen(PORT, '127.0.0.1', () => console.log(`listening ${PORT}`))
