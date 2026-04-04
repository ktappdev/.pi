# 🐰 PiHack - Follow the White Rabbit

## Welcome to the Real World

```bash
# Take the red pill
source ~/.bashrc
pitrix
```

**Morpheus is waiting.**

---

## The Crew

You talk to **Morpheus** - he coordinates the operation and dispatches the specialists.

| Agent | Role | Specialty |
|-------|------|-----------|
| **Morpheus** | Commander | You talk to him, he dispatches the crew |
| **Link** | Engineer | Infrastructure, sysadmin, tool installation |
| **Keymaker** | Developer | Code specialist - builds apps, tools, features |
| **Tank** | Operator | Network mapping, reconnaissance, OSINT |
| **Trinity** | Web Infiltration | Web app testing, clean entry |
| **Neo** | The One | Exploitation, breaking systems |
| **Switch** | Security Bypass | Password cracking, authentication |
| **Dozer** | Signal Interceptor | Traffic analysis, packet capture |
| **Cypher** | Persistence | Post-exploitation, backdoors |
| **Oracle** | Domain Seer | Active Directory, attack paths |
| **Merovingian** | Reverse Engineer | Binary analysis, decompilation, finding hidden flaws |

---

## Available Teams

| Team | Members | Mission |
|------|---------|---------|
| **full-ops** | Tank, Trinity, Neo, Switch, Dozer, Cypher, Oracle, Link, Merovingian, Keymaker | Full penetration test |
| **web-audit** | Tank, Trinity, Neo, Link, Keymaker | Web application assessment |
| **network-pentest** | Tank, Dozer, Cypher, Switch, Link, Keymaker | Network infrastructure |
| **ad-assessment** | Tank, Oracle, Cypher, Switch, Link, Keymaker | Active Directory audit |
| **infra-setup** | Link, Keymaker | System configuration, tool installation, automation |
| **binary-analysis** | Merovingian, Neo, Tank, Keymaker | Reverse engineering, binary exploitation |
| **development** | Keymaker, Link | Code development, tool building, automation |

---

## Commands

### Launch
```bash
pitrix          # Enter the Matrix
main-pi         # Return to the real world (main environment)
pi-status       # Check both environments
```

### In-Session (via agent-team extension)
```bash
/agents-team        # Select your team
/agents-list        # See who's on deck
/agents-models      # Configure agent models
/agents-reset       # Reset agent context
/agents-grid N      # Set view columns (1-6)
/agents-view <mode> # grid/table/tactical view
/agents-watch [agent] # Focus on one agent
/agents-watch-off   # Return to crew view
/agents-tools       # Show each agent's tools
```

---

## Environment Comparison

| Feature | Main (main-pi) | PiHack (pitrix) |
|---------|----------------|-----------------|
| Config Dir | `~/.pi/agent` | `~/.pi/agent-pitrix` |
| Default Model | qwen3-max-2026-01-23 | claude-sonnet-4-20250514 |
| Theme | cyberpunk | dark |
| Dispatcher | Kyrie | **Morpheus** |
| Agents | Scout, Builder, etc. | **Matrix crew** |
| Sessions | 25+ | Fresh start |

---

## File Locations

```
~/.pi/agent-pitrix/
├── agents/
│   ├── kyrie.md       # Morpheus - Commander (you talk to him)
│   ├── tank.md        # Tank - Operator (recon)
│   ├── trinity.md     # Trinity - Web infiltration
│   ├── neo.md         # Neo - Exploitation (The One)
│   ├── switch.md      # Switch - Password cracking
│   ├── dozer.md       # Dozer - Traffic analysis
│   ├── cypher.md      # Cypher - Post-exploitation
│   ├── oracle.md      # Oracle - Active Directory
│   └── teams.yaml     # Team configurations
├── extensions/
│   └── agent-team.ts  # Team dispatch system
├── settings.json      # Environment config
└── bin/
    ├── pitrix         # Launch script
    └── pi-status      # Status checker
```

---

## Mission Examples

### Web Application Audit
```bash
pitrix
/agents-team web-audit
```

Morpheus will deploy:
- **Tank** - Find web assets, subdomains
- **Trinity** - Scan for vulnerabilities, SQLi, XSS
- **Neo** - Exploit critical findings

### Full Network Penetration Test
```bash
pitrix
/agents-team full-ops
```

Morpheus coordinates the full crew through:
1. Reconnaissance → 2. Web testing → 3. Exploitation → 4. Credential attacks → 5. Traffic analysis → 6. Persistence → 7. Domain dominance

### Active Directory Assessment
```bash
pitrix
/agents-team ad-assessment
```

Morpheus deploys:
- **Tank** - Enumerate domain structure
- **Oracle** - BloodHound, Kerberoasting, attack paths
- **Cypher** - Lateral movement, persistence
- **Switch** - Crack service account passwords

---

## The Operation Flow

```
YOU → Morpheus → Specialist Agents
       ↓
  [Receives your mission]
       ↓
  [Dispatches Tank for recon]
       ↓
  [Reviews Tank's findings]
       ↓
  [Dispatches Trinity for web testing]
       ↓
  [Synthesizes all results]
       ↓
  [Reports back to you]
```

### Example Mission

```
You: "Assess 192.168.1.50"

Morpheus: "Welcome to the real world. Tank, map the target."
          [dispatches Tank]
          
          "Tank reports ports 22, 80, 443. Trinity, infiltrate the web apps."
          [dispatches Trinity]
          
          "SQL injection confirmed. Neo, break through."
          [dispatches Neo]
          
          "Shell obtained. Cypher, ensure we stay."
          [dispatches Cypher]
          
          "Mission complete. The Matrix has been freed."
```

---

## Customization

### Add New Crew Members
Create `.md` files in `~/.pi/agent-pitrix/agents/`:
```markdown
---
name: AgentName
role: Their specialty
description: What they do
tools: read,bash
---

# Agent instructions with Matrix flavor...
```

### Modify Teams
Edit `~/.pi/agent-pitrix/agents/teams.yaml`:
```yaml
my-mission:
  - Tank
  - Neo
  - Oracle
```

---

## The Rules

1. **Authorization** - Only test systems you own or have permission to test
2. **Stay focused** - One mission at a time
3. **Clean ops** - The crew comes home safe
4. **Free minds** - Use this for good

---

## Status: ONLINE

**The Matrix has you...**

**But we can free it.**

**What is your mission?**

🐰 *Follow the white rabbit.*
