import express from 'express';
import { SendLog, User } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

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

export default router;
