import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool, testDatabase } from './config.js';

dotenv.config();

const email = String(process.env.ADMIN_EMAIL || 'admin@bloodbank.local').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || 'Admin@12345');
const name = String(process.env.ADMIN_NAME || 'System Administrator').trim();

if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('ADMIN_EMAIL must be a valid email address.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('ADMIN_PASSWORD must contain at least 8 characters.');
  process.exit(1);
}

try {
  await testDatabase();
  const [existing] = await pool.execute('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);
  const passwordHash = await bcrypt.hash(password, 12);
  if (existing.length) {
    if (existing[0].role !== 'admin') {
      throw new Error(`The email ${email} already belongs to a non-admin account. Set a different ADMIN_EMAIL.`);
    }
    await pool.execute(
      "UPDATE users SET name = ?, full_name = ?, password_hash = ?, status = 'active', rejection_reason = NULL WHERE id = ?",
      [name, name, passwordHash, existing[0].id],
    );
  } else {
    await pool.execute(
      "INSERT INTO users (name, full_name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'admin', 'active')",
      [name, name, email, passwordHash],
    );
  }
  console.log(`Admin account ready: ${email}`);
  console.log('Use the ADMIN_PASSWORD value from backend/.env to sign in.');
} catch (error) {
  console.error('Unable to seed admin:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
