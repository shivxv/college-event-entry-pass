import { Router } from 'express';
import Student from '../models/Student.js';
import { requireStaff } from '../middleware/staffAuth.js';

const router = Router();
router.use(requireStaff);

router.post('/verify', async (req, res) => {
  const { passToken } = req.body ?? {};
  if (typeof passToken !== 'string' || !/^[a-f0-9]{64}$/i.test(passToken)) {
    return res.status(400).json({ code: 'INVALID_PASS', message: 'INVALID PASS — ENTRY DENIED' });
  }

  const token = passToken.toLowerCase();
  const enteredAt = new Date();
  const allowed = await Student.findOneAndUpdate(
    { passToken: token, paymentStatus: 'paid', passStatus: 'generated', entryStatus: 'not_entered' },
    { $set: { entryStatus: 'entered', entryTime: enteredAt } },
    { new: true, runValidators: true },
  ).select('fullName collegeId eventType entryStatus entryTime');

  if (allowed) {
    return res.json({ code: 'ENTRY_ALLOWED', message: 'ENTRY ALLOWED', student: allowed });
  }

  const existing = await Student.findOne({ passToken: token })
    .select('fullName collegeId eventType entryStatus entryTime paymentStatus passStatus');
  if (existing?.entryStatus === 'entered') {
    return res.status(409).json({
      code: 'ENTRY_ALREADY_USED',
      message: 'ENTRY ALREADY USED',
      student: existing,
    });
  }
  return res.status(403).json({ code: 'INVALID_PASS', message: 'INVALID PASS — ENTRY DENIED' });
});

router.get('/qr/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(403).json({ code: 'INVALID_PASS', message: 'INVALID PASS — ENTRY DENIED' });
  }
  const student = await Student.findOne({
    passToken: token.toLowerCase(), paymentStatus: 'paid', passStatus: 'generated',
  }).select('passToken');
  return res.json({ passToken: student?.passToken || null });
});

export default router;
