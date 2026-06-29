import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cronParser from 'cron-parser';
import { connectDb, User, Session, Task, SendLog, sha256Hex, generateToken, generateVerificationCode } from './database.js';
import { startScheduler, sendWhatsAppMessage, calculateNextRun } from './scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

// ---------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const cnt = await Task.countDocuments();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), tasks: cnt });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ---------------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------------
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('[Auth Middleware] Denied: Access token required');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const session = await Session.findOne({ token });

    if (!session) {
      console.log('[Auth Middleware] Denied: Invalid or expired session (not found in DB)');
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (session.expires_at < Date.now()) {
      console.log(`[Auth Middleware] Denied: Session expired. Expires: ${new Date(session.expires_at).toISOString()}, Current time: ${new Date().toISOString()}`);
      await Session.deleteOne({ _id: session._id });
      return res.status(401).json({ error: 'Session expired' });
    }

    const user = await User.findById(session.user_id);
    if (!user) {
      console.log('[Auth Middleware] Denied: User not found in DB');
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

// ---------------------------------------------------------------
// AUTHENTICATION API
// ---------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { username, passwordHash } = req.body;

  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and passwordHash required' });
  }

  try {
    const user = await User.findOne({ username });

    if (!user || user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Invalidate prior sessions (commented out to allow concurrent logins)
    // await Session.deleteMany({ user_id: user._id });

    const token = generateToken();
    const expiryDays = parseInt(process.env.SESSION_EXPIRY_DAYS, 10) || 30;
    const expiresAt = Date.now() + expiryDays * 24 * 60 * 60 * 1000;

    await Session.create({ token, user_id: user._id, expires_at: expiresAt, created_at: Date.now() });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        isAdmin: !!user.is_admin,
        chatId: user.chat_id
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    await Session.deleteOne({ token: req.token });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    id: req.user._id,
    username: req.user.username,
    isAdmin: !!req.user.is_admin,
    chatId: req.user.chat_id,
    verificationCode: req.user.verification_code
  });
});

app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });

  try {
    await User.updateOne({ _id: req.user._id }, { chat_id: chatId, verification_code: null });
    res.json({ success: true, chatId });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { oldPasswordHash, newPasswordHash } = req.body;

  if (!oldPasswordHash || !newPasswordHash) {
    return res.status(400).json({ error: 'Old and new password hashes required' });
  }

  try {
    if (req.user.password_hash !== oldPasswordHash) {
      return res.status(400).json({ error: 'Old password is incorrect' });
    }

    await User.updateOne({ _id: req.user._id }, { password_hash: newPasswordHash });
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------
// TASKS API
// ---------------------------------------------------------------


// Dashboard stats
app.get('/api/tasks/stats', authenticateToken, async (req, res) => {
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

app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    let tasks;
    if (req.user.is_admin) {
      tasks = await Task.find().sort({ created_at: -1 }).lean();
      // Populate owner username
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

app.post('/api/tasks', authenticateToken, async (req, res) => {
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

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
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

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
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

app.post('/api/tasks/:id/pause', authenticateToken, async (req, res) => {
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

app.post('/api/tasks/:id/resume', authenticateToken, async (req, res) => {
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

// ---------------------------------------------------------------
// LOGS API
// ---------------------------------------------------------------
app.get('/api/logs', authenticateToken, async (req, res) => {
  try {
    let logs;
    if (req.user.is_admin) {
      logs = await SendLog.find().sort({ sent_at: -1 }).limit(500).lean();
      const userIds = [...new Set(logs.map(l => l.owner_user_id.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'username').lean();
      const userMap = {};
      users.forEach(u => { userMap[u._id.toString()] = u.username; });
      logs = logs.map(l => ({ ...l, id: l._id, owner_username: userMap[l.owner_user_id.toString()] || 'Unknown' }));
    } else {
      logs = await SendLog.find({ owner_user_id: req.user._id }).sort({ sent_at: -1 }).limit(500).lean();
      logs = logs.map(l => ({ ...l, id: l._id }));
    }
    res.json(logs);
  } catch (err) {
    console.error('Fetch logs error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------
// CALENDAR API
// ---------------------------------------------------------------
app.get('/api/calendar', authenticateToken, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1); // 1-indexed

    // Calculate month boundaries in ms
    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd = new Date(year, month, 1).getTime(); // start of next month

    const filter = req.user.is_admin ? {} : { owner_user_id: req.user._id };

    // 1. Get past logs for this month and all tasks in parallel
    const logFilter = {
      ...filter,
      sent_at: { $gte: monthStart, $lt: monthEnd }
    };

    const [logs, allTasks] = await Promise.all([
      SendLog.find(logFilter).sort({ sent_at: 1 }).lean(),
      Task.find(filter).lean()
    ]);

    // Map log metadata and categorize tasks in-memory
    const taskMap = {};
    const activeTasks = [];
    const completedTasks = [];

    for (const t of allTasks) {
      taskMap[t._id.toString()] = {
        task_type: t.task_type,
        schedule_spec: t.schedule_spec
      };

      if (['Active', 'Paused', 'Firing'].includes(t.status)) {
        activeTasks.push(t);
      } else if (['Completed', 'Failed'].includes(t.status)) {
        if (t.last_run_at && t.last_run_at >= monthStart && t.last_run_at < monthEnd) {
          completedTasks.push(t);
        }
      }
    }

    // Group logs by day
    const logsByDay = {};
    for (const log of logs) {
      const d = new Date(log.sent_at);
      const dayKey = d.getDate();
      if (!logsByDay[dayKey]) logsByDay[dayKey] = [];
      const taskMeta = taskMap[log.task_id?.toString()] || {};
      logsByDay[dayKey].push({
        id: log._id,
        task_name: log.task_name,
        target_jid: log.target_jid,
        message: log.message,
        success: log.success,
        error_msg: log.error_msg,
        sent_at: log.sent_at,
        task_type: taskMeta.task_type,
        expression: taskMeta.schedule_spec?.expression,
        interval_secs: taskMeta.schedule_spec?.interval_secs
      });
    }

    // 2. Compute which days active/paused tasks fire in this month
    const scheduledByDay = {};

    for (const task of activeTasks) {
      const spec = task.schedule_spec || {};

      if (task.task_type === 'OneTime') {
        if (spec.run_at) {
          const runAt = new Date(spec.run_at);
          if (runAt.getTime() >= monthStart && runAt.getTime() < monthEnd) {
            const dayKey = runAt.getDate();
            if (!scheduledByDay[dayKey]) scheduledByDay[dayKey] = [];
            scheduledByDay[dayKey].push({
              id: task._id,
              name: task.name,
              task_type: task.task_type,
              status: task.status,
              fire_at: runAt.getTime()
            });
          }
        }
      } else if (task.task_type === 'Cron' && spec.expression) {
        try {
          const startMs = Math.max(monthStart, task.created_at || 0, Date.now());
          const interval = cronParser.parseExpression(spec.expression, {
            currentDate: new Date(startMs),
            endDate: new Date(monthEnd - 1)
          });
          // Collect up to 100 fire times within the month
          let count = 0;
          while (true) {
            try {
              const next = interval.next();
              const fireMs = next.toDate().getTime();
              if (fireMs >= monthEnd) break;
              const dayKey = next.toDate().getDate();
              if (!scheduledByDay[dayKey]) scheduledByDay[dayKey] = [];
              // Avoid duplicating the same task on the same day
              if (!scheduledByDay[dayKey].find(s => s.id.toString() === task._id.toString())) {
                scheduledByDay[dayKey].push({
                  id: task._id,
                  name: task.name,
                  task_type: task.task_type,
                  status: task.status,
                  expression: spec.expression,
                  fire_at: fireMs
                });
              }
              count++;
              if (count > 500) break; // safety cap
            } catch (e) {
              break;
            }
          }
        } catch (e) {
          // Invalid expression, skip
        }
      } else if (task.task_type === 'Interval') {
        // For interval tasks, compute fire times based on next_run_at and interval
        const intervalSecs = parseInt(spec.interval_secs, 10) || 3600;
        const intervalMs = intervalSecs * 1000;
        // Start from last_run or created_at, project forward
        let cursor = task.next_run_at || task.last_run_at || task.created_at;
        const startMs = Math.max(monthStart, task.created_at || 0, Date.now());
        
        if (cursor < startMs) {
          const diff = startMs - cursor;
          const steps = Math.ceil(diff / intervalMs);
          cursor += steps * intervalMs;
        }
        
        let count = 0;
        while (cursor < monthEnd && count < 100) {
          if (cursor >= startMs) {
            const d = new Date(cursor);
            const dayKey = d.getDate();
            if (!scheduledByDay[dayKey]) scheduledByDay[dayKey] = [];
            if (!scheduledByDay[dayKey].find(s => s.id.toString() === task._id.toString())) {
              scheduledByDay[dayKey].push({
                id: task._id,
                name: task.name,
                task_type: task.task_type,
                status: task.status,
                interval_secs: intervalSecs,
                fire_at: cursor
              });
            }
          }
          cursor += intervalMs;
          count++;
        }
      }
    }

    // 3. Process completed/failed one-time tasks that ran in this month
    for (const task of completedTasks) {
      if (task.last_run_at) {
        const d = new Date(task.last_run_at);
        const dayKey = d.getDate();
        if (!scheduledByDay[dayKey]) scheduledByDay[dayKey] = [];
        scheduledByDay[dayKey].push({
          id: task._id,
          name: task.name,
          task_type: task.task_type,
          status: task.status,
          fire_at: task.last_run_at
        });
      }
    }

    res.json({
      year,
      month,
      logs: logsByDay,
      scheduled: scheduledByDay
    });
  } catch (err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------
// ADMIN USER MANAGEMENT
// ---------------------------------------------------------------
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ created_at: 1 }).lean();
    const formatted = users.map(u => ({
      id: u._id,
      username: u.username,
      isAdmin: !!u.is_admin,
      chatId: u.chat_id,
      verificationCode: u.verification_code,
      createdAt: u.created_at
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Admin fetch users error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  const { username, passwordHash, isAdmin, chatId } = req.body;

  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and passwordHash required' });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: `Username '${username}' already taken` });

    await User.create({
      username,
      password_hash: passwordHash,
      is_admin: !!isAdmin,
      chat_id: chatId || null,
      created_at: Date.now(),
      created_by_id: req.user._id.toString()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, passwordHash, isAdmin, chatId } = req.body;

  try {
    const targetUser = await User.findById(id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    let finalChatId = chatId !== undefined ? chatId : targetUser.chat_id;

    targetUser.username = username || targetUser.username;
    targetUser.password_hash = passwordHash || targetUser.password_hash;
    if (isAdmin !== undefined) targetUser.is_admin = !!isAdmin;
    targetUser.chat_id = finalChatId;
    await targetUser.save();

    // Cascade chatId change to tasks
    if (finalChatId && finalChatId !== targetUser.chat_id) {
      await Task.updateMany({ owner_user_id: id }, { target_wa_chat_id: finalChatId });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (id === req.user._id.toString()) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const targetUser = await User.findById(id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Cascade: delete user's sessions, tasks, logs
    await Session.deleteMany({ user_id: id });
    await Task.deleteMany({ owner_user_id: id });
    await SendLog.deleteMany({ owner_user_id: id });
    await User.deleteOne({ _id: id });

    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------
// WHATSAPP WEBHOOK (VERIFICATION)
// ---------------------------------------------------------------
app.post('/api/webhook/whatsapp', async (req, res) => {
  const senderNumber = req.body.number || req.body.sender || req.body.from;
  const messageText = req.body.message || req.body.text || req.body.body;

  if (!senderNumber || !messageText) {
    return res.status(400).json({ error: 'sender number and message text required' });
  }

  const normalizedText = messageText.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (normalizedText.length !== 8) {
    return res.json({ success: false, reason: 'Not a valid 8-character verification code' });
  }

  try {
    const matchedUser = await User.findOne({ verification_code: normalizedText });

    if (!matchedUser) {
      return res.status(404).json({ error: 'No pending user matching this code' });
    }

    console.log(`[Webhook] Binding "${senderNumber}" → user "${matchedUser.username}"`);

    matchedUser.chat_id = senderNumber;
    matchedUser.verification_code = null;
    await matchedUser.save();

    await Task.updateMany({ owner_user_id: matchedUser._id }, { target_wa_chat_id: senderNumber });

    try {
      await sendWhatsAppMessage(senderNumber, 'WhatsApp verified! You can now log in to the notification scheduler.');
    } catch (sendErr) {
      console.error('[Webhook] Failed to send confirmation:', sendErr.message);
    }

    res.json({ success: true, message: `Bound to user ${matchedUser.username}` });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------------
// SPA FALLBACK
// ---------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'public', 'index.html'));
});

// ---------------------------------------------------------------
// START
// ---------------------------------------------------------------
connectDb().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
    startScheduler();
  });
}).catch(err => {
  console.error('Fatal: Failed to start:', err);
  process.exit(1);
});
