import express from 'express';
import { SendLog, User } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendWhatsAppMessage } from '../scheduler.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
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

router.post('/:id/retry', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const log = await SendLog.findById(id);
    if (!log) return res.status(404).json({ error: 'Log entry not found' });
    if (log.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const now = Date.now();
    try {
      const apiRes = await sendWhatsAppMessage(log.target_jid, log.message);
      await SendLog.create({
        task_id: log.task_id,
        task_name: `${log.task_name} (Retry)`,
        owner_user_id: log.owner_user_id,
        target_jid: log.target_jid,
        message: log.message,
        success: true,
        api_response: JSON.stringify(apiRes),
        sent_at: now
      });
      res.json({ success: true });
    } catch (sendErr) {
      await SendLog.create({
        task_id: log.task_id,
        task_name: `${log.task_name} (Retry)`,
        owner_user_id: log.owner_user_id,
        target_jid: log.target_jid,
        message: log.message,
        success: false,
        error_msg: sendErr.message,
        sent_at: now
      });
      res.status(502).json({ error: sendErr.message });
    }
  } catch (err) {
    console.error('Retry log error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
