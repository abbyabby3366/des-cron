---
name: page-agent-bridge
description: >
  Send UI/UX testing tasks to PageAgent running in the des-cron dashboard browser tab.
  PageAgent is an AI that visually interacts with the page like a human — clicking buttons,
  reading text, navigating tabs — and reports findings. Use this to test UI/UX quality,
  check layouts, verify interactions, and capture screenshots. Trigger on: 'test the UI',
  'check the dashboard', 'take a screenshot', 'visual test', 'page agent', 'UI/UX test',
  'check if the button works', 'does the layout look correct'.
---

# PageAgent Bridge Skill

Use this skill to send tasks to PageAgent (an AI GUI agent running in the user's browser)
and receive results + screenshots back.

## Prerequisites

1. The `des-cron` dev server must be running (`npm run dev` in `c:\Users\desmo\Desktop\des-cron`)
2. The user must have the dashboard open in their browser at `http://localhost:3000`
3. The **Page Agent toggle** in the sidebar footer must be **ON** (green dot)

If the user hasn't toggled PageAgent ON, remind them to do so before proceeding.

## Available Commands

### 1. Send a Task to PageAgent

Submit a natural language task for PageAgent to execute in the browser:

**Bash/macOS/Linux:**
```bash
curl -s -X POST http://localhost:3000/api/page-agent/execute -H "Content-Type: application/json" -d "{\"task\": \"YOUR_TASK_HERE\", \"includeScreenshot\": true}"
```

**Windows PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/page-agent/execute" -Method Post -ContentType "application/json" -Body '{"task": "YOUR_TASK_HERE", "includeScreenshot": true}'
```

Returns: `{ "taskId": "pa_1_...", "status": "pending" }`

**includeScreenshot** (default: true) — set to false if you only want text results.

### 2. Check Task Result

Poll until status is "completed":

**Bash/macOS/Linux:**
```bash
curl -s http://localhost:3000/api/page-agent/result/TASK_ID
```

**Windows PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/page-agent/result/TASK_ID"
```

Returns:
```json
{
  "taskId": "pa_1_...",
  "task": "...",
  "status": "completed",
  "result": "PageAgent's text output...",
  "screenshotPath": "c:\\Users\\desmo\\Desktop\\des-cron\\public\\screenshots\\pa_1_....png",
  "createdAt": 1751...,
  "completedAt": 1751...
}
```

When `status` is `"completed"`, read the `result` field for PageAgent's findings.
If `screenshotPath` is not null, use `view_file` to see the screenshot.

### 3. Take a Screenshot (No Task)

Capture the current state of the dashboard without running any PageAgent task:

**Bash/macOS/Linux:**
```bash
curl -s -X POST http://localhost:3000/api/page-agent/screenshot
```

**Windows PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/page-agent/screenshot" -Method Post
```

Returns a taskId. Poll the result endpoint to get the screenshot path once captured.

### 4. List All Tasks

**Bash/macOS/Linux:**
```bash
curl -s http://localhost:3000/api/page-agent/tasks
```

**Windows PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/page-agent/tasks"
```

## Workflow

1. **Submit** a task with `curl POST /api/page-agent/execute`
2. **Wait** ~5-30 seconds for PageAgent to execute (it interacts with the DOM in real-time)
3. **Poll** `GET /api/page-agent/result/:taskId` until `status === "completed"`
4. **Read** the `result` text for AI findings
5. **View** the `screenshotPath` with `view_file` to see the visual state
6. **Act** on the findings — fix code issues in the codebase using your normal tools

## Example Tasks

| Goal | Task String |
|------|-------------|
| General UI check | `"Navigate to every tab in the sidebar and report any visual issues you see"` |
| Test a form | `"Click the Add Job button, check if the dialog opens correctly"` |
| Layout check | `"Check if any text is overlapping or cut off on the Dashboard tab"` |
| Mobile test | `"Report the current layout — are elements properly aligned?"` |
| Button test | `"Click the Settings tab, then check if all buttons are visible and clickable"` |
| Color/theme | `"Check if the color scheme is consistent across all tabs"` |

## Important Notes

- PageAgent uses a **free demo LLM** — it may be slow (5-30s per task) and occasionally fail
- Each task is **stateless** — PageAgent has no memory of previous tasks
- Screenshots are saved to `c:\Users\desmo\Desktop\des-cron\public\screenshots\`
- The bridge only works when PageAgent is toggled ON in the browser
- If a task times out (2 min), it will report whatever partial results are available
- Results include the last 5 history items from PageAgent's execution log
