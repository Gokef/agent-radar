export type AgentRow = {
  id: string
  title: string
  task: string
  project: string
  cwd: string
  status: 'working' | 'waiting' | 'idle' | 'sleeping'
  doing: string
  ago: string
  subagents: { name: string; doing: string; isActive: boolean }[]
}

export type Snapshot = {
  rows: AgentRow[]
  error?: string
  scannedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': { snapshot: Snapshot }
  }
}
