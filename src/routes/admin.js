import express from 'express';
import { User, Session, Task, SendLog } from '../database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
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

router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
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

router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
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

    if (finalChatId && finalChatId !== targetUser.chat_id) {
      await Task.updateMany({ owner_user_id: id }, { target_wa_chat_id: finalChatId });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (id === req.user._id.toString()) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const targetUser = await User.findById(id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

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

export default router;
