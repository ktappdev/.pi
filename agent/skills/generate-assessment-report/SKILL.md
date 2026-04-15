---
name: generate-assessment-report
description: Generates comprehensive HTML assessment reports analyzing any topic (project state, code quality, blocked work, security, etc.). Produces single navigable HTML file with executive summary, detailed sections, status indicators, and actionable recommendations. Use when user needs a shareable, visual assessment document.
---

# Assessment Report Generator

Generates professional HTML assessment reports for any topic. Single file, embedded CSS, mobile-responsive, with sticky navigation and clear action items.

## When To Use

User asks for assessment/analysis of anything:
- "What can we work on while X is blocked?"
- "Assess the current state of..."
- "How's the auth system looking?"
- "Security assessment for the API"
- "Create a status report"
- "Analyze what's ready vs. what's missing"

## Execution Flow

### 1. Understand Scope
Ask clarifying questions if needed:
- What specifically should be assessed?
- Any particular concerns or focus areas?
- Preferred output location? (default: `~/html-docs/`)

### 2. Gather Data
Based on assessment topic, collect relevant info:
- **Tasks/backlog**: `bd list --json`, issue trackers, TODOs
- **Code quality**: Scan source files, check tests, linting
- **Security**: Review auth, validation, secrets, endpoints
- **Project state**: Directory structure, README, docs, completion %
- **Feature readiness**: Check implementations, tests, integration

### 3. Analyze & Categorize
- Identify what's complete/ready ✅
- Identify what's blocked/missing ❌
- Identify partial/in-progress ⚠️
- Map dependencies and blockers
- Determine what can proceed independently

### 4. Create Output Directory
```bash
mkdir -p ~/html-docs  # or user-specified location
```

### 5. Generate HTML Report
Write single HTML file with:
- Embedded CSS (no external dependencies)
- Sticky navigation bar
- Executive summary with metric cards
- Detailed sections with anchor links
- Status badges (✅/❌/⚠️)
- Prioritized recommendations
- Generation timestamp

### 6. Confirm & Attach
- Confirm file created with path
- Provide 2-3 line summary in chat
- If Telegram user: attach HTML file

## HTML Template

Use this template structure. Populate with real data.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f5f7fa; }
        .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
        header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 40px 20px; border-radius: 12px; margin-bottom: 30px; }
        header h1 { font-size: 2.2rem; margin-bottom: 8px; }
        header .subtitle { opacity: 0.9; font-size: 1.1rem; }
        header .meta { margin-top: 15px; font-size: 0.9rem; opacity: 0.8; }
        nav { position: sticky; top: 0; background: white; padding: 15px 20px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 30px; z-index: 100; }
        nav ul { list-style: none; display: flex; gap: 20px; flex-wrap: wrap; }
        nav a { color: #1e3a5f; text-decoration: none; font-weight: 500; padding: 5px 10px; border-radius: 5px; transition: background 0.2s; }
        nav a:hover { background: #e8f0f8; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); text-align: center; }
        .metric-value { font-size: 2.5rem; font-weight: 700; color: #1e3a5f; }
        .metric-label { color: #666; margin-top: 5px; font-size: 0.95rem; }
        .summary-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .summary-box h3 { color: #856404; margin-bottom: 10px; }
        section { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); margin-bottom: 25px; }
        section h2 { color: #1e3a5f; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e8f0f8; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; margin-right: 8px; }
        .status-ready { background: #d4edda; color: #155724; }
        .status-blocked { background: #f8d7da; color: #721c24; }
        .status-partial { background: #fff3cd; color: #856404; }
        .item-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
        .item-card h4 { margin-bottom: 8px; color: #1e3a5f; }
        .item-card p { color: #555; font-size: 0.95rem; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e0e0e0; }
        th { background: #f8f9fa; color: #1e3a5f; font-weight: 600; }
        tr:hover { background: #f8f9fa; }
        .recommendations { background: #e8f4f8; border-left: 4px solid #1e3a5f; }
        .recommendations li { margin-bottom: 12px; padding-left: 10px; }
        footer { text-align: center; padding: 30px; color: #666; font-size: 0.9rem; }
        @media (max-width: 768px) {
            .container { padding: 15px; }
            header h1 { font-size: 1.6rem; }
            nav ul { gap: 10px; }
            .metrics { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>{{TITLE}}</h1>
            <p class="subtitle">{{SUBTITLE}}</p>
            <p class="meta">Generated: {{DATE}}</p>
        </header>

        <nav>
            <ul>
                <li><a href="#summary">Summary</a></li>
                <li><a href="#findings">Findings</a></li>
                <li><a href="#details">Details</a></li>
                <li><a href="#recommendations">Recommendations</a></li>
            </ul>
        </nav>

        <section id="summary">
            <h2>Executive Summary</h2>
            <div class="metrics">
                {{METRIC_CARDS}}
            </div>
            <div class="summary-box">
                <h3>Bottom Line</h3>
                <p>{{BOTTOM_LINE}}</p>
            </div>
            <h3>Key Findings</h3>
            <ul>
                {{KEY_FINDINGS}}
            </ul>
        </section>

        <section id="findings">
            <h2>Assessment Findings</h2>
            {{FINDINGS_CONTENT}}
        </section>

        <section id="details">
            <h2>Detailed Breakdown</h2>
            {{DETAILS_CONTENT}}
        </section>

        <section id="recommendations" class="recommendations">
            <h2>Recommendations</h2>
            {{RECOMMENDATIONS}}
        </section>

        <footer>
            <p>Assessment generated by Pi Agent Skill: generate-assessment-report</p>
            <p>{{DATE}}</p>
        </footer>
    </div>
</body>
</html>
```

## Template Variables

Replace these placeholders with actual data:

| Variable | Description |
|----------|-------------|
| `{{TITLE}}` | Assessment title (e.g., "Blocked Tasks Assessment") |
| `{{SUBTITLE}}` | Brief description (e.g., "What can proceed vs. what's blocked") |
| `{{DATE}}` | Generation timestamp |
| `{{METRIC_CARDS}}` | 3-5 metric card HTML blocks |
| `{{BOTTOM_LINE}}` | One-sentence takeaway |
| `{{KEY_FINDINGS}}` | 3-5 bullet points |
| `{{FINDINGS_CONTENT}}` | Main findings (tables, cards, lists) |
| `{{DETAILS_CONTENT}}` | Detailed breakdown by category |
| `{{RECOMMENDATIONS}}` | Prioritized action items as `<li>` elements |

## Metric Card Template

```html
<div class="metric-card">
    <div class="metric-value">12</div>
    <div class="metric-label">Total Items</div>
</div>
```

## Status Badge Classes

- `.status-ready` - Green (can proceed)
- `.status-blocked` - Red (blocked/missing)
- `.status-partial` - Yellow (in-progress/partial)

## Success Criteria

1. ✅ Single HTML file created (no external dependencies)
2. ✅ All template variables populated with real data
3. ✅ Navigation works (anchor links functional)
4. ✅ Mobile-responsive design
5. ✅ Clear bottom line in executive summary
6. ✅ Prioritized, actionable recommendations

## Tips

- **Lead with bottom line** - Busy stakeholders need TL;DR first
- **Use visual indicators** - Status badges make scanning easy
- **Keep it scannable** - Short paragraphs, bullets, tables
- **Date everything** - Include generation timestamp
- **Actionable ending** - Always end with clear next steps
- **One file** - Embedded CSS, no external assets

## Example Usage

**User:** "Can you assess what we can work on while the payment system isn't ready?"

**Agent:** *Gathers task data, analyzes dependencies, identifies independent work*

**Agent:** "Done! Created assessment at `~/html-docs/blocked-tasks-2026-04-15.html`

**Quick Summary:**
- 5 tasks blocked (payment-related)
- 8 tasks can proceed independently
- Frontend/backend work not dependent on payment integration

Full HTML report has detailed breakdown and recommendations."

*[Attaches HTML if Telegram user]*
