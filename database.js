import mongoose from 'mongoose';
import crypto from 'crypto';

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
export function sha256Hex(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function generateVerificationCode() {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += charset[bytes[i] % charset.length];
  }
  return code;
}

// ---------------------------------------------------------------
// SCHEMAS & MODELS
// ---------------------------------------------------------------
const userSchema = new mongoose.Schema({
  username:          { type: String, required: true, unique: true },
  password_hash:     { type: String, required: true },
  is_admin:          { type: Boolean, default: false },
  chat_id:           { type: String, default: null },
  verification_code: { type: String, default: null },
  created_at:        { type: Number, required: true },
  created_by_id:     { type: String, default: '0' }
});
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

const sessionSchema = new mongoose.Schema({
  token:      { type: String, required: true, unique: true, index: true },
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expires_at: { type: Number, required: true },
  created_at: { type: Number, required: true }
});

const taskSchema = new mongoose.Schema({
  owner_user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:               { type: String, required: true },
  task_type:          { type: String, required: true, enum: ['OneTime', 'Interval', 'Cron'] },
  target_wa_chat_id:  { type: String, required: true },
  target_list:        { type: [String], default: [] },
  status:             { type: String, default: 'Active', enum: ['Active', 'Paused', 'Firing', 'Completed', 'Failed'] },
  schedule_spec:      { type: mongoose.Schema.Types.Mixed, default: {} },
  message_template:   { type: String, required: true },
  message_template_2: { type: String, default: '' },
  last_run_at:        { type: Number, default: null },
  next_run_at:        { type: Number, default: null, index: true },
  created_at:         { type: Number, required: true },
  updated_at:         { type: Number, required: true }
});
taskSchema.index({ status: 1, next_run_at: 1 });
taskSchema.set('toJSON', { virtuals: true });
taskSchema.set('toObject', { virtuals: true });

const sendLogSchema = new mongoose.Schema({
  task_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  task_name:     { type: String, required: true },
  owner_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  target_jid:    { type: String, required: true },
  message:       { type: String, required: true },
  success:       { type: Boolean, default: false },
  error_msg:     { type: String, default: null },
  sent_at:       { type: Number, required: true, index: true }
});
sendLogSchema.set('toJSON', { virtuals: true });
sendLogSchema.set('toObject', { virtuals: true });

export const User    = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Task    = mongoose.model('Task', taskSchema);
export const SendLog = mongoose.model('SendLog', sendLogSchema);

// ---------------------------------------------------------------
// CONNECTION + SEED
// ---------------------------------------------------------------
let connected = false;

export async function connectDb() {
  if (connected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required');
  }

  await mongoose.connect(uri);
  connected = true;
  console.log('[DB] Connected to MongoDB Atlas');

  // Clean expired sessions
  const result = await Session.deleteMany({ expires_at: { $lt: Date.now() } });
  if (result.deletedCount > 0) {
    console.log(`[DB] Cleaned ${result.deletedCount} expired session(s).`);
  }

  // Ensure default admin user exists
  const adminUser = await User.findOne({ username: 'admin' });
  if (!adminUser) {
    await User.create({
      username: 'admin',
      password_hash: sha256Hex('admin123'),
      is_admin: true,
      created_at: Date.now(),
      created_by_id: '0'
    });
    console.log('[DB] Default admin user created: admin / admin123');
  }
}
