import express from 'express';
import { Contact, User } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const filter = req.user.is_admin ? {} : { owner_user_id: req.user._id };
    const contacts = await Contact.find(filter).sort({ group_name: 1, name: 1 }).lean();

    let userMap = {};
    if (req.user.is_admin) {
      const userIds = [...new Set(contacts.map(c => c.owner_user_id.toString()))];
      const users = await User.find({ _id: { $in: userIds } }, 'username').lean();
      users.forEach(u => { userMap[u._id.toString()] = u.username; });
    }

    const formatted = contacts.map(c => ({
      ...c,
      id: c._id,
      groupName: c.group_name,
      owner_username: req.user.is_admin ? (userMap[c.owner_user_id.toString()] || 'Unknown') : undefined
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Fetch contacts error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, phone, groupName, notes } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Contact name and WhatsApp number/JID are required' });
  }

  try {
    const now = Date.now();
    const contact = await Contact.create({
      owner_user_id: req.user._id,
      name: name.trim(),
      phone: phone.trim(),
      group_name: groupName ? groupName.trim() : '',
      notes: notes ? notes.trim() : '',
      created_at: now,
      updated_at: now
    });
    res.json({ success: true, contactId: contact._id });
  } catch (err) {
    console.error('Create contact error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, phone, groupName, notes } = req.body;

  try {
    const contact = await Contact.findById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (contact.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (name) contact.name = name.trim();
    if (phone) contact.phone = phone.trim();
    if (groupName !== undefined) contact.group_name = groupName ? groupName.trim() : '';
    if (notes !== undefined) contact.notes = notes ? notes.trim() : '';
    contact.updated_at = Date.now();
    await contact.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Update contact error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const contact = await Contact.findById(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (contact.owner_user_id.toString() !== req.user._id.toString() && !req.user.is_admin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Contact.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
