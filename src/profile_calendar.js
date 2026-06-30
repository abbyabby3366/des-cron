import dotenv from 'dotenv';
import { connectDb, Task, SendLog } from './database.js';
import cronParser from 'cron-parser';

dotenv.config();

async function run() {
  await connectDb();
  
  const year = 2026;
  const month = 7; // July 2026 (next month)

  console.time('Total Calendar Logic');

  // Calculate month boundaries in ms
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 1).getTime();

  // 1. Get past logs
  console.time('Query Logs');
  const logs = await SendLog.find({ sent_at: { $gte: monthStart, $lt: monthEnd } }).sort({ sent_at: 1 }).lean();
  console.timeEnd('Query Logs');

  // 2. Fetch active tasks
  console.time('Query Tasks');
  const tasks = await Task.find({ status: { $in: ['Active', 'Paused', 'Firing'] } }).lean();
  console.timeEnd('Query Tasks');

  console.log(`Found ${tasks.length} active/paused tasks.`);

  // 3. Process tasks
  console.time('Process Tasks');
  const scheduledByDay = {};

  for (const task of tasks) {
    const spec = task.schedule_spec || {};
    const taskStart = Date.now();

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
      console.log(`Processing Cron task: ${task.name} (${spec.expression})`);
      try {
        const interval = cronParser.parseExpression(spec.expression, {
          currentDate: new Date(monthStart),
          endDate: new Date(monthEnd - 1)
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
        console.error(`Error parsing cron for ${task.name}:`, e.message);
      }
    } else if (task.task_type === 'Interval') {
      console.log(`Processing Interval task: ${task.name}`);
      const intervalSecs = parseInt(spec.interval_secs, 10) || 3600;
      const intervalMs = intervalSecs * 1000;
      let cursor = task.next_run_at || task.last_run_at || task.created_at;
      if (cursor > monthStart) {
        const diff = cursor - monthStart;
        const steps = Math.floor(diff / intervalMs);
        cursor -= steps * intervalMs;
      } else {
        const diff = monthStart - cursor;
        const steps = Math.ceil(diff / intervalMs);
        cursor += steps * intervalMs;
      }
      let count = 0;
      while (cursor < monthEnd && count < 100) {
        if (cursor >= monthStart) {
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
    console.log(`Task ${task.name} took ${Date.now() - taskStart}ms`);
  }
  console.timeEnd('Process Tasks');

  console.timeEnd('Total Calendar Logic');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
