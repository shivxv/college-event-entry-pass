import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import StaffUser from '../models/StaffUser.js';
import { getJwtSecret, signStaffToken } from '../middleware/staffAuth.js';

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait before trying again.' },
});
const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many bootstrap attempts. Please try again later.' },
});

router.post('/bootstrap-admin', bootstrapLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const configuredToken = process.env.BOOTSTRAP_ADMIN_TOKEN;
    const { bootstrapToken, username, password } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['bootstrapToken', 'username', 'password'])) {
      return res.status(400).json({ message: 'Provide only the bootstrap token, username, and password.' });
    }
    if (!configuredToken || configuredToken.length < 32) {
      return res.status(503).json({ message: 'Admin bootstrap is not configured.' });
    }
    if (!validUsername(username) || !validPassword(password) || typeof bootstrapToken !== 'string' ||
      Buffer.byteLength(bootstrapToken, 'utf8') > 256) {
      return res.status(400).json({ message: 'Provide a valid bootstrap token, username, and password (at least 12 characters).' });
    }
    const expected = Buffer.from(configuredToken);
    const supplied = Buffer.from(bootstrapToken);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return res.status(401).json({ message: 'The bootstrap credentials are invalid.' });
    }
    if (await StaffUser.exists({ role: 'admin' })) {
      return res.status(409).json({ message: 'The initial administrator has already been created.' });
    }

    const admin = await StaffUser.create({
      username: username.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
    });
    return res.status(201).json({ message: 'Administrator account created.', username: admin.username });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'An administrator or username already exists.' });
    }
    return next(error);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { username, password } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['username', 'password'])) {
      return res.status(400).json({ message: 'Provide only a username and password.' });
    }
    if (!validUsername(username) || !validPassword(password)) {
      return res.status(400).json({ message: 'Enter a valid username and password.' });
    }
    const user = await StaffUser.findOne({ username: username.trim().toLowerCase() })
      .select('+passwordHash _id username role active');
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !user.active || !passwordMatches) {
      return res.status(401).json({ message: 'The username or password is incorrect.' });
    }

    return res.json({
      token: signStaffToken(user),
      expiresIn: 28800,
      user: { username: user.username, role: user.role },
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

const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4oU7Bf7cL1/tc7S8f8hZV6jQz7wW0eK';

export default router;
