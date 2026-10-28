import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import QRCode from 'qrcode';

const studentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    collegeId: { type: String, required: true, trim: true, uppercase: true, maxlength: 40, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 24 },
    branch: { type: String, required: true, trim: true, maxlength: 100 },
    year: { type: String, required: true, enum: ['First year', 'Second year', 'Third year', 'Fourth year'] },
    eventType: { type: String, required: true, enum: ['fresher', 'farewell'] },
    paymentStatus: { type: String, required: true, enum: ['pending', 'paid'], default: 'pending' },
    paymentVerifiedBy: {
      type: String,
      trim: true,
      required: function () { return this.paymentStatus === 'paid'; },
    },
    paymentVerifiedAt: {
      type: Date,
      default: null,
      required: function () { return this.paymentStatus === 'paid'; },
    },
    passToken: { type: String, select: false },
    passStatus: { type: String, required: true, enum: ['locked', 'generated'], default: 'locked' },
    entryStatus: { type: String, required: true, enum: ['not_entered', 'entered'], default: 'not_entered' },
    entryTime: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

studentSchema.index({ passToken: 1 }, { unique: true, sparse: true });

studentSchema.pre('validate', function () {
  if (this.isNew && this.entryStatus === 'entered') {
    this.invalidate('entryStatus', 'A new registration cannot already be checked in.');
  }
  if (this.paymentStatus === 'paid') {
    if (this.isNew) {
      this.invalidate('paymentStatus', 'A student must be registered before payment can be approved.');
      return;
    }
    this.paymentVerifiedAt ??= new Date();
    if (!this.passToken && this.isModified('paymentStatus')) {
      this.passToken = randomBytes(32).toString('hex');
    }
    this.passStatus = 'generated';
  } else {
    this.passStatus = 'locked';
    if (this.passToken) this.invalidate('passToken', 'A pass token can only exist after payment approval.');
  }
});

studentSchema.methods.approvePayment = async function (verifiedBy) {
  if (typeof verifiedBy !== 'string' || !verifiedBy.trim()) {
    throw new TypeError('A payment verifier is required.');
  }
  if (this.paymentStatus !== 'pending') {
    throw new Error('Only pending registrations can be approved.');
  }
  if (this.isNew) {
    throw new Error('Save the student registration before approving payment.');
  }

  this.paymentStatus = 'paid';
  this.paymentVerifiedBy = verifiedBy.trim();
  this.paymentVerifiedAt = new Date();
  await this.save();
  return this;
};

studentSchema.methods.generatePassQr = function (verificationUrl) {
  if (this.paymentStatus !== 'paid' || this.passStatus !== 'generated') {
    throw new Error('The entry pass is locked until payment is verified.');
  }
  if (!this.passToken) {
    throw new Error('Load the pass token before generating its QR code.');
  }

  if (typeof verificationUrl !== 'string' || !verificationUrl.trim()) {
    throw new TypeError('A pass verification URL is required.');
  }
  const parsedUrl = new URL(verificationUrl);
  const localHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname);
  if (
    (parsedUrl.protocol !== 'https:' && !localHost) ||
    !new RegExp(`/api/passes/verify/${this.passToken}$`).test(parsedUrl.pathname) ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new TypeError('The QR code must contain only this pass verification URL.');
  }

  return QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
    color: { dark: '#17211c', light: '#ffffff' },
  });
};

export default mongoose.model('Student', studentSchema);
