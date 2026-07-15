import express from 'express';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const pageAgentTasks = new Map();
let pageAgentTaskCounter = 0;

const screenshotsDir = path.resolve(process.cwd(), 'public', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

router.post('/execute', (req, res) => {
  const { task, includeScreenshot } = req.body;
  if (!task) return res.status(400).json({ error: 'task is required' });

  const taskId = `pa_${++pageAgentTaskCounter}_${Date.now()}`;
  pageAgentTasks.set(taskId, {
    taskId,
    task,
    includeScreenshot: includeScreenshot !== false,
    status: 'pending',
    result: null,
    screenshotPath: null,
    createdAt: Date.now(),
  });

  console.log(`[PageAgent Bridge] Task submitted: ${taskId} — "${task.substring(0, 80)}"`);
  res.json({ taskId, status: 'pending' });
});

router.get('/pending', (req, res) => {
  for (const [id, t] of pageAgentTasks) {
    if (t.status === 'pending') {
      t.status = 'running';
      console.log(`[PageAgent Bridge] Task picked up: ${id}`);
      return res.json({ taskId: id, task: t.task, includeScreenshot: t.includeScreenshot });
    }
  }
  res.json(null);
});

router.post('/result', (req, res) => {
  const { taskId, result, screenshot } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  const t = pageAgentTasks.get(taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });

  t.status = 'completed';
  t.result = result || 'No result text captured';
  t.completedAt = Date.now();

  if (screenshot) {
    try {
      const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
      const filename = `${taskId}.png`;
      const filepath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filepath, base64Data, 'base64');
      t.screenshotPath = filepath;
      console.log(`[PageAgent Bridge] Screenshot saved: ${filepath}`);
    } catch (err) {
      console.error('[PageAgent Bridge] Screenshot save error:', err);
    }
  }

  console.log(`[PageAgent Bridge] Task completed: ${taskId}`);
  res.json({ ok: true });
});

router.get('/result/:taskId', (req, res) => {
  const t = pageAgentTasks.get(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json({
    taskId: t.taskId,
    task: t.task,
    status: t.status,
    result: t.result,
    screenshotPath: t.screenshotPath,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  });
});

router.post('/screenshot', (req, res) => {
  const taskId = `ss_${++pageAgentTaskCounter}_${Date.now()}`;
  pageAgentTasks.set(taskId, {
    taskId,
    task: '__screenshot_only__',
    includeScreenshot: true,
    status: 'pending',
    result: null,
    screenshotPath: null,
    createdAt: Date.now(),
  });
  console.log(`[PageAgent Bridge] Screenshot request: ${taskId}`);
  res.json({ taskId, status: 'pending' });
});

router.get('/tasks', (req, res) => {
  const tasks = [];
  for (const t of pageAgentTasks.values()) {
    tasks.push({ taskId: t.taskId, task: t.task, status: t.status, createdAt: t.createdAt, completedAt: t.completedAt });
  }
  res.json(tasks);
});

export default router;
