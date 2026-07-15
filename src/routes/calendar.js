import express from 'express';
import cronParser from 'cron-parser';
import { SendLog, Task, CalEvent, User } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);

    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd = new Date(year, month, 1).getTime();

    const filter = req.user.is_admin ? {} : { owner_user_id: req.user._id };

    const logFilter = {
      ...filter,
      sent_at: { $gte: monthStart, $lt: monthEnd }
    };

    const [logs, allTasks, events] = await Promise.all([
      SendLog.find(logFilter).sort({ sent_at: 1 }).lean(),
      Task.find(filter).lean(),
      CalEvent.find({
        ...filter,
        event_date: { $gte: monthStart, $lt: monthEnd }
      }).sort({ event_date: 1 }).lean()
    ]);

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
            endDate: new Date(monthEnd - 1),
            tz: process.env.TZ || 'Asia/Kuala_Lumpur'
          });
          let count = 0;
          while (true) {
            try {
              const next = interval.next();
              const fireMs = next.toDate().getTime();
              if (fireMs >= monthEnd) break;
              const dayKey = next.toDate().getDate();
              if (!scheduledByDay[dayKey]) scheduledByDay[dayKey] = [];
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
              if (count > 500) break;
            } catch (e) {
              break;
            }
          }
        } catch (e) {
          // Invalid expression, skip
        }
      } else if (task.task_type === 'Interval') {
        const intervalSecs = parseInt(spec.interval_secs, 10) || 3600;
        const intervalMs = intervalSecs * 1000;
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

    const eventsByDay = {};
    for (const ev of events) {
      const d = new Date(ev.event_date);
      const dayKey = d.getDate();
      if (!eventsByDay[dayKey]) eventsByDay[dayKey] = [];
      eventsByDay[dayKey].push({
        id: ev._id,
        name: ev.name,
        description: ev.description,
        event_date: ev.event_date
      });
    }

    res.json({
      year,
      month,
      logs: logsByDay,
      scheduled: scheduledByDay,
      events: eventsByDay
    });
  } catch (err) {
    console.error('Calendar error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
