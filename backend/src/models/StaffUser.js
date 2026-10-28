import mongoose from 'mongoose';

const staffUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 32, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ['admin', 'volunteer'] },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

staffUserSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'admin' } },
);

export default mongoose.model('StaffUser', staffUserSchema);
