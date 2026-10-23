// Reads the session logs under ~/.claude/projects and prints a JSON summary
// of every recently active Claude session: its project, status and latest step.
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'

const ROOT = join(homedir(), '.claude', 'projects')
const WINDOW_MS = 6 * 60 * 60 * 1000 // show sessions touched in the last 6 hours
const WORKING_MS = 75 * 1000 // a log written this recently means the agent is busy
const SLEEP_MS = 15 * 60 * 1000 // no activity this long: the agent is asleep
const TAIL_BYTES = 384 * 1024
let now = Date.now()

const tail = path => {
  const size = statSync(path).size
  const start = Math.max(0, size - TAIL_BYTES)
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(size - start)
  readSync(fd, buf, 0, buf.length, start)
  closeSync(fd)
  const lines = buf.toString('utf8').split('\n')
  if (start > 0) lines.shift() // first line is probably cut
  const out = []
  for (const line of lines) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

const prettyTool = name =>
  name.startsWith('mcp__')
    ? name.split('__').slice(-1)[0].replace(/^browser_/, 'browser ')
    : name

const describeTool = (name, input = {}) => {
  const target =
    input.description ||
    (input.file_path && basename(String(input.file_path))) ||
    (input.path && basename(String(input.path))) ||
    input.command ||
    input.pattern ||
    input.url ||
    input.query ||
    input.prompt ||
    input.action ||
    ''
  return clip(`${prettyTool(name)}${target ? ' · ' + target : ''}`, 90)
}

const ago = ms => {
  const s = Math.round(ms / 1000)
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

const headCwd = path => {
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(64 * 1024)
  const n = readSync(fd, buf, 0, buf.length, 0)
  closeSync(fd)
  const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.)*)"/)
  try { return m ? JSON.parse(`"${m[1]}"`) : '' } catch { return '' }
}

const summarize = entries => {
  let title = '', lastPrompt = '', cwd = '', doing = '', isEndTurn = false, lastTs = 0
  for (const e of entries) {
    // Real conversation events carry a timestamp; bookkeeping lines don't.
    const t = e.timestamp ? Date.parse(e.timestamp) : 0
    if (t > lastTs) lastTs = t
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (!title && e.type === 'custom-title') title = e.customTitle
    if (!title && e.type === 'agent-name') title = e.agentName
    if (!lastPrompt && e.type === 'last-prompt') lastPrompt = e.lastPrompt
    if (!cwd && e.cwd) cwd = e.cwd
    const msg = e.message
    if (!doing && msg && Array.isArray(msg.content)) {
      if (msg.role === 'assistant') {
        const tool = [...msg.content].reverse().find(c => c.type === 'tool_use')
        const text = [...msg.content].reverse().find(c => c.type === 'text' && c.text?.trim())
        if (tool) doing = describeTool(tool.name, tool.input)
        else if (text) {
          doing = clip(text.text, 90)
          isEndTurn = msg.stop_reason === 'end_turn'
        }
      } else if (msg.role === 'user') {
        const text = msg.content.find(c => c.type === 'text' && c.text && !c.text.startsWith('<'))
        if (text && !lastPrompt) lastPrompt = text.text
      }
    }
    if (title && lastPrompt && cwd && doing) break
  }
  return { title, lastPrompt, cwd, doing, isEndTurn, lastTs }
}

const projectName = cwd => {
  if (!cwd) return 'Unknown'
  if (/scratch-workspaces|scratch-\d{4}/i.test(cwd)) return 'No folder'
  return basename(cwd.replace(/[\\/]+$/, '')) || cwd
}

export const scanRows = () => {
now = Date.now()
const rows = []
for (const dir of existsSync(ROOT) ? readdirSync(ROOT) : []) {
  const full = join(ROOT, dir)
  let files
  try { files = readdirSync(full) } catch { continue }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue
    const path = join(full, f)
    let st
    try { st = statSync(path) } catch { continue }
    if (now - st.mtimeMs > WINDOW_MS) continue
    let s
    try { s = summarize(tail(path)) } catch { continue }
    const lastAt = s.lastTs || st.mtimeMs
    const age = now - lastAt
    if (age > WINDOW_MS) continue
    const startCwd = headCwd(path) || s.cwd
    const id = f.replace(/\.jsonl$/, '')

    // Subagents, when this build keeps their logs beside the session.
    const subagents = []
    const subDir = join(full, id, 'subagents')
    if (existsSync(subDir)) {
      for (const sf of readdirSync(subDir)) {
        if (!sf.endsWith('.jsonl')) continue
        const sp = join(subDir, sf)
        const sst = statSync(sp)
        if (now - sst.mtimeMs > 15 * 60 * 1000) continue
        let ss
        try { ss = summarize(tail(sp)) } catch { continue }
        const subAge = now - (ss.lastTs || sst.mtimeMs)
        if (subAge > 15 * 60 * 1000) continue
        subagents.push({
          name: clip(ss.title || sf.replace(/\.jsonl$/, '').replace(/^agent-/, 'agent '), 28),
          doing: ss.doing || 'starting…',
          isActive: subAge < WORKING_MS,
        })
      }
    }

    const isBusy = age < WORKING_MS && !s.isEndTurn
    rows.push({
      id,
      title: clip(s.title || s.lastPrompt || 'Untitled session', 40),
      task: clip(s.lastPrompt, 80),
      project: projectName(startCwd),
      cwd: startCwd,
      status: isBusy || subagents.some(a => a.isActive)
        ? 'working'
        : age > SLEEP_MS
          ? 'sleeping'
          : s.isEndTurn
            ? 'waiting'
            : 'idle',
      doing: s.doing || '—',
      ago: ago(age),
      mtime: lastAt,
      subagents,
    })
  }
}

const rank = { working: 0, waiting: 1, idle: 2, sleeping: 3 }
rows.sort((a, b) => rank[a.status] - rank[b.status] || b.mtime - a.mtime)
return rows.slice(0, 24)
}

// Run directly (`node scan.mjs`): print the first 12 as JSON for the pane.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(scanRows().slice(0, 12)))
}
