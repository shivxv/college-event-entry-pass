import mongoose from 'mongoose';

const staffUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 64, unique: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    passwordHash: { type: String, required: true, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    tokenVersion: { type: Number, required: true, default: 0 },
    role: { type: String, required: true, enum: ['admin'] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

staffUserSchema.index({ email: 1 }, { unique: true, sparse: true });

staffUserSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'admin' } },
);

export default mongoose.model('StaffUser', staffUserSchema);
