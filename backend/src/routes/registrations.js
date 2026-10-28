import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Student from '../models/Student.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{5,22}[0-9]$/;
const years = ['First year', 'Second year', 'Third year', 'Fourth year'];
const eventTypes = ['fresher', 'farewell'];
const registrationFields = new Set(['fullName', 'collegeId', 'email', 'phone', 'branch', 'year', 'eventType']);
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many registration attempts. Please wait before trying again.' },
});

router.post('/', registrationLimiter, async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !registrationFields.has(key))) {
      return res.status(400).json({ message: 'Registration contains unsupported fields.' });
    }
    const { fullName, collegeId, email, phone, branch, year, eventType } = req.body ?? {};
    const fields = [fullName, collegeId, email, phone, branch, year, eventType];
    if (!fields.every((value) => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ message: 'Please complete every field before registering.' });
    }

    const clean = {
      fullName: fullName.trim(),
      collegeId: collegeId.trim(),
      email: email.trim(),
      phone: phone.trim(),
      branch: branch.trim(),
      year: year.trim(),
      eventType: eventType.trim() === 'freshers' ? 'fresher' : eventType.trim(),
    };
    const phoneDigits = clean.phone.replace(/\D/g, '');

    if (
      clean.fullName.length > 100 ||
      clean.collegeId.length > 40 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,39}$/.test(clean.collegeId) ||
      clean.email.length > 254 ||
      !emailPattern.test(clean.email) ||
      clean.phone.length > 24 ||
      !phonePattern.test(clean.phone) ||
      phoneDigits.length < 7 ||
      clean.branch.length > 100 ||
      fields.some((value) => /[\u0000-\u001f\u007f]/.test(value))
    ) {
      return res.status(400).json({ message: 'Please check the name, college ID, email, phone number, and branch.' });
    }
    if (!years.includes(clean.year)) {
      return res.status(400).json({ message: 'Choose a valid year of study.' });
    }
    if (!eventTypes.includes(clean.eventType)) {
      return res.status(400).json({ message: 'Choose one of the listed event categories.' });
    }

    const registration = await Student.create({ ...clean, paymentStatus: 'pending' });
    return res.status(201).json({
      registration: {
        fullName: registration.fullName,
        collegeId: registration.collegeId,
        eventType: registration.eventType,
        paymentStatus: registration.paymentStatus,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This college ID has already been used to register.' });
    }
    return next(error);
  }
});

export default router;
