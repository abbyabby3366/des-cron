import express from 'express';
import { CalEvent, Task, User } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { syncEventReminders } from '../helpers/event_helper.js';

const router = express.Router();

const VALID_RECURRENCES = ['None', 'Weekly', 'Monthly', 'Yearly'];

router.get('/', authenticateToken, async (req, res) => {
  try {
    const filter = req.user.is_admin ? {} : { owner_user_id: req.user._id };
    const events = await CalEvent.find(filter).sort({ event_date: -1 }).lean();

    let userMap = {};
    if (req.user.is_admin) {
      const userIds = [...new Set(events.map(e => e.owner_user_id.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'username').lean();
      users.forEach(u => { userMap[u._id.toString()] = u.username; });
    }

    const formatted = events.map(e => ({
      ...e,
      id: e._id,
      eventDate: e.event_date,
      recurrence: e.recurrence || 'None',
      owner_username: req.user.is_admin ? (userMap[e.owner_user_id.toString()] || 'Unknown') : undefined
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Fetch events error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, eventDate, description, reminders, recurrence } = req.body;

  if (!name || !eventDate) {
    return res.status(400).json({ error: 'Name and eventDate are required' });
  }

  const normalizedRecurrence = VALID_RECURRENCES.includes(recurrence) ? recurrence : 'None';

  try {
    const now = Date.now();
    const event = await CalEvent.create({
      owner_user_id: req.user._id,
      name,
      description: description ? description : '',
      event_date: new Date(eventDate).getTime(),
      recurrence: normalizedRecurrence,
      reminders: Array.isArray(reminders) ? reminders : [],
      created_at: now,
      updated_at: now
    });

    await syncEventReminders(event, req.user);

    res.json({ success: true, eventId: event._id });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, eventDate, description, reminders, recurrence } = req.body;

  try {
    const event = await CalEvent.findById(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const now = Date.now();
    if (name) event.name = name;
    if (eventDate) event.event_date = new Date(eventDate).getTime();
    if (description !== undefined) event.description = description;
    if (reminders !== undefined) event.reminders = reminders;
    if (recurrence && VALID_RECURRENCES.includes(recurrence)) {
      event.recurrence = recurrence;
    }

    event.updated_at = now;
    await event.save();

    const ownerUser = event.owner_user_id.toString() === req.user._id.toString()
      ? req.user
      : await User.findById(event.owner_user_id);

    await syncEventReminders(event, ownerUser);

    res.json({ success: true });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const event = await CalEvent.findById(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Task.deleteMany({ event_id: id });
    await CalEvent.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
