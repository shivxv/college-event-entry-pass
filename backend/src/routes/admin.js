import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import StaffUser from '../models/StaffUser.js';
import Student from '../models/Student.js';
import { requireAdmin, requireStaff } from '../middleware/staffAuth.js';
import { sendStaffPasswordEmail } from '../services/mailer.js';

const router = Router();
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

router.use(requireStaff, requireAdmin);

router.post('/volunteers', accountLimiter, async (req, res, next) => {
  try {
    const { username, email } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['username', 'email'])) {
      return res.status(400).json({ message: 'Provide only the staff name and email address.' });
    }
    if (!validUsername(username) || !validEmail(email)) {
      return res.status(400).json({ message: 'Provide a valid staff name and email address.' });
    }

    const token = randomBytes(32).toString('hex');
    const volunteer = await StaffUser.create({
      username: normalizeUsername(username),
      email: normalizeEmail(email),
      passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      role: 'volunteer',
    });
    const origin = process.env.CLIENT_ORIGIN;
    if (!origin) {
      await StaffUser.deleteOne({ _id: volunteer._id });
      return res.status(503).json({ message: 'Staff invitation email is not configured.' });
    }
    const resetUrl = new URL('/', origin);
    resetUrl.hash = `reset-password?token=${token}`;
    try {
      await sendStaffPasswordEmail({
        to: volunteer.email,
        username: volunteer.username,
        resetUrl: resetUrl.toString(),
        purpose: 'invite',
      });
    } catch (error) {
      await StaffUser.deleteOne({ _id: volunteer._id });
      throw error;
    }
    return res.status(201).json({
      volunteer: { username: volunteer.username, email: volunteer.email, role: volunteer.role, active: volunteer.active },
      message: 'Staff invitation sent. They can choose a password from the email link.',
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That username is already in use.' });
    return next(error);
  }
});

router.get('/students', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const paymentStatus = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : '';
    const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : '';
    const filter = {};
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: safeSearch, $options: 'i' } },
        { collegeId: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (['pending', 'paid'].includes(paymentStatus)) filter.paymentStatus = paymentStatus;
    if (['fresher', 'farewell'].includes(eventType)) filter.eventType = eventType;

    const students = await Student.find(filter)
      .select('fullName collegeId email phone branch year eventType paymentStatus paymentVerifiedBy paymentVerifiedAt entryStatus entryTime passStatus createdAt')
      .sort({ createdAt: -1 })
      .limit(500);
    return res.json({ students });
  } catch (error) {
    return next(error);
  }
});

router.post('/students/approve-payment', async (req, res, next) => {
  try {
    if (!hasOnlyKeys(req.body, ['collegeId'])) {
      return res.status(400).json({ message: 'Provide only the student college ID.' });
    }
    const { collegeId } = req.body;
    if (
      typeof collegeId !== 'string' ||
      collegeId.trim().length < 1 ||
      collegeId.trim().length > 40 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,39}$/.test(collegeId.trim())
    ) {
      return res.status(400).json({ message: 'Provide a valid college ID.' });
    }
    const normalizedCollegeId = collegeId.trim().toUpperCase();

    const student = await Student.findOneAndUpdate(
      { collegeId: normalizedCollegeId, paymentStatus: 'pending', passStatus: 'locked', passToken: { $exists: false } },
      {
        $set: {
          paymentStatus: 'paid',
          paymentVerifiedBy: req.staff.username,
          paymentVerifiedAt: new Date(),
          passToken: randomBytes(32).toString('hex'),
          passStatus: 'generated',
        },
      },
      { new: true, runValidators: true },
    ).select('fullName collegeId paymentStatus paymentVerifiedBy paymentVerifiedAt passStatus');
    if (!student) {
      const exists = await Student.exists({ collegeId: normalizedCollegeId });
      if (!exists) return res.status(404).json({ message: 'No student registration matches that college ID.' });
      return res.status(409).json({ message: 'This registration is already paid or its pass has already been generated.' });
    }

    return res.json({
      student: {
        fullName: student.fullName,
        collegeId: student.collegeId,
        paymentStatus: student.paymentStatus,
        paymentVerifiedBy: student.paymentVerifiedBy,
        paymentVerifiedAt: student.paymentVerifiedAt,
        passStatus: student.passStatus,
      },
    });
  } catch (error) {
    return next(error);
  }
});

function validUsername(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}._' -]{3,64}$/u.test(value.trim());
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeUsername(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function hasOnlyKeys(body, expectedKeys) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === expectedKeys.length &&
    Object.keys(body).every((key) => expectedKeys.includes(key));
}

export default router;
