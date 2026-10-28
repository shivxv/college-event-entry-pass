import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Student from '../models/Student.js';

const router = Router();
const pendingMessage = 'Your fee payment has not been verified yet. Please contact the event desk.';
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many pass lookup attempts. Please wait before trying again.' },
});
const lookupFields = new Set(['collegeId', 'phone']);

router.post('/my-pass', lookupLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !lookupFields.has(key))) {
      return res.status(400).json({ message: 'Only college ID and registered phone number are accepted.' });
    }
    const { collegeId, phone } = req.body ?? {};
    if (
      typeof collegeId !== 'string' ||
      !collegeId.trim() ||
      collegeId.trim().length > 40 ||
      typeof phone !== 'string' ||
      !phone.trim() ||
      phone.trim().length > 24
    ) {
      return res.status(400).json({ message: 'Enter your college ID and registered phone number.' });
    }

    const student = await Student.findOne({ collegeId: collegeId.trim().toUpperCase() }).select('+passToken');
    const submittedPhone = phone.replace(/\D/g, '');
    const registeredPhone = student?.phone.replace(/\D/g, '');
    if (!student || !submittedPhone || submittedPhone !== registeredPhone) {
      return res.status(404).json({ message: 'No registration matches those details.' });
    }
    if (student.paymentStatus !== 'paid' || student.passStatus !== 'generated' || !student.passToken) {
      return res.status(403).json({ message: pendingMessage });
    }

    const verificationUrl = buildVerificationUrl(req, student.passToken);
    const qrCode = await student.generatePassQr(verificationUrl);
    return res.json({
      pass: {
        eventName: 'GNIBM College Event',
        fullName: student.fullName,
        collegeId: student.collegeId,
        branch: student.branch,
        year: student.year,
        eventType: student.eventType,
        paymentStatus: student.paymentStatus,
        passStatus: student.passStatus,
        entryStatus: student.entryStatus,
        entryTime: student.entryTime,
        qrCode,
      },
    });
  } catch (error) {
    return next(error);
  }
});

function buildVerificationUrl(req, token) {
  const configuredBase = process.env.PUBLIC_API_URL;
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const baseUrl = new URL(configuredBase || requestOrigin);
  const localHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(baseUrl.hostname);
  if (!configuredBase && !localHost) {
    throw new Error('PUBLIC_API_URL must be configured for public pass URLs.');
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('PUBLIC_API_URL must be an origin without credentials, query, or fragment.');
  }
  if (baseUrl.protocol !== 'https:' && !localHost) {
    throw new Error('PUBLIC_API_URL must use HTTPS outside local development.');
  }
  return new URL(`/api/passes/verify/${encodeURIComponent(token)}`, baseUrl).toString();
}

export default router;
