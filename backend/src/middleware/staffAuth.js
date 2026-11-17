import jwt from 'jsonwebtoken';
import StaffUser from '../models/StaffUser.js';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

export function signStaffToken(user) {
  return jwt.sign(
    { role: user.role, ver: user.tokenVersion ?? 0 },
    getJwtSecret(),
    { algorithm: 'HS256', subject: user.id, issuer: 'campus-gather-api', audience: 'campus-gather-staff', expiresIn: '8h' },
  );
}

export async function requireStaff(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!match) return res.status(401).json({ message: 'Staff authentication is required.' });

  let payload;
  try {
    payload = jwt.verify(match[1], getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'campus-gather-api',
      audience: 'campus-gather-staff',
    });
  } catch {
    return res.status(401).json({ message: 'The staff session is invalid or expired.' });
  }
  if (typeof payload.sub !== 'string' || payload.role !== 'admin') {
    return res.status(401).json({ message: 'The staff session is invalid or expired.' });
  }

  try {
    const user = await StaffUser.findById(payload.sub).select('_id username role active tokenVersion');
    if (!user || !user.active || user.role !== payload.role || (payload.ver ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: 'The staff session is invalid or expired.' });
    }
    req.staff = { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (req.staff?.role !== 'admin') {
    return res.status(403).json({ message: 'Administrator access is required.' });
  }
  return next();
}
