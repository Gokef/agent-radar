# Agent Radar

A live, animated view of every Claude Code session on your computer, drawn as a neural network.

- **Project hubs:** each project is a big glowing neuron, with a gold ring showing how much its sessions have cost.
- **Tool stations:** Thinking, Reading, Editing, Terminal, Web, Browser, Agents, Working (planning and task updates) and Tools. The station an agent is using lights up and streams down to its project.
- **Themes** (switch in the header, remembered):
  - **Solar:** each project is a small solar system with one planet per kind of tool. Agents rest by their sun and hop to the planet of the tool they are using, so they never leave their project.
  - **Network:** the neural network, with agents travelling to the shared tool stations.
  - **Simple:** a calm board of project panels listing each agent, its tool and what it is doing.
- **States:** working (cyan), done (a green ✓, bright until you open it), idle, and asleep (after 15 quiet minutes it curls up at its hub with a floating "z z z").
- **Subagents:** purple dots that go to their own stations.
- **Files:** the files each project's agents touched orbit its hub and flash when edited.
- **Click an agent** for its cost, tokens, lines changed and files, plus a reply box, Open folder, and a copyable `claude --resume` command.
- **🏁 Finish work** (in an agent's details): asks it to do a last tidy-up check (uncommitted changes, temp files, servers it started, anything half-done), fix only small safe things without committing, pushing or deleting, and give a short report. It shows as Finishing, then goes to sleep with its **Final report** in the drawer. New work wakes it up again.
- **Done:** when an agent finishes, a green **✓ DONE** sign appears over it and on its row in the agent list, and the header counts finished agents. Click it to see the **full message** and reply. Turn on Alerts for a chime and a system notification; the Claude app also shows a toast.
- **Reply from the overlay:** goes straight into that session. Only sessions open right now can get a reply; closed ones say so. **Open in Claude** jumps straight to that session in the app. Replies sent by the mod are blocked when the session running the radar is in auto mode; use Open in Claude there.
- **Timeline:** activity bars for the last 6 hours. Drag or press Replay to watch the day back.
- **Today:** agent time, spend, steps, tool mix, time per project and most-edited files.
- **Mini:** a small always-on-top window with a live thumbnail and the same reply cards (Chrome or Edge).
- **Size:** A− / A+ scale the whole overlay (starts at 130%).

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
