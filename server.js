import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { connectDb, Task } from './src/database.js';
import { startScheduler } from './src/scheduler.js';

// Import modular routers
import authRouter from './src/routes/auth.js';
import tasksRouter from './src/routes/tasks.js';
import eventsRouter from './src/routes/events.js';
import logsRouter from './src/routes/logs.js';
import calendarRouter from './src/routes/calendar.js';
import adminRouter from './src/routes/admin.js';
import pageAgentRouter from './src/routes/page_agent.js';
import whatsappRouter from './src/routes/whatsapp.js';

dotenv.config();
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.resolve(process.cwd(), 'public')));

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const cnt = await Task.countDocuments();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), tasks: cnt });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Register routers
app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/events', eventsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/admin', adminRouter);
app.use('/api/page-agent', pageAgentRouter);
app.use('/api/webhook', whatsappRouter);

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'public', 'index.html'));
});

// Database & Start Server
connectDb().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
    startScheduler();
  });
}).catch(err => {
  console.error('Fatal: Failed to start:', err);
  process.exit(1);
});
