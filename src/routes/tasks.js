import express from 'express';
import { Task, User, SendLog } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { calculateNextRun } from '../scheduler.js';

const router = express.Router();

// Dashboard stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const filter = req.user.is_admin ? {} : { owner_user_id: req.user._id };

    const pipeline = [
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ];
    const stats = await Task.aggregate(pipeline);

    const result = { total: 0, Active: 0, Paused: 0, Completed: 0, Failed: 0, Firing: 0 };
    for (const row of stats) {
      result[row._id] = row.count;
      result.total += row.count;
    }

    // Recent logs (last 24h)
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const logFilter = { sent_at: { $gt: since } };
    if (!req.user.is_admin) logFilter.owner_user_id = req.user._id;

    const logPipeline = [
      { $match: logFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          succeeded: { $sum: { $cond: ['$success', 1, 0] } },
          failed: { $sum: { $cond: ['$success', 0, 1] } }
        }
      }
    ];
    const logAgg = await SendLog.aggregate(logPipeline);
    const logStats = logAgg[0] || { total: 0, succeeded: 0, failed: 0 };

    result.recentLogs = {
      total: logStats.total,
      succeeded: logStats.succeeded,
      failed: logStats.failed
    };

    res.json(result);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    let tasks;
    if (req.user.is_admin) {
      tasks = await Task.find().sort({ created_at: -1 }).lean();
      const userIds = [...new Set(tasks.map(t => t.owner_user_id.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'username').lean();
      const userMap = {};
      users.forEach(u => { userMap[u._id.toString()] = u.username; });
      tasks = tasks.map(t => ({
        ...t,
        id: t._id,
        owner_username: userMap[t.owner_user_id.toString()] || 'Unknown',
        targetList: t.target_list,
        scheduleSpec: t.schedule_spec
      }));
    } else {
      tasks = await Task.find({ owner_user_id: req.user._id }).sort({ created_at: -1 }).lean();
      tasks = tasks.map(t => ({
        ...t,
        id: t._id,
        targetList: t.target_list,
        scheduleSpec: t.schedule_spec
      }));
    }

    res.json(tasks);
  } catch (err) {
    console.error('Fetch tasks error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, taskType, targetWaChatId, targetList, scheduleSpec, messageTemplate, messageTemplate2 } = req.body;

  if (!name || !taskType || !targetWaChatId || !scheduleSpec || !messageTemplate) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  try {
    const now = Date.now();
    const nextRun = calculateNextRun(taskType, scheduleSpec, now);

    const task = await Task.create({
      owner_user_id: req.user._id,
      name,
      task_type: taskType,
      target_wa_chat_id: targetWaChatId,
      target_list: targetList || [],
      status: 'Active',
      schedule_spec: scheduleSpec,
      message_template: messageTemplate,
      message_template_2: messageTemplate2 || '',
      next_run_at: nextRun,
      created_at: now,
      updated_at: now
    });

    res.json({ success: true, taskId: task._id });
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, targetWaChatId, targetList, scheduleSpec, messageTemplate, messageTemplate2 } = req.body;

  try {
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const now = Date.now();

    if (name) task.name = name;
    if (targetWaChatId) task.target_wa_chat_id = targetWaChatId;
    if (targetList) task.target_list = targetList;
    if (messageTemplate) task.message_template = messageTemplate;
    if (messageTemplate2 !== undefined) task.message_template_2 = messageTemplate2;

    if (scheduleSpec) {
      task.schedule_spec = scheduleSpec;
      task.next_run_at = calculateNextRun(task.task_type, scheduleSpec, now);
    }

    task.updated_at = now;
    await task.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Task.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/:id/pause', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    task.status = 'Paused';
    task.updated_at = Date.now();
    await task.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Pause task error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/:id/resume', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const now = Date.now();
    task.status = 'Active';
    task.next_run_at = calculateNextRun(task.task_type, task.schedule_spec, now);
    task.updated_at = now;
    await task.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Resume task error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
