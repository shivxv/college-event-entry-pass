import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import registrationRoutes from './routes/registrations.js';
import studentRoutes from './routes/students.js';
import adminRoutes from './routes/admin.js';
import gateRoutes from './routes/gate.js';

const app = express();
const port = Number(process.env.PORT) || 5000;
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/events', (_req, res) => res.json({
  eventDate: process.env.EVENT_DATE || null,
  events: [
    { id: 'fresher', title: 'Fresher’s Party', audience: 'Junior students', accent: 'purple' },
    { id: 'farewell', title: 'Farewell Party', audience: 'Senior students', accent: 'gold' },
  ],
}));
app.use('/api/auth', authRoutes);
app.use('/api/registrations', registrationRoutes);
app.use('/api/passes', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gate', gateRoutes);

app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ message: error.status ? error.message : 'Something went wrong.' });
});

async function start() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/college_event_entry_pass');
  app.listen(port, () => console.log(`college-event-entry-pass API listening on http://localhost:${port}`));
}
start().catch((error) => { console.error('Server startup failed:', error.message); process.exit(1); });
