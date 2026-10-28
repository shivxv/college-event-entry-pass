import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import StaffUser from '../models/StaffUser.js';
import Student from '../models/Student.js';
import { requireAdmin, requireStaff } from '../middleware/staffAuth.js';

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
    const { username, password } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['username', 'password'])) {
      return res.status(400).json({ message: 'Provide only a username and password.' });
    }
    if (!validUsername(username) || !validPassword(password)) {
      return res.status(400).json({ message: 'Provide a valid username and password (at least 12 characters).' });
    }

    const volunteer = await StaffUser.create({
      username: username.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: 'volunteer',
    });
    return res.status(201).json({
      volunteer: { username: volunteer.username, role: volunteer.role, active: volunteer.active },
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
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{3,32}$/.test(value.trim());
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;
}

function hasOnlyKeys(body, expectedKeys) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === expectedKeys.length &&
    Object.keys(body).every((key) => expectedKeys.includes(key));
}

export default router;
