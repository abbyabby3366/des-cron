import cronParser from 'cron-parser';
import { Task, SendLog } from './database.js';

// ---------------------------------------------------------------
// WhatsApp API helper
// ---------------------------------------------------------------
export async function sendWhatsAppMessage(number, message) {
  if (!number) throw new Error('No phone number specified');
  if (!message) throw new Error('No message body specified');

  const apiUrl = process.env.WHATSAPP_API_URL || 'https://deswa.io7.my/api/external/send-message';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, message })
  });

  const data = await res.json();

  if (!res.ok || (data.success !== true && !data.messageId)) {
    const errMsg = data.error || data.details || data.message || `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data;
}

// ---------------------------------------------------------------
// Schedule calculator
// ---------------------------------------------------------------
export function calculateNextRun(taskType, scheduleSpec, fromTime = Date.now()) {
  const spec = typeof scheduleSpec === 'string' ? JSON.parse(scheduleSpec) : scheduleSpec;

  if (taskType === 'OneTime') {
    if (!spec.run_at) return null;
    const runAtMs = new Date(spec.run_at).getTime();
    return runAtMs > fromTime ? runAtMs : null;
  }

  if (taskType === 'Interval') {
    const secs = parseInt(spec.interval_secs, 10) || 3600;
    return fromTime + secs * 1000;
  }

  if (taskType === 'Cron') {
    try {
      const interval = cronParser.parseExpression(spec.expression, {
        currentDate: new Date(fromTime)
      });
      return interval.next().toDate().getTime();
    } catch (err) {
      console.error('[Scheduler] Cron parse error:', spec.expression, err.message);
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------
// Scheduler tick
// ---------------------------------------------------------------
let schedulerInterval = null;

async function tick() {
  const now = Date.now();

  // Find all active tasks whose next_run_at has passed
  const firingTasks = await Task.find({
    status: 'Active',
    next_run_at: { $ne: null, $lte: now }
  });

  for (const task of firingTasks) {
    console.log(`[Scheduler] Firing task "${task.name}" (${task._id})`);

    // Mark as Firing
    task.status = 'Firing';
    task.last_run_at = now;
    task.updated_at = now;
    await task.save();

    let allSucceeded = true;
    const targetList = task.target_list || [];

    // 1. Send personal message to owner's WhatsApp JID
    if (task.target_wa_chat_id && task.message_template) {
      try {
        await sendWhatsAppMessage(task.target_wa_chat_id, task.message_template);
        console.log(`[Scheduler]   ✓ Personal msg sent to ${task.target_wa_chat_id}`);
        await SendLog.create({
          task_id: task._id,
          task_name: task.name,
          owner_user_id: task.owner_user_id,
          target_jid: task.target_wa_chat_id,
          message: task.message_template,
          success: true,
          sent_at: now
        });
      } catch (err) {
        console.error(`[Scheduler]   ✗ Personal msg failed:`, err.message);
        allSucceeded = false;
        await SendLog.create({
          task_id: task._id,
          task_name: task.name,
          owner_user_id: task.owner_user_id,
          target_jid: task.target_wa_chat_id,
          message: task.message_template,
          success: false,
          error_msg: err.message,
          sent_at: now
        });
      }
    }

    // 2. Send broadcast messages to extra recipients
    const broadcastMsg = task.message_template_2 || task.message_template;
    for (const jid of targetList) {
      const trimJid = (jid || '').trim();
      if (!trimJid) continue;
      try {
        await sendWhatsAppMessage(trimJid, broadcastMsg);
        console.log(`[Scheduler]   ✓ Broadcast sent to ${trimJid}`);
        await SendLog.create({
          task_id: task._id,
          task_name: task.name,
          owner_user_id: task.owner_user_id,
          target_jid: trimJid,
          message: broadcastMsg,
          success: true,
          sent_at: now
        });
      } catch (err) {
        console.error(`[Scheduler]   ✗ Broadcast to ${trimJid} failed:`, err.message);
        allSucceeded = false;
        await SendLog.create({
          task_id: task._id,
          task_name: task.name,
          owner_user_id: task.owner_user_id,
          target_jid: trimJid,
          message: broadcastMsg,
          success: false,
          error_msg: err.message,
          sent_at: now
        });
      }
    }

    // 3. Determine next status and schedule
    let nextStatus = 'Active';
    if (task.task_type === 'OneTime') {
      nextStatus = allSucceeded ? 'Completed' : 'Failed';
    } else if (!allSucceeded) {
      nextStatus = 'Failed';
    }

    const nextRun = (nextStatus === 'Active')
      ? calculateNextRun(task.task_type, task.schedule_spec, now)
      : null;

    task.status = nextStatus;
    task.next_run_at = nextRun;
    task.updated_at = now;
    await task.save();

    console.log(`[Scheduler] Task "${task.name}" done → ${nextStatus}. Next: ${nextRun ? new Date(nextRun).toISOString() : 'None'}`);
  }
}

export function startScheduler(intervalMs = 5000) {
  if (schedulerInterval) return;

  console.log(`[Scheduler] Started (polling every ${intervalMs / 1000}s)`);

  // Run first tick immediately
  tick().catch(err => console.error('[Scheduler] Initial tick error:', err));

  schedulerInterval = setInterval(() => {
    tick().catch(err => console.error('[Scheduler] Tick error:', err));
  }, intervalMs);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Stopped.');
  }
}
