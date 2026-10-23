# Agent Radar

A live, animated view of every Claude Code session on your computer, drawn as a neural network.

- **Project hubs:** each project is a big glowing neuron, with a gold ring showing how much its sessions have cost.
- **Tool stations:** Thinking, Reading, Editing, Terminal, Web, Browser, Agents and Tools. A working agent flies to the station for whatever it is doing, with a swarm of dots and a trail behind it.
- **States:** working (cyan), waiting on you (amber pulse), idle, and asleep (after 15 quiet minutes it curls up at its hub with a floating "z z z").
- **Subagents:** purple dots that go to their own stations.
- **Files:** the files each project's agents touched orbit its hub and flash when edited.
- **Click an agent** for its cost, tokens, lines changed and files, plus a reply box, Open folder, and a copyable `claude --resume` command.
- **Alerts:** a chime and a desktop notification when an agent starts waiting on you.
- **Timeline:** activity bars for the last 6 hours. Drag or press Replay to watch the day back.
- **Today:** agent time, spend, steps, tool mix, time per project and most-edited files.
- **Mini:** a small always-on-top window with a live thumbnail (Chrome or Edge).

It reads the session logs Claude Code keeps under `~/.claude/projects`. Nothing leaves your computer: the page is served on `127.0.0.1` only.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-radar --marketplace Gokef/agent-radar
```

Answer `y` to add the marketplace, then pick a scope. The repository is private, so you need access to it and GitHub set up on your computer.

## Use

- In Claude Code, the **Agent Radar** pane opens by itself. `/agent-radar` reopens it. Press **Open full radar in browser** for the full view.
- Or run the page directly (needs Node.js) and open http://localhost:47474. Press F11 for fullscreen.

```
node hooks/server.mjs
```

Replies typed on the page are sent by the mod, so they work while a Claude Code session with the mod turned on is open.
