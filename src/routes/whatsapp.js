import express from 'express';
import { User, Task } from '../database.js';
import { sendWhatsAppMessage } from '../scheduler.js';

const router = express.Router();

router.post('/whatsapp', async (req, res) => {
  const senderNumber = req.body.number || req.body.sender || req.body.from;
  const messageText = req.body.message || req.body.text || req.body.body;

  if (!senderNumber || !messageText) {
    return res.status(400).json({ error: 'sender number and message text required' });
  }

  const normalizedText = messageText.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  if (normalizedText.length !== 8) {
    return res.json({ success: false, reason: 'Not a valid 8-character verification code' });
  }

  try {
    const matchedUser = await User.findOne({ verification_code: normalizedText });

    if (!matchedUser) {
      return res.status(404).json({ error: 'No pending user matching this code' });
    }

    console.log(`[Webhook] Binding "${senderNumber}" → user "${matchedUser.username}"`);

    matchedUser.chat_id = senderNumber;
    matchedUser.verification_code = null;
    await matchedUser.save();

    await Task.updateMany({ owner_user_id: matchedUser._id }, { target_wa_chat_id: senderNumber });

    try {
      await sendWhatsAppMessage(senderNumber, 'WhatsApp verified! You can now log in to the notification scheduler.');
    } catch (sendErr) {
      console.error('[Webhook] Failed to send confirmation:', sendErr.message);
    }

    res.json({ success: true, message: `Bound to user ${matchedUser.username}` });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
