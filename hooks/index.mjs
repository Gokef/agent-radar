// Keeps a running index of every Claude session log under ~/.claude/projects.
// Each file is read once in full, then only the new bytes on each refresh, so
// the radar can show today's stats and replay the last hours cheaply.
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'

const ROOT = join(homedir(), '.claude', 'projects')
const KEEP_MS = 36 * 3600e3      // files and events older than this are ignored
const SHOW_MS = 6 * 3600e3       // sessions shown on the radar
const WORKING_MS = 75e3          // activity this recent: working
const SLEEP_MS = 15 * 60e3       // quiet this long: asleep
const CHUNK = 8 * 1024 * 1024

export const category = name => {
  if (/^(Read|Glob|Grep|LS|NotebookRead)$/.test(name)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'edit'
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$|^mcp__terminal__/.test(name)) return 'bash'
  // planning, task lists, questions and hand-offs: the agent working on the project itself
  if (/^(TodoWrite|Task(Create|Update|List|Get|Stop)|AskUserQuestion|EnterPlanMode|ExitPlanMode|Skill|ToolSearch|SendUserFile|PushNotification|Artifact|ScheduleWakeup)$|^mcp__ccd_(turn|session)__|^mcp__1a59c906-/.test(name)) return 'work'
  if (/^(WebFetch|WebSearch)$/.test(name)) return 'web'
  if (/Browser|chrome|preview_/.test(name)) return 'browser'
  if (/^(Agent|Task|SendMessage)$|start_session/.test(name)) return 'agent'
  return 'other'
}

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
const prettyTool = name =>
  name.startsWith('mcp__') ? name.split('__').slice(-1)[0].replace(/^browser_/, 'browser ') : name
const describeTool = (name, input = {}) => {
  const target =
    input.description ||
    (input.file_path && basename(String(input.file_path))) ||
    (input.path && basename(String(input.path))) ||
    input.command || input.pattern || input.url || input.query || input.prompt || input.action || ''
  return clip(`${prettyTool(name)}${target ? ' · ' + target : ''}`, 90)
}
const ago = ms => {
  const s = Math.round(ms / 1000)
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}
const projectName = cwd => {
  if (!cwd) return 'Unknown'
  if (/scratch-workspaces|scratch-\d{4}/i.test(cwd)) return 'No folder'
  return basename(cwd.replace(/[\\/]+$/, '')) || cwd
}

const newState = (id, path, parent) => ({
  id, path, parent, offset: 0, rest: '', cwd: '', title: '', lastPrompt: '', lastTs: 0,
  doing: '', tool: 'other', isEndTurn: false, cost: 0, tokensOut: 0, tokensIn: 0,
  linesAdded: 0, linesRemoved: 0, files: new Map(), events: [], mtime: 0,
})

function ingest(s, e) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : 0
  if (ts > s.lastTs) s.lastTs = ts
  if (e.cwd && !s.cwd) s.cwd = e.cwd
  switch (e.type) {
    case 'custom-title': s.title = e.customTitle; return
    case 'agent-name': if (!s.title) s.title = e.agentName; return
    case 'last-prompt': s.lastPrompt = e.lastPrompt; return
    case 'cost-state': {
      s.cost = e.totalCostUSD ?? s.cost
      s.linesAdded = e.totalLinesAdded ?? s.linesAdded
      s.linesRemoved = e.totalLinesRemoved ?? s.linesRemoved
      let tin = 0, tout = 0
      for (const u of Object.values(e.modelUsage ?? {})) {
        tin += (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0) + (u.cacheReadInputTokens ?? 0)
        tout += u.outputTokens ?? 0
      }
      s.tokensIn = tin; s.tokensOut = tout
      return
    }
  }
  const msg = e.message
  if (!msg || !Array.isArray(msg.content) || !ts) return
  if (msg.role === 'assistant') {
    for (const c of msg.content) {
      if (c.type === 'tool_use') {
        const cat = category(c.name)
        const desc = describeTool(c.name, c.input)
        s.events.push([ts, cat, desc, 0])
        s.doing = desc; s.tool = cat; s.isEndTurn = false
        const fp = c.input?.file_path || c.input?.notebook_path
        if (fp && (cat === 'edit' || cat === 'read')) {
          const prev = s.files.get(fp)
          s.files.set(fp, { ts, op: cat === 'edit' || prev?.op === 'edit' ? 'edit' : 'read', n: (prev?.n ?? 0) + 1, editsToday: (prev?.editsToday ?? 0) + (cat === 'edit' ? 1 : 0) })
        }
      } else if (c.type === 'text' && c.text?.trim()) {
        const end = msg.stop_reason === 'end_turn' ? 1 : 0
        const desc = clip(c.text, 90)
        s.events.push([ts, 'think', desc, end])
        s.doing = desc; s.tool = 'think'; s.isEndTurn = !!end
      }
    }
  } else if (msg.role === 'user') {
    const t = msg.content.find(c => c.type === 'text' && c.text && !c.text.startsWith('<'))
    if (t) {
      s.events.push([ts, 'user', clip(t.text, 90), 0])
      s.isEndTurn = false
      if (!s.lastPrompt) s.lastPrompt = clip(t.text, 200)
    }
  }
}

function readNew(s) {
  const size = statSync(s.path).size
  if (size < s.offset) { Object.assign(s, newState(s.id, s.path, s.parent)) } // file was rewritten
  if (size === s.offset) return
  const fd = openSync(s.path, 'r')
  try {
    while (s.offset < size) {
      const len = Math.min(CHUNK, size - s.offset)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, s.offset)
      s.offset += len
      const lines = (s.rest + buf.toString('utf8')).split('\n')
      s.rest = lines.pop() ?? ''
      for (const line of lines) {
        if (!line || line.length > 2e6) continue
        // skip huge request blobs quickly
        if (line.startsWith('{"type":"api-request')) continue
        try { ingest(s, JSON.parse(line)) } catch {}
      }
    }
  } finally { closeSync(fd) }
  const cutoff = Date.now() - KEEP_MS
  if (s.events.length && s.events[0][0] < cutoff) s.events = s.events.filter(ev => ev[0] >= cutoff)
}

export class Indexer {
  sessions = new Map() // path -> state

  refresh() {
    const now = Date.now()
    if (!existsSync(ROOT)) return
    for (const dir of readdirSync(ROOT)) {
      const full = join(ROOT, dir)
      let files
      try { files = readdirSync(full) } catch { continue }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        const id = f.slice(0, -6)
        this.#touch(join(full, f), id, undefined, now)
        const subDir = join(full, id, 'subagents')
        if (existsSync(subDir)) {
          for (const sf of readdirSync(subDir)) {
            if (sf.endsWith('.jsonl')) this.#touch(join(subDir, sf), sf.slice(0, -6), id, now)
          }
        }
      }
    }
  }

  #touch(path, id, parent, now) {
    let st
    try { st = statSync(path) } catch { return }
    if (now - st.mtimeMs > KEEP_MS) { this.sessions.delete(path); return }
    let s = this.sessions.get(path)
    if (!s) { s = newState(id, path, parent); this.sessions.set(path, s) }
    if (st.mtimeMs === s.mtime && st.size === s.offset) return
    s.mtime = st.mtimeMs
    try { readNew(s) } catch {}
  }

  #status(s, at = Date.now()) {
    const age = at - (s.lastTs || s.mtime)
    if (age < WORKING_MS && !s.isEndTurn) return 'working'
    if (age > SLEEP_MS) return 'sleeping'
    return s.isEndTurn ? 'waiting' : 'idle'
  }

  rows() {
    const now = Date.now()
    const all = [...this.sessions.values()]
    const rows = []
    for (const s of all) {
      if (s.parent) continue
      const lastAt = s.lastTs || s.mtime
      if (now - lastAt > SHOW_MS) continue
      const subagents = all
        .filter(c => c.parent === s.id && now - (c.lastTs || c.mtime) < 15 * 60e3)
        .map(c => ({
          name: clip(c.title || c.id.replace(/^agent-/, 'agent '), 28),
          doing: c.doing || 'starting…',
          tool: c.tool,
          isActive: now - (c.lastTs || c.mtime) < WORKING_MS,
        }))
      let status = this.#status(s, now)
      if (status !== 'working' && subagents.some(a => a.isActive)) status = 'working'
      const files = [...s.files.entries()]
        .sort((a, b) => b[1].ts - a[1].ts)
        .slice(0, 6)
        .map(([path, f]) => ({ name: basename(path), path, op: f.op, ageS: Math.round((now - f.ts) / 1000) }))
      rows.push({
        id: s.id,
        title: clip(s.title || s.lastPrompt || 'Untitled session', 40),
        task: clip(s.lastPrompt, 120),
        project: projectName(s.cwd),
        cwd: s.cwd,
        status,
        doing: s.doing || '—',
        tool: s.tool,
        ago: ago(now - lastAt),
        lastAt,
        cost: Math.round(s.cost * 100) / 100,
        tokensOut: s.tokensOut,
        tokensIn: s.tokensIn,
        linesAdded: s.linesAdded,
        linesRemoved: s.linesRemoved,
        files,
        subagents,
      })
    }
    const rank = { working: 0, waiting: 1, idle: 2, sleeping: 3 }
    rows.sort((a, b) => rank[a.status] - rank[b.status] || b.lastAt - a.lastAt)
    return rows.slice(0, 24)
  }

  // Today's numbers, from local midnight.
  summary() {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const since = d.getTime()
    const tools = {}, projects = {}, fileEdits = new Map()
    let activeMs = 0, sessions = 0, cost = 0, linesAdded = 0, linesRemoved = 0, events = 0
    for (const s of this.sessions.values()) {
      const evs = s.events.filter(e => e[0] >= since)
      if (!evs.length) continue
      events += evs.length
      let ms = 0
      for (let i = 0; i < evs.length; i++) {
        tools[evs[i][1]] = (tools[evs[i][1]] ?? 0) + 1
        const gap = i ? evs[i][0] - evs[i - 1][0] : 0
        ms += gap > 0 && gap < 5 * 60e3 ? gap : 20e3
      }
      if (!s.parent) {
        sessions++
        cost += s.cost; linesAdded += s.linesAdded; linesRemoved += s.linesRemoved
        activeMs += ms
        const p = projectName(s.cwd)
        projects[p] ??= { minutes: 0, cost: 0, sessions: 0 }
        projects[p].minutes += ms / 60e3; projects[p].cost += s.cost; projects[p].sessions++
      }
      for (const [path, f] of s.files) if (f.ts >= since && f.op === 'edit') fileEdits.set(path, (fileEdits.get(path) ?? 0) + f.n)
    }
    const topFiles = [...fileEdits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ name: basename(p), path: p, n }))
    for (const p of Object.values(projects)) { p.minutes = Math.round(p.minutes); p.cost = Math.round(p.cost * 100) / 100 }
    const busiest = Object.entries(projects).sort((a, b) => b[1].minutes - a[1].minutes)[0]?.[0] ?? null
    return {
      activeMinutes: Math.round(activeMs / 60e3), sessions, events, cost: Math.round(cost * 100) / 100,
      linesAdded, linesRemoved, tools, projects, busiest, topFiles, filesChanged: fileEdits.size,
    }
  }

  // Every event of the last `hours`, for the replay scrubber.
  timeline(hours = 6) {
    const since = Date.now() - hours * 3600e3
    const out = []
    for (const s of this.sessions.values()) {
      if (s.parent) continue
      const events = s.events.filter(e => e[0] >= since)
      if (!events.length) continue
      out.push({ id: s.id, title: clip(s.title || s.lastPrompt || 'Untitled session', 40), project: projectName(s.cwd), events })
    }
    return { from: since, to: Date.now(), sessions: out }
  }

  cwdOf(id) {
    for (const s of this.sessions.values()) if (s.id === id) return s.cwd
    return ''
  }
}
