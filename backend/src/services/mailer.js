import nodemailer from 'nodemailer';

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS must be configured to send password-reset email.');
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendAdminPasswordResetEmail({ to, username, resetUrl }) {
  const from = process.env.SMTP_FROM;
  if (!from) throw new Error('SMTP_FROM must be configured to send password-reset email.');
  const transporter = getTransporter();
  const subject = 'Reset your Campus Gather administrator password';
  const intro = `Hello ${username}, we received a request to reset your administrator password.`;
  await transporter.sendMail({
    from,
    to,
    subject,
    text: `${intro}\n\nUse this single-use link within 1 hour to choose a new password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${intro}</p><p><a href="${resetUrl}">Choose a new password</a></p><p>This single-use link expires in 1 hour. If you did not request this, you can ignore this email.</p>`,
  });
}
