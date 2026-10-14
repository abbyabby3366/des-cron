import express from 'express';
import {
  User,
  Session,
  Task,
  CalEvent,
  generateToken,
  generateVerificationCode,
  hashPasswordServer,
  verifyPasswordServer
} from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { syncEventReminders } from '../helpers/event_helper.js';

const router = express.Router();

// Simple sliding-window login rate limiter (max 10 failed attempts per 5 minutes per IP/username)
const loginAttempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function checkLoginRateLimit(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return { allowed: true };
  const recent = entry.filter(ts => now - ts < WINDOW_MS);
  if (recent.length === 0) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  loginAttempts.set(key, recent);
  if (recent.length >= MAX_ATTEMPTS) {
    const retryAfterSecs = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return { allowed: false, retryAfterSecs };
  }
  return { allowed: true };
}

function recordFailedLogin(key) {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(ts => now - ts < WINDOW_MS);
  recent.push(now);
  loginAttempts.set(key, recent);
}

router.post('/login', async (req, res) => {
  const { username, passwordHash } = req.body;

  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'Username and passwordHash required' });
  }

  const rateKey = `${req.ip}:${username.toLowerCase()}`;
  const rateStatus = checkLoginRateLimit(rateKey);
  if (!rateStatus.allowed) {
    return res.status(429).json({
      error: `Too many failed login attempts. Please try again in ${rateStatus.retryAfterSecs}s.`
    });
  }

  try {
    const user = await User.findOne({ username });

    if (!user || !verifyPasswordServer(passwordHash, user.password_hash)) {
      recordFailedLogin(rateKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginAttempts.delete(rateKey);

    // Transparently upgrade legacy SHA-256 hash to salted scrypt hash
    if (!user.password_hash.startsWith('scrypt$')) {
      user.password_hash = hashPasswordServer(passwordHash);
      await user.save();
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
        chatId: user.chat_id,
        verificationCode: user.verification_code
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
  if (!chatId || !chatId.trim()) return res.status(400).json({ error: 'chatId is required' });

  const cleanChatId = chatId.trim();
  const previousChatId = req.user.chat_id;

  try {
    req.user.chat_id = cleanChatId;
    req.user.verification_code = null;
    await req.user.save();

    // Update user's tasks that were bound to their previous default chatId or had an empty chatId
    const matchValues = ['', null];
    if (previousChatId) matchValues.push(previousChatId);
    await Task.updateMany(
      { owner_user_id: req.user._id, target_wa_chat_id: { $in: matchValues } },
      { $set: { target_wa_chat_id: cleanChatId, updated_at: Date.now() } }
    );

    // Sync event reminders so any upcoming events have active reminder tasks targeting the new number
    const userEvents = await CalEvent.find({ owner_user_id: req.user._id });
    for (const ev of userEvents) {
      await syncEventReminders(ev, req.user);
    }

    res.json({ success: true, chatId: cleanChatId });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/verification-code', authenticateToken, async (req, res) => {
  try {
    const newCode = generateVerificationCode();
    await User.updateOne({ _id: req.user._id }, { verification_code: newCode });
    res.json({ success: true, verificationCode: newCode });
  } catch (err) {
    console.error('Generate verification code error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  const { oldPasswordHash, newPasswordHash } = req.body;

  if (!oldPasswordHash || !newPasswordHash) {
    return res.status(400).json({ error: 'Old and new password hashes required' });
  }

  try {
    if (!verifyPasswordServer(oldPasswordHash, req.user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { password_hash: hashPasswordServer(newPasswordHash) }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
