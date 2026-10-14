import { Task } from '../database.js';
import { getGMT8Parts } from './bnm_helper.js';

export function computeNextOccurrence(eventDateMs, recurrence, afterMs = Date.now()) {
  if (!recurrence || recurrence === 'None') return null;
  let candidate = new Date(eventDateMs);
  let safety = 0;
  while (candidate.getTime() <= afterMs && safety < 500) {
    if (recurrence === 'Weekly') {
      candidate = new Date(candidate.getTime() + 7 * 86400 * 1000);
    } else if (recurrence === 'Monthly') {
      candidate.setMonth(candidate.getMonth() + 1);
    } else if (recurrence === 'Yearly') {
      candidate.setFullYear(candidate.getFullYear() + 1);
    } else {
      break;
    }
    safety++;
  }
  return candidate.getTime();
}

export async function syncEventReminders(event, ownerUser) {
  const eventId = event._id;
  const eventDate = event.event_date;
  const reminders = event.reminders || [];
  const ownerUserId = event.owner_user_id;

  const existingTasks = await Task.find({ event_id: eventId });
  const targetChatId = (ownerUser && ownerUser.chat_id) ? ownerUser.chat_id : '';
  const now = Date.now();

  const getOffsetDesc = (offset) => {
    if (offset === 172800) return '48 hours before';
    if (offset === 86400) return '24 hours before';
    if (offset === 7200) return '2 hours before';
    if (offset === 3600) return '1 hour before';
    if (offset === 0) return 'at start time';
    
    const absOffset = Math.abs(offset);
    const suffix = offset > 0 ? 'before' : 'after';
    
    if (absOffset % 86400 === 0) {
      const days = absOffset / 86400;
      return `${days} day${days !== 1 ? 's' : ''} ${suffix}`;
    }
    if (absOffset % 3600 === 0) {
      const hours = absOffset / 3600;
      return `${hours} hour${hours !== 1 ? 's' : ''} ${suffix}`;
    }
    const mins = Math.round(absOffset / 60);
    return `${mins} minute${mins !== 1 ? 's' : ''} ${suffix}`;
  };

  const formattedDateStr = `${getGMT8Parts(eventDate).dateTimeStr} GMT+8`;

  for (const offset of reminders) {
    const runAtTime = eventDate - offset * 1000;

    if (runAtTime > now && targetChatId) {
      const existing = existingTasks.find(t => t.event_reminder_offset === offset);
      const desc = getOffsetDesc(offset);

      const taskPayload = {
        owner_user_id: ownerUserId,
        name: `Reminder: ${event.name} (${desc})`,
        task_type: 'OneTime',
        target_wa_chat_id: targetChatId,
        target_list: [],
        status: 'Active',
        schedule_spec: { run_at: new Date(runAtTime).toISOString() },
        message_template: `⏰ *Event Reminder*:\n"${event.name}" is scheduled for *${formattedDateStr}*.\n\nDescription: ${event.description ? event.description : 'No description'}`,
        message_template_2: '',
        next_run_at: runAtTime,
        event_id: eventId,
        event_reminder_offset: offset,
        updated_at: Date.now()
      };

      if (existing) {
        await Task.updateOne(
          { _id: existing._id },
          {
            $set: {
              name: taskPayload.name,
              status: 'Active',
              schedule_spec: taskPayload.schedule_spec,
              next_run_at: taskPayload.next_run_at,
              message_template: taskPayload.message_template,
              target_wa_chat_id: targetChatId,
              updated_at: Date.now()
            }
          }
        );
      } else {
        await Task.create({
          ...taskPayload,
          created_at: Date.now()
        });
      }
    }
  }

  for (const t of existingTasks) {
    const runAtTime = eventDate - t.event_reminder_offset * 1000;
    const isStillChecked = reminders.includes(t.event_reminder_offset);
    if (!isStillChecked || runAtTime <= now || !targetChatId) {
      await Task.deleteOne({ _id: t._id });
    }
  }
}
