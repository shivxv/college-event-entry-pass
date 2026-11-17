import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import StaffUser from '../models/StaffUser.js';
import { getJwtSecret, requireStaff, signStaffToken } from '../middleware/staffAuth.js';
import { sendAdminPasswordResetEmail } from '../services/mailer.js';

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
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const resetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

router.post('/bootstrap-admin', bootstrapLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const configuredToken = process.env.BOOTSTRAP_ADMIN_TOKEN;
    const { bootstrapToken, username, email, password } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['bootstrapToken', 'username', 'email', 'password'])) {
      return res.status(400).json({ message: 'Provide only the bootstrap token, username, email, and password.' });
    }
    if (!configuredToken || configuredToken.length < 32) {
      return res.status(503).json({ message: 'Admin bootstrap is not configured.' });
    }
    if (!validUsername(username) || !validEmail(email) || !validPassword(password) || typeof bootstrapToken !== 'string' ||
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
      username: normalizeUsername(username),
      email: normalizeEmail(email),
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
    const user = await StaffUser.findOne({ username: normalizeUsername(username), role: 'admin' })
      .select('+passwordHash _id username role active tokenVersion');
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

router.post('/change-password', passwordChangeLimiter, requireStaff, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { currentPassword, newPassword } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['currentPassword', 'newPassword']) ||
      !validPassword(currentPassword) || !validPassword(newPassword)) {
      return res.status(400).json({ message: 'Enter your current password and a new password of at least 12 characters.' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'Choose a new password different from your current password.' });
    }

    const user = await StaffUser.findById(req.staff.id).select('+passwordHash _id');
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ message: 'The current password is incorrect.' });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    return res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/email', requireStaff, async (req, res, next) => {
  try {
    const { email, currentPassword } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['email', 'currentPassword']) || !validEmail(email) || !validPassword(currentPassword)) {
      return res.status(400).json({ message: 'Enter a valid email address and your current password.' });
    }
    const user = await StaffUser.findById(req.staff.id).select('+passwordHash _id');
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ message: 'The current password is incorrect.' });
    }
    user.email = normalizeEmail(email);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    return res.json({ message: 'Staff email updated.' });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That email address is already assigned to a staff account.' });
    return next(error);
  }
});

router.post('/forgot-password', resetRequestLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { email } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['email']) || !validEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    const origin = process.env.CLIENT_ORIGIN;
    if (!origin || !process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER ||
      !process.env.SMTP_PASS || !process.env.SMTP_FROM) {
      return res.status(503).json({ message: 'Password reset email is not configured. Contact the administrator.' });
    }

    const user = await StaffUser.findOne({ email: normalizeEmail(email), role: 'admin', active: true });
    if (user) {
      const token = randomBytes(32).toString('hex');
      user.passwordResetTokenHash = hashResetToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      const resetUrl = new URL('/', origin);
      resetUrl.hash = `reset-password?token=${token}`;
      await sendAdminPasswordResetEmail({
        to: user.email,
        username: user.username,
        resetUrl: resetUrl.toString(),
      });
    }
    return res.json({ message: 'If that administrator recovery email is registered, a password reset link will arrive shortly.' });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', resetSubmitLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { token, newPassword } = req.body ?? {};
    if (!hasOnlyKeys(req.body, ['token', 'newPassword']) || typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) || !validPassword(newPassword)) {
      return res.status(400).json({ message: 'The reset link or new password is invalid.' });
    }

    const user = await StaffUser.findOneAndUpdate(
      { passwordResetTokenHash: hashResetToken(token), passwordResetExpiresAt: { $gt: new Date() }, role: 'admin', active: true },
      {
        $set: { passwordHash: await bcrypt.hash(newPassword, 12) },
        $inc: { tokenVersion: 1 },
        $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
      },
      { new: true },
    ).select('_id');
    if (!user) return res.status(400).json({ message: 'This password reset link has expired or was already used. Request a new one.' });
    return res.json({ message: 'Password reset successfully. You can now sign in.' });
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
