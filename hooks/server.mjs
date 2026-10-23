// Serves the full-window Agent Radar page on this computer only (127.0.0.1).
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Indexer } from './index.mjs'

const PORT = Number(process.argv[2] || 47474)
const here = dirname(fileURLToPath(import.meta.url))
// Replies typed on the page wait here until the Claude Code mod sends them.
const OUTBOX = join(here, '..', 'data', 'outbox')
const SENT = join(here, '..', 'data', 'sent')
mkdirSync(OUTBOX, { recursive: true })
mkdirSync(SENT, { recursive: true })

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
    if (url.pathname === '/open-folder') {
      const cwd = fresh().cwdOf(String(data.id ?? ''))
      if (!cwd || !existsSync(cwd)) return json(res, { error: 'folder not found' }, 404)
      spawn('explorer.exe', [cwd], { detached: true, stdio: 'ignore' }).unref()
      return json(res, { ok: true })
    }
    return res.writeHead(404).end()
  }

  switch (url.pathname) {
    case '/rows': return json(res, { rows: fresh().rows() })
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
