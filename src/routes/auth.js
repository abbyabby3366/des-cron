import express from 'express';
import { User, Session, generateToken } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, passwordHash } = req.body;

  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and passwordHash required' });
  }

  try {
    const user = await User.findOne({ username });

    if (!user || user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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

router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await Session.deleteOne({ token: req.token });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({
    id: req.user._id,
    username: req.user.username,
    isAdmin: !!req.user.is_admin,
    chatId: req.user.chat_id,
    verificationCode: req.user.verification_code
  });
});

router.put('/profile', authenticateToken, async (req, res) => {
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

router.post('/change-password', authenticateToken, async (req, res) => {
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

export default router;
