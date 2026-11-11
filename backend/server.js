import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { pool, testDatabase } from './config.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;
const allowedGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const validCampStatuses = ['Upcoming', 'Ongoing', 'Completed', 'Cancelled'];
const validRequestStatuses = ['pending', 'accepted', 'rejected', 'fulfilled'];

app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((v) => v.trim()),
  credentials: true,
}));
app.use(express.json({ limit: '3mb' }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cleanUser = (user) => {
  if (!user) return null;
  const { password_hash, profile_json, ...safe } = user;
  return { ...safe, _id: String(user.id), id: user.id, role: user.role };
};
const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const toTime = (value) => value ? String(value).slice(0, 8) : null;
const datePlusDays = (value, days) => {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const donorEligibleSql = `(d.eligible_to_donate = 1 AND d.age BETWEEN 18 AND 65 AND d.weight >= 45
  AND (d.last_donation_date IS NULL OR d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 90 DAY)))`;

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication token required' });
    if (!JWT_SECRET) return res.status(500).json({ message: 'JWT_SECRET is not configured on the server' });
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (!rows.length) return res.status(401).json({ message: 'User not found or unauthorized' });
    req.user = cleanUser(rows[0]);
    next();
  } catch (error) {
    return res.status(401).json({ message: error.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid authentication token' });
  }
}
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: `Access restricted to: ${roles.join(', ')}` });
  next();
};
const facilityRoles = ['hospital', 'blood-lab'];

async function getFacility(userId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.full_name, u.email, u.phone, u.emergency_contact, u.role,
            u.status, u.created_at, u.last_login, u.rejection_reason,
            f.facility_type, f.registration_number, f.facility_category, f.street,
            f.city, f.state, f.pincode, f.registration_proof_url, f.operating_open,
            f.operating_close, f.working_days, f.operating_hours_json, f.contact_person,
            f.is_24x7, f.emergency_services
       FROM users u JOIN facilities f ON f.user_id = u.id WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  const operatingHours = parseJson(row.operating_hours_json, {});
  if (!operatingHours.open && row.operating_open) operatingHours.open = toTime(row.operating_open);
  if (!operatingHours.close && row.operating_close) operatingHours.close = toTime(row.operating_close);
  if (!operatingHours.workingDays) operatingHours.workingDays = parseJson(row.working_days, []);
  return {
    _id: String(row.id), id: row.id, userId: row.id, name: row.name || row.full_name,
    fullName: row.full_name || row.name, email: row.email, phone: row.phone,
    emergencyContact: row.emergency_contact, role: row.role, status: row.status,
    facilityType: row.facility_type === 'blood-lab' ? 'Blood Lab' : 'Hospital',
    facility_type: row.facility_type, registrationNumber: row.registration_number,
    facilityCategory: row.facility_category, contactPerson: row.contact_person || '',
    address: { street: row.street, city: row.city, state: row.state, pincode: row.pincode },
    operatingHours, workingDays: parseJson(row.working_days, []),
    is24x7: Boolean(row.is_24x7), emergencyServices: Boolean(row.emergency_services),
    registrationProofUrl: row.registration_proof_url, createdAt: row.created_at,
    lastLogin: row.last_login, rejectionReason: row.rejection_reason,
  };
}

function mapStock(row) {
  return {
    _id: String(row.id), id: row.id, facility: row.facility_id,
    bloodGroup: row.blood_group, bloodType: row.blood_group,
    quantity: Number(row.units), units: Number(row.units),
    expiryDate: row.expiry_date || null, updatedAt: row.updated_at,
  };
}
function mapCamp(row) {
  return {
    _id: String(row.id), id: row.id, title: row.title, description: row.description,
    date: row.event_date, eventDate: row.event_date,
    time: { start: toTime(row.start_time), end: toTime(row.end_time) },
    location: { venue: row.venue, city: row.city, state: row.state, pincode: row.pincode },
    venue: row.venue, city: row.city, state: row.state, pincode: row.pincode,
    expectedDonors: Number(row.expected_donors || 0), actualDonors: Number(row.actual_donors || 0),
    status: row.status, hospital: { _id: String(row.facility_id), id: row.facility_id, name: row.facility_name, address: { city: row.facility_city, state: row.facility_state } },
    createdAt: row.created_at,
  };
}
async function listCamps({ facilityId = null, status = '', search = '', page = 1, limit = 100, sortBy = 'date', sortOrder = 'asc' }) {
  const where = [];
  const params = [];
  if (facilityId !== null) { where.push('bc.facility_id = ?'); params.push(facilityId); }
  if (status && status !== 'all') { where.push('bc.status = ?'); params.push(status); }
  if (search) { where.push('(bc.title LIKE ? OR bc.city LIKE ? OR bc.venue LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[countRow]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM blood_camps bc ${clause}`,
    params,
  );
  const offset = (page - 1) * limit;
  const sortColumns = { date: 'bc.event_date', title: 'bc.title', expectedDonors: 'bc.expected_donors' };
  const sortColumn = sortColumns[sortBy] || sortColumns.date;
  const sortDirection = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await pool.execute(
    `SELECT bc.*, u.name AS facility_name, f.city AS facility_city, f.state AS facility_state
       FROM blood_camps bc JOIN users u ON u.id = bc.facility_id
       LEFT JOIN facilities f ON f.user_id = bc.facility_id
       ${clause} ORDER BY ${sortColumn} ${sortDirection}, bc.start_time ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(countRow.total);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { camps: rows.map(mapCamp), pagination: { currentPage: page, page, limit, total, totalCamps: total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
}
function campInput(body = {}) {
  const time = body.time || {};
  const location = body.location || body.address || {};
  return {
    title: String(body.title || '').trim(), description: body.description || null,
    date: body.date || body.eventDate, start: time.start || body.startTime || null,
    end: time.end || body.endTime || null, venue: location.venue || body.venue || null,
    city: location.city || body.city || null, state: location.state || body.state || null,
    pincode: location.pincode || body.pincode || null,
    expected: Math.max(0, toNumber(body.expectedDonors, 0)),
  };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, database: 'MySQL 8', status: 'healthy' });
}));

// Authentication and registration
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const rawRole = String(body.role || body.facilityType || '').trim().toLowerCase();
  const role = rawRole.replaceAll(' ', '-');
  if (!['donor', 'hospital', 'blood-lab'].includes(role)) return res.status(400).json({ message: 'Choose donor, hospital or blood lab registration' });
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return res.status(400).json({ message: 'A valid email and password of at least 6 characters are required' });
  const displayName = String(body.fullName || body.name || '').trim();
  if (!displayName || !body.phone) return res.status(400).json({ message: 'Name and phone number are required' });
  if (!/^[6-9]\d{9}$/.test(String(body.phone))) return res.status(400).json({ message: 'Enter a valid 10-digit Indian phone number' });
  if (body.emergencyContact && !/^[6-9]\d{9}$/.test(String(body.emergencyContact))) return res.status(400).json({ message: 'Enter a valid 10-digit emergency contact number' });
  if (role === 'donor') {
    if (!allowedGroups.includes(body.bloodGroup)) return res.status(400).json({ message: 'Select a valid blood group' });
    if (!Number.isInteger(toNumber(body.age, NaN)) || toNumber(body.age) < 18 || toNumber(body.age) > 65) return res.status(400).json({ message: 'Donor age must be between 18 and 65 years' });
    if (!Number.isFinite(toNumber(body.weight, NaN)) || toNumber(body.weight) < 45) return res.status(400).json({ message: 'Donor weight must be at least 45 kg' });
  } else if (!String(body.registrationNumber || '').trim()) {
    return res.status(400).json({ message: 'Facility registration number is required' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(password, 12);
    const status = role === 'donor' ? 'active' : 'pending';
    const profileData = { ...body };
    delete profileData.password;
    const [userResult] = await connection.execute(
      `INSERT INTO users (name, full_name, email, password_hash, role, phone, emergency_contact, status, profile_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [displayName, displayName, email, passwordHash, role, body.phone || null, body.emergencyContact || null, status, JSON.stringify(profileData)],
    );
    const userId = userResult.insertId;
    const address = body.address || {};
    if (role === 'donor') {
      await connection.execute(
        `INSERT INTO donors (user_id, age, gender, blood_group, weight, height, street, city, state, pincode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, body.age || null, body.gender || null, body.bloodGroup, body.weight || null, body.height || null, address.street || address.address || null, address.city || null, address.state || null, address.pincode || null],
      );
    } else {
      const hours = body.operatingHours || {};
      await connection.execute(
        `INSERT INTO facilities (user_id, facility_type, registration_number, facility_category, street, city, state, pincode,
          registration_proof_url, operating_open, operating_close, working_days, operating_hours_json, contact_person, is_24x7, emergency_services)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, role, String(body.registrationNumber).trim(), body.facilityCategory || 'Private', address.street || null,
          address.city || null, address.state || null, address.pincode || null,
          body.registrationProofUrl || body.registrationProof?.url || body.documents?.registrationProof?.url || null,
          hours.open || body.openingTime || null, hours.close || body.closingTime || null,
          JSON.stringify(body.workingDays || hours.workingDays || []), JSON.stringify(hours), body.contactPerson || null,
          Boolean(body.is24x7 || body.is24X7), Boolean(body.emergencyServices)],
      );
    }
    await connection.commit();
    res.status(201).json({
      success: true,
      message: role === 'donor' ? 'Donor registered successfully' : 'Facility registered. Please wait for admin approval.',
      user: { id: userId, _id: String(userId), name: displayName, email, role, status },
      redirect: role === 'donor' ? '/login' : '/',
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email or facility registration number already exists' });
    throw error;
  } finally { connection.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: 'Invalid email or password' });
  if (facilityRoles.includes(user.role) && user.status === 'pending') return res.status(403).json({ message: 'Your account is awaiting admin approval. Please wait before logging in.' });
  if (user.status === 'rejected') return res.status(403).json({ message: `Your registration has been rejected by admin.${user.rejection_reason ? ` Reason: ${user.rejection_reason}` : ''}` });
  if (user.status !== 'active' && user.status !== 'approved') return res.status(403).json({ message: 'This account is not active. Contact the administrator.' });
  await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const redirect = user.role === 'donor' ? '/donor' : user.role === 'hospital' ? '/hospital' : user.role === 'blood-lab' ? '/lab' : '/admin';
  res.json({ success: true, message: 'Login successful', token, user: cleanUser(user), redirect });
}));

app.get('/api/auth/profile', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  const row = rows[0];
  const profile = parseJson(row.profile_json, {});
  delete profile.password;
  delete profile.password_hash;
  let extra = {};
  if (row.role === 'donor') {
    const [donors] = await pool.execute('SELECT * FROM donors WHERE user_id = ? LIMIT 1', [row.id]);
    const donor = donors[0];
    if (donor) extra = {
      age: donor.age, gender: donor.gender, bloodGroup: donor.blood_group, weight: donor.weight, height: donor.height,
      address: { street: donor.street, city: donor.city, state: donor.state, pincode: donor.pincode },
      eligibleToDonate: Boolean(donor.eligible_to_donate), lastDonationDate: donor.last_donation_date,
    };
  } else if (facilityRoles.includes(row.role)) {
    extra = await getFacility(row.id) || {};
  }
  res.json({ user: { ...cleanUser(row), ...profile, ...extra, _id: String(row.id), role: row.role, status: row.status } });
}));

// Donor profile, donation history and dashboard
app.get('/api/donor/profile', auth, requireRole('donor'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.full_name, u.email, u.phone, u.status, u.created_at, u.profile_json,
            d.age, d.gender, d.blood_group, d.weight, d.height, d.street, d.city, d.state, d.pincode,
            d.eligible_to_donate, d.last_donation_date, ${donorEligibleSql} AS is_eligible
       FROM users u JOIN donors d ON d.user_id = u.id WHERE u.id = ? LIMIT 1`, [req.user.id],
  );
  if (!rows.length) return res.status(404).json({ message: 'Donor profile not found' });
  const row = rows[0];
  const nextEligibleDate = datePlusDays(row.last_donation_date, 90);
  const savedProfile = parseJson(row.profile_json, {});
  const donor = {
    id: row.id, _id: String(row.id), fullName: row.full_name || row.name, name: row.name,
    email: row.email, phone: row.phone, status: row.status, age: row.age, gender: row.gender,
    bloodGroup: row.blood_group, weight: row.weight, height: row.height,
    address: { street: row.street, city: row.city, state: row.state, pincode: row.pincode },
    eligibleToDonate: Boolean(row.is_eligible), lastDonationDate: row.last_donation_date,
    lastDonation: row.last_donation_date, nextEligibleDate, createdAt: row.created_at,
    healthInfo: savedProfile.healthInfo || { hasDiseases: false, diseaseDetails: '' },
  };
  res.json({ success: true, donor, user: donor });
}));

app.put('/api/donor/profile', auth, requireRole('donor'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const address = body.address || {};
  if (body.password && String(body.password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  if (body.age !== undefined && (!Number.isInteger(toNumber(body.age, NaN)) || toNumber(body.age) < 18 || toNumber(body.age) > 65)) return res.status(400).json({ message: 'Age must be between 18 and 65 years' });
  if (body.weight !== undefined && (!Number.isFinite(toNumber(body.weight, NaN)) || toNumber(body.weight) < 45 || toNumber(body.weight) > 200)) return res.status(400).json({ message: 'Weight must be between 45 and 200 kg' });
  if (body.bloodGroup !== undefined && !allowedGroups.includes(body.bloodGroup)) return res.status(400).json({ message: 'Select a valid blood group' });
  if (body.phone && !/^\d{10}$/.test(String(body.phone))) return res.status(400).json({ message: 'Phone number must contain 10 digits' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE users SET name = COALESCE(?, name), full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?`,
      [body.fullName?.trim() || null, body.fullName?.trim() || null, body.phone?.trim() || null, req.user.id],
    );
    await connection.execute(
      `UPDATE donors SET age = COALESCE(?, age), gender = COALESCE(?, gender), weight = COALESCE(?, weight),
        blood_group = COALESCE(?, blood_group), street = COALESCE(?, street), city = COALESCE(?, city),
        state = COALESCE(?, state), pincode = COALESCE(?, pincode) WHERE user_id = ?`,
      [body.age ?? null, body.gender ?? null, body.weight ?? null, body.bloodGroup ?? null,
        address.street ?? null, address.city ?? null, address.state ?? null, address.pincode ?? null, req.user.id],
    );
    if (body.password) await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(body.password, 12), req.user.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const [updated] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const [donorRows] = await pool.execute(`SELECT d.*, ${donorEligibleSql} AS is_eligible FROM donors d WHERE d.user_id = ?`, [req.user.id]);
  const d = donorRows[0];
  const donor = { id: d.user_id, _id: String(d.user_id), fullName: updated[0].full_name, name: updated[0].name,
    email: updated[0].email, phone: updated[0].phone, age: d.age, gender: d.gender, bloodGroup: d.blood_group,
    weight: d.weight, height: d.height, status: updated[0].status, eligibleToDonate: Boolean(d.is_eligible),
    lastDonationDate: d.last_donation_date, lastDonation: d.last_donation_date,
    address: { street: d.street, city: d.city, state: d.state, pincode: d.pincode } };
  res.json({ success: true, message: 'Donor profile updated successfully', donor });
}));

app.get('/api/donor/history', auth, requireRole('donor'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, donation_date AS donationDate, facility_name AS facility, city, blood_group AS bloodGroup,
            quantity, remarks, status FROM donation_history WHERE donor_id = ? ORDER BY donation_date DESC, id DESC`,
    [req.user.id],
  );
  res.json({ success: true, history: rows, donations: rows, data: rows });
}));
app.get('/api/donor/stats', auth, requireRole('donor'), asyncRoute(async (req, res) => {
  const [[donor]] = await pool.execute(`SELECT d.age, d.weight, d.eligible_to_donate, d.last_donation_date, ${donorEligibleSql} AS is_eligible FROM donors d WHERE d.user_id = ?`, [req.user.id]);
  if (!donor) return res.status(404).json({ message: 'Donor profile not found' });
  const [[stats]] = await pool.execute(
    `SELECT COUNT(*) AS totalDonations, COALESCE(SUM(quantity), 0) AS totalUnits
       FROM donation_history WHERE donor_id = ? AND status = 'completed'`, [req.user.id],
  );
  const nextDate = datePlusDays(donor.last_donation_date, 90);
  let eligibilityStatus = 'Eligible';
  if (!donor.eligible_to_donate) eligibilityStatus = 'Ineligible (Profile restriction)';
  else if (Number(donor.age) < 18 || Number(donor.age) > 65) eligibilityStatus = 'Ineligible (Age constraint)';
  else if (Number(donor.weight) < 45) eligibilityStatus = 'Ineligible (Weight constraint)';
  else if (!donor.is_eligible && nextDate) eligibilityStatus = 'Ineligible (90-day cooldown)';
  res.json({ success: true, dashboard: { totalDonations: Number(stats.totalDonations), totalUnits: Number(stats.totalUnits),
    lastDonationDate: donor.last_donation_date, nextEligibleDonationDate: nextDate, eligibilityStatus } });
}));

// Facility profiles and approved lab directory
app.get('/api/facility/profile', auth, requireRole('hospital', 'blood-lab'), asyncRoute(async (req, res) => {
  const facility = await getFacility(req.user.id);
  if (!facility) return res.status(404).json({ message: 'Facility profile not found' });
  res.json({ success: true, facility, hospital: facility, user: { id: req.user.id, email: req.user.email, role: req.user.role } });
}));
app.put('/api/facility/profile', auth, requireRole('hospital', 'blood-lab'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const address = body.address || {};
  const hours = body.operatingHours || {};
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE users SET name = COALESCE(?, name), full_name = COALESCE(?, full_name), phone = COALESCE(?, phone),
        emergency_contact = COALESCE(?, emergency_contact) WHERE id = ?`,
      [body.name?.trim() || null, body.name?.trim() || null, body.phone || null, body.emergencyContact || null, req.user.id],
    );
    await connection.execute(
      `UPDATE facilities SET facility_category = COALESCE(?, facility_category), street = COALESCE(?, street),
        city = COALESCE(?, city), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
        contact_person = COALESCE(?, contact_person), operating_hours_json = ?, is_24x7 = ?, emergency_services = ?
       WHERE user_id = ?`,
      [body.facilityCategory || null, address.street ?? null, address.city ?? null, address.state ?? null,
        address.pincode ?? null, body.contactPerson ?? null, JSON.stringify(hours),
        Boolean(body.is24x7), Boolean(body.emergencyServices), req.user.id],
    );
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const facility = await getFacility(req.user.id);
  res.json({ success: true, message: 'Facility profile updated successfully', facility });
}));
app.get('/api/facility/labs', auth, requireRole('hospital'), asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id AS _id, u.id, u.name, u.email, u.phone, f.city, f.state,
            f.operating_open, f.operating_close, f.operating_hours_json
       FROM users u JOIN facilities f ON f.user_id = u.id
      WHERE f.facility_type = 'blood-lab' AND u.status = 'approved' ORDER BY u.name`,
  );
  const labs = rows.map((row) => ({
    _id: String(row.id), id: row.id, name: row.name, email: row.email, phone: row.phone,
    city: row.city, state: row.state, address: { city: row.city, state: row.state },
    operatingHours: parseJson(row.operating_hours_json, { open: toTime(row.operating_open), close: toTime(row.operating_close) }),
  }));
  res.json({ success: true, labs });
}));

// Blood inventory (hospital and lab)
async function getInventory(userId) {
  const [rows] = await pool.execute('SELECT * FROM blood_inventory WHERE facility_id = ? ORDER BY blood_group', [userId]);
  return rows.map(mapStock);
}
app.get('/api/hospital/blood/stock', auth, requireRole('hospital'), asyncRoute(async (req, res) => {
  const stock = await getInventory(req.user.id);
  res.json({ success: true, stock, inventory: stock, data: stock });
}));
app.get('/api/blood-lab/blood/stock', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const stock = await getInventory(req.user.id);
  res.json({ success: true, stock, data: stock });
}));
async function changeInventory(req, res, direction) {
  const body = req.body || {};
  const group = body.bloodType || body.bloodGroup;
  const quantity = toNumber(body.quantity ?? body.units);
  if (!allowedGroups.includes(group) || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ success: false, message: 'Select a blood group and enter a whole quantity greater than zero' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (direction === 'add') {
      await connection.execute(
        `INSERT INTO blood_inventory (facility_id, blood_group, units) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE units = units + VALUES(units)`, [req.user.id, group, quantity],
      );
    } else {
      const [result] = await connection.execute(
        'UPDATE blood_inventory SET units = units - ? WHERE facility_id = ? AND blood_group = ? AND units >= ?',
        [quantity, req.user.id, group, quantity],
      );
      if (!result.affectedRows) { await connection.rollback(); return res.status(400).json({ success: false, message: 'Insufficient stock for this blood group' }); }
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.json({ success: true, message: `Blood stock ${direction === 'add' ? 'added' : 'removed'} successfully`, data: await getInventory(req.user.id) });
}
app.post('/api/blood-lab/blood/add', auth, requireRole('blood-lab'), asyncRoute((req, res) => changeInventory(req, res, 'add')));
app.post('/api/blood-lab/blood/remove', auth, requireRole('blood-lab'), asyncRoute((req, res) => changeInventory(req, res, 'remove')));

// Hospital blood requests and lab processing
app.post('/api/hospital/blood/request', auth, requireRole('hospital'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const group = body.bloodType || body.bloodGroup;
  const units = toNumber(body.units || body.quantity);
  const labId = body.labId ? toNumber(body.labId) : null;
  if (!allowedGroups.includes(group) || !Number.isInteger(units) || units < 1) return res.status(400).json({ message: 'Choose a blood group and a whole number of units greater than zero' });
  if (labId) {
    const [lab] = await pool.execute(`SELECT u.id FROM users u JOIN facilities f ON f.user_id = u.id WHERE u.id = ? AND u.role = 'blood-lab' AND u.status = 'approved'`, [labId]);
    if (!lab.length) return res.status(400).json({ message: 'Selected blood lab is unavailable' });
  }
  const [result] = await pool.execute(
    'INSERT INTO blood_requests (hospital_id, lab_id, blood_group, units, notes) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, labId, group, units, body.notes || null],
  );
  res.status(201).json({ success: true, requestId: result.insertId, message: 'Blood request submitted successfully' });
}));
async function fetchRequests(whereSql, params) {
  const [rows] = await pool.execute(
    `SELECT br.*, h.name AS hospital_name, hf.city AS hospital_city, hf.state AS hospital_state,
            l.name AS lab_name, lf.city AS lab_city, lf.state AS lab_state
       FROM blood_requests br JOIN users h ON h.id = br.hospital_id
       LEFT JOIN facilities hf ON hf.user_id = br.hospital_id
       LEFT JOIN users l ON l.id = br.lab_id LEFT JOIN facilities lf ON lf.user_id = br.lab_id
       WHERE ${whereSql} ORDER BY br.created_at DESC`, params,
  );
  return rows.map((row) => ({
    ...row, _id: String(row.id), bloodType: row.blood_group, bloodGroup: row.blood_group,
    hospitalId: { _id: String(row.hospital_id), id: row.hospital_id, name: row.hospital_name, address: { city: row.hospital_city, state: row.hospital_state } },
    labId: row.lab_id ? { _id: String(row.lab_id), id: row.lab_id, name: row.lab_name, address: { city: row.lab_city, state: row.lab_state } } : null,
    hospitalName: row.hospital_name, labName: row.lab_name, createdAt: row.created_at,
    processedAt: row.status === 'pending' ? null : row.updated_at,
  }));
}
app.get('/api/hospital/blood/requests', auth, requireRole('hospital'), asyncRoute(async (req, res) => {
  const requests = await fetchRequests('br.hospital_id = ?', [req.user.id]);
  res.json({ success: true, requests, data: requests });
}));
app.get('/api/blood-lab/blood/requests', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const requests = await fetchRequests('(br.lab_id = ? OR br.lab_id IS NULL)', [req.user.id]);
  res.json({ success: true, requests, data: requests });
}));
async function updateBloodRequest(req, res) {
  const requestId = toNumber(req.params.id);
  const requestedAction = String(req.body?.status || req.body?.action || '').toLowerCase();
  const status = requestedAction === 'accept' ? 'accepted' : requestedAction === 'reject' ? 'rejected' : requestedAction;
  if (!validRequestStatuses.includes(status) || status === 'pending') return res.status(400).json({ message: 'Choose accepted, rejected or fulfilled' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM blood_requests WHERE id = ? AND (lab_id = ? OR lab_id IS NULL) FOR UPDATE', [requestId, req.user.id]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ message: 'Blood request not found' }); }
    const request = rows[0];
    if (status === 'fulfilled' && request.status !== 'accepted') { await connection.rollback(); return res.status(409).json({ message: 'Accept the request before fulfilling it' }); }
    if (request.status === 'fulfilled' || request.status === 'rejected') { await connection.rollback(); return res.status(409).json({ message: `Request is already ${request.status}` }); }
    if (status === 'fulfilled') {
      const [inventory] = await connection.execute('SELECT units FROM blood_inventory WHERE facility_id = ? AND blood_group = ? FOR UPDATE', [req.user.id, request.blood_group]);
      if (!inventory.length || Number(inventory[0].units) < Number(request.units)) { await connection.rollback(); return res.status(400).json({ message: 'Not enough stock to fulfil this request' }); }
      await connection.execute('UPDATE blood_inventory SET units = units - ? WHERE facility_id = ? AND blood_group = ?', [request.units, req.user.id, request.blood_group]);
      await connection.execute(
        `INSERT INTO blood_inventory (facility_id, blood_group, units) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE units = units + VALUES(units)`,
        [request.hospital_id, request.blood_group, request.units],
      );
    }
    await connection.execute('UPDATE blood_requests SET lab_id = ?, status = ? WHERE id = ?', [req.user.id, status, requestId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.json({ success: true, message: `Request ${status} successfully` });
}
app.put('/api/blood-lab/blood/requests/:id', auth, requireRole('blood-lab'), asyncRoute(updateBloodRequest));
app.patch('/api/blood-lab/blood/requests/:id', auth, requireRole('blood-lab'), asyncRoute(updateBloodRequest));

// Shared donor directory, contact logging and donation recording
async function donorSearch(term, bloodGroup = '') {
  const pattern = `%${term}%`;
  let groupClause = '';
  if (bloodGroup && allowedGroups.includes(bloodGroup)) groupClause = ' AND d.blood_group = ?';
  const [rows] = await pool.execute(
    `SELECT u.id AS _id, u.id, u.full_name AS fullName, u.name, u.email, u.phone, u.status,
            d.blood_group AS bloodGroup, d.age, d.gender, d.weight, d.city, d.state,
            ${donorEligibleSql} AS eligibleToDonate, d.last_donation_date AS lastDonationDate,
            (SELECT COUNT(*) FROM donation_history dh WHERE dh.donor_id = u.id AND dh.status = 'completed') AS totalDonations
       FROM users u JOIN donors d ON d.user_id = u.id
      WHERE u.role = 'donor' AND u.status = 'active'
        AND (u.full_name LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?) ${groupClause}
      ORDER BY u.full_name LIMIT 100`,
    [pattern, pattern, pattern, pattern, ...(groupClause ? [bloodGroup] : [])],
  );
  return rows.map((r) => ({ ...r, _id: String(r.id), age: Number(r.age), eligibleToDonate: Boolean(r.eligibleToDonate), totalDonations: Number(r.totalDonations) }));
}
app.get('/api/hospital/donors', auth, requireRole('hospital'), asyncRoute(async (req, res) => {
  const term = `%${String(req.query.search || req.query.term || '')}%`;
  const conditions = ["u.role = 'donor'", "u.status = 'active'", '(u.full_name LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'];
  const args = [term, term, term, term];
  if (req.query.bloodGroup && req.query.bloodGroup !== 'all' && allowedGroups.includes(req.query.bloodGroup)) {
    conditions.push('d.blood_group = ?'); args.push(req.query.bloodGroup);
  }
  if (req.query.city && req.query.city !== 'all') { conditions.push('d.city = ?'); args.push(req.query.city); }
  if (req.query.availability === 'available') conditions.push("d.eligible_to_donate = 1 AND (d.last_donation_date IS NULL OR d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AND d.age BETWEEN 18 AND 65 AND d.weight >= 45");
  if (req.query.availability === 'unavailable') conditions.push("(d.eligible_to_donate = 0 OR (d.last_donation_date IS NOT NULL AND d.last_donation_date > DATE_SUB(CURDATE(), INTERVAL 90 DAY)) OR d.age NOT BETWEEN 18 AND 65 OR d.weight < 45)");
  const orderBy = req.query.sortBy === 'name' ? 'u.full_name ASC' : req.query.sortBy === 'age' ? 'd.age DESC' : 'd.last_donation_date ASC';
  const [donors] = await pool.execute(
    `SELECT u.id AS _id, u.id, u.full_name AS fullName, u.name, u.email, u.phone,
            d.blood_group AS bloodGroup, d.age, d.gender, d.weight, d.city, d.state,
            (d.eligible_to_donate = 1 AND d.age BETWEEN 18 AND 65 AND d.weight >= 45 AND (d.last_donation_date IS NULL OR d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 90 DAY))) AS eligibleToDonate,
            d.last_donation_date AS lastDonationDate
       FROM users u JOIN donors d ON d.user_id = u.id WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT 150`, args,
  );
  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN d.eligible_to_donate = 1 AND d.age BETWEEN 18 AND 65 AND d.weight >= 45 AND (d.last_donation_date IS NULL OR d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) THEN 1 ELSE 0 END) AS available
       FROM donors d JOIN users u ON u.id = d.user_id WHERE u.status = 'active'`,
  );
  const mapped = donors.map((d) => ({ ...d, _id: String(d.id), age: Number(d.age), eligibleToDonate: Boolean(d.eligibleToDonate) }));
  res.json({ success: true, donors: mapped, data: mapped, stats: { total: Number(totals.total), available: Number(totals.available || 0), rareBlood: mapped.filter((d) => ['AB-', 'B-', 'O-'].includes(d.bloodGroup)).length } });
}));
app.post('/api/hospital/donors/:donorId/contact', auth, requireRole('hospital'), asyncRoute(async (req, res) => {
  const donorId = toNumber(req.params.donorId);
  const [donor] = await pool.execute("SELECT id FROM users WHERE id = ? AND role = 'donor'", [donorId]);
  if (!donor.length) return res.status(404).json({ message: 'Donor not found' });
  await pool.execute('INSERT INTO donor_contact_logs (hospital_id, donor_id, notes) VALUES (?, ?, ?)', [req.user.id, donorId, req.body?.notes || null]);
  res.json({ success: true, message: 'Contact attempt logged' });
}));
app.get('/api/blood-lab/donors/search', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const donors = await donorSearch(String(req.query.term || req.query.search || ''));
  res.json({ success: true, donors });
}));
app.get('/api/blood-lab/donations/recent', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT dh.id AS _id, dh.id, dh.donor_id AS donorId, u.full_name AS donorName, u.phone,
            dh.donation_date AS donationDate, dh.blood_group AS bloodGroup, dh.quantity, dh.remarks, dh.status
       FROM donation_history dh JOIN users u ON u.id = dh.donor_id
      WHERE dh.facility_id = ? ORDER BY dh.created_at DESC LIMIT 30`, [req.user.id],
  );
  const [[stats]] = await pool.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN donation_date = CURDATE() THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN donation_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS thisWeek
       FROM donation_history WHERE facility_id = ? AND status = 'completed'`, [req.user.id],
  );
  res.json({ success: true, donations: rows, stats: { total: Number(stats.total || 0), today: Number(stats.today || 0), thisWeek: Number(stats.thisWeek || 0) } });
}));
app.post('/api/blood-lab/donors/donate/:donorId', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const donorId = toNumber(req.params.donorId);
  const quantity = toNumber(req.body?.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return res.status(400).json({ message: 'Donation quantity must be between 1 and 10 units' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [donorRows] = await connection.execute(
      `SELECT u.id, u.full_name, d.age, d.weight, d.blood_group, d.eligible_to_donate, d.last_donation_date, CURDATE() AS db_today
         FROM users u JOIN donors d ON d.user_id = u.id WHERE u.id = ? AND u.role = 'donor' AND u.status = 'active' FOR UPDATE`, [donorId],
    );
    if (!donorRows.length) { await connection.rollback(); return res.status(404).json({ message: 'Active donor not found' }); }
    const donor = donorRows[0];
    if (!donor.eligible_to_donate || Number(donor.age) < 18 || Number(donor.age) > 65 || Number(donor.weight) < 45) {
      await connection.rollback(); return res.status(400).json({ message: 'Donor does not meet the configured age, weight or profile eligibility checks' });
    }
    if (donor.last_donation_date) {
      const nextDate = datePlusDays(donor.last_donation_date, 90);
      if (nextDate && nextDate > String(donor.db_today).slice(0, 10)) { await connection.rollback(); return res.status(400).json({ message: `Donor is in the 90-day donation interval until ${nextDate}` }); }
    }
    const [[lab]] = await connection.execute('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const [facilityRows] = await connection.execute('SELECT city FROM facilities WHERE user_id = ?', [req.user.id]);
    const group = req.body?.bloodGroup || donor.blood_group;
    if (!allowedGroups.includes(group) || group !== donor.blood_group) { await connection.rollback(); return res.status(400).json({ message: 'Donation blood group must match the donor profile' }); }
    await connection.execute(
      `INSERT INTO donation_history (donor_id, facility_id, donation_date, facility_name, city, blood_group, quantity, remarks, status)
       VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, 'completed')`,
      [donorId, req.user.id, lab.name, facilityRows[0]?.city || null, group, quantity, req.body?.remarks || null],
    );
    await connection.execute(
      'INSERT INTO blood_inventory (facility_id, blood_group, units) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE units = units + VALUES(units)',
      [req.user.id, group, quantity],
    );
    await connection.execute('UPDATE donors SET last_donation_date = CURDATE() WHERE user_id = ?', [donorId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.status(201).json({ success: true, message: 'Donation recorded and blood inventory updated' });
}));

// Blood lab dashboard and activity history
app.get('/api/blood-lab/dashboard', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const facility = await getFacility(req.user.id);
  const stock = await getInventory(req.user.id);
  const [[donationStats]] = await pool.execute(
    `SELECT COUNT(*) AS totalDonations, COALESCE(SUM(quantity), 0) AS totalUnits,
            SUM(CASE WHEN donation_date = CURDATE() THEN 1 ELSE 0 END) AS today
       FROM donation_history WHERE facility_id = ? AND status = 'completed'`, [req.user.id],
  );
  const campResult = await listCamps({ facilityId: req.user.id, page: 1, limit: 5 });
  const recentActivity = [
    ...campResult.camps.slice(0, 3).map((camp) => ({ eventType: 'Camp', description: `${camp.title} — ${camp.status}`, date: camp.createdAt || camp.date })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  res.json({ success: true, facility, stats: {
    totalDonations: Number(donationStats.totalDonations || 0), totalUnits: Number(donationStats.totalUnits || 0),
    donationsToday: Number(donationStats.today || 0), inventoryUnits: stock.reduce((sum, item) => sum + item.quantity, 0),
  }, recentCamps: campResult.camps, recentActivity, data: { facility, stock, recentCamps: campResult.camps } });
}));
app.get('/api/blood-lab/history', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT dh.id, dh.donation_date AS date, dh.facility_name, dh.blood_group, dh.quantity,
            u.full_name AS donor_name
       FROM donation_history dh JOIN users u ON u.id = dh.donor_id
      WHERE dh.facility_id = ? ORDER BY dh.created_at DESC LIMIT 30`, [req.user.id],
  );
  const activity = rows.map((r) => ({ id: r.id, eventType: 'Donation', description: `${r.donor_name || 'Donor'} donated ${r.quantity} unit(s) of ${r.blood_group || 'blood'}`, date: r.date }));
  res.json({ success: true, activity, history: activity });
}));

// Blood camp management (lab) and donor camp directory
app.get('/api/blood-lab/camps', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const page = Math.max(1, toNumber(req.query.page, 1));
  const limit = Math.min(100, Math.max(1, toNumber(req.query.limit, 50)));
  const result = await listCamps({ facilityId: req.user.id, status: String(req.query.status || ''), search: String(req.query.search || req.query.q || ''), page, limit, sortBy: String(req.query.sortBy || 'date'), sortOrder: String(req.query.sortOrder || 'asc') });
  const stats = { total: result.pagination.total, upcoming: 0, ongoing: 0, completed: 0, cancelled: 0 };
  for (const camp of result.camps) {
    if (camp.status === 'Upcoming') stats.upcoming++;
    else if (camp.status === 'Ongoing') stats.ongoing++;
    else if (camp.status === 'Completed') stats.completed++;
    else if (camp.status === 'Cancelled') stats.cancelled++;
  }
  res.json({ success: true, data: { camps: result.camps, pagination: result.pagination }, camps: result.camps, pagination: result.pagination, stats });
}));
app.post('/api/blood-lab/camps', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const c = campInput(req.body);
  if (!c.title || !c.date || !c.venue || !c.city || !c.state || !c.start || !c.end || c.start >= c.end || c.expected < 1) return res.status(400).json({ success: false, message: 'Complete all required camp fields and provide a valid time range and donor capacity' });
  if (new Date(`${c.date}T00:00:00`) < new Date(new Date().toDateString())) return res.status(400).json({ success: false, message: 'Camp date cannot be in the past' });
  const [result] = await pool.execute(
    `INSERT INTO blood_camps (facility_id, title, description, event_date, start_time, end_time, venue, city, state, pincode, expected_donors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, c.title, c.description, c.date, c.start, c.end, c.venue, c.city, c.state, c.pincode, c.expected],
  );
  res.status(201).json({ success: true, message: 'Blood camp created successfully', campId: result.insertId });
}));
app.put('/api/blood-lab/camps/:id', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const c = campInput(req.body);
  if (!c.title || !c.date || !c.venue || !c.city || !c.state || !c.start || !c.end || c.start >= c.end || c.expected < 1) return res.status(400).json({ success: false, message: 'Complete all required camp fields and provide a valid time range and donor capacity' });
  const [result] = await pool.execute(
    `UPDATE blood_camps SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, venue = ?, city = ?, state = ?, pincode = ?, expected_donors = ?
      WHERE id = ? AND facility_id = ?`,
    [c.title, c.description, c.date, c.start, c.end, c.venue, c.city, c.state, c.pincode, c.expected, req.params.id, req.user.id],
  );
  if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Camp not found' });
  res.json({ success: true, message: 'Blood camp updated successfully' });
}));
app.patch('/api/blood-lab/camps/:id/status', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!validCampStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid camp status' });
  const [result] = await pool.execute('UPDATE blood_camps SET status = ? WHERE id = ? AND facility_id = ?', [status, req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Camp not found' });
  res.json({ success: true, message: 'Camp status updated' });
}));
app.patch('/api/blood-lab/camps/:id', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  if (req.body?.status) {
    const status = req.body.status;
    if (!validCampStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid camp status' });
    const [result] = await pool.execute('UPDATE blood_camps SET status = ? WHERE id = ? AND facility_id = ?', [status, req.params.id, req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Camp not found' });
    return res.json({ success: true, message: 'Camp status updated' });
  }
  res.status(400).json({ success: false, message: 'No camp update supplied' });
}));
app.delete('/api/blood-lab/camps/:id', auth, requireRole('blood-lab'), asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM blood_camps WHERE id = ? AND facility_id = ?', [req.params.id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Camp not found' });
  res.json({ success: true, message: 'Blood camp deleted successfully' });
}));
app.get('/api/donor/camps', auth, requireRole('donor'), asyncRoute(async (req, res) => {
  const page = Math.max(1, toNumber(req.query.page, 1));
  const limit = Math.min(100, Math.max(1, toNumber(req.query.limit, 9)));
  const result = await listCamps({ status: String(req.query.status || ''), search: String(req.query.search || req.query.q || ''), page, limit });
  const payload = { camps: result.camps, pagination: result.pagination };
  res.json({ success: true, data: payload, camps: result.camps, pagination: result.pagination });
}));

// Admin operations
app.get('/api/admin/dashboard', auth, requireRole('admin'), asyncRoute(async (_req, res) => {
  const [[donors]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'donor'");
  const [[facilities]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role IN ('hospital', 'blood-lab')");
  const [[pending]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role IN ('hospital', 'blood-lab') AND status = 'pending'");
  const [[approved]] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role IN ('hospital', 'blood-lab') AND status = 'approved'");
  const [[donations]] = await pool.query("SELECT COUNT(*) AS total FROM donation_history WHERE status = 'completed'");
  const [[requests]] = await pool.query("SELECT COUNT(*) AS total FROM blood_requests WHERE status = 'pending'");
  const [[camps]] = await pool.query("SELECT COUNT(*) AS total FROM blood_camps WHERE status IN ('Upcoming', 'Ongoing')");
  res.json({ totalDonors: Number(donors.total), totalFacilities: Number(facilities.total), pendingFacilities: Number(pending.total), approvedFacilities: Number(approved.total), totalDonations: Number(donations.total), pendingRequests: Number(requests.total), upcomingCamps: Number(camps.total) });
}));
app.get('/api/admin/facilities', auth, requireRole('admin'), asyncRoute(async (req, res) => {
  const status = String(req.query.status || '');
  const params = [];
  let clause = "WHERE u.role IN ('hospital', 'blood-lab')";
  if (status && ['pending', 'approved', 'rejected'].includes(status)) { clause += ' AND u.status = ?'; params.push(status); }
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.full_name, u.email, u.phone, u.emergency_contact, u.status, u.created_at,
            u.rejection_reason, f.facility_type, f.registration_number, f.facility_category, f.street,
            f.city, f.state, f.pincode, f.registration_proof_url, f.operating_open, f.operating_close,
            f.working_days, f.operating_hours_json, f.contact_person, f.is_24x7, f.emergency_services
       FROM users u JOIN facilities f ON f.user_id = u.id ${clause} ORDER BY u.created_at DESC`, params,
  );
  const facilities = rows.map((r) => ({
    _id: String(r.id), id: r.id, name: r.name || r.full_name, email: r.email, phone: r.phone,
    emergencyContact: r.emergency_contact, status: r.status,
    facilityType: r.facility_type, facilityTypeLabel: r.facility_type === 'blood-lab' ? 'Blood Lab' : 'Hospital',
    facilityCategory: r.facility_category, registrationNumber: r.registration_number,
    contactPerson: r.contact_person, address: { street: r.street, city: r.city, state: r.state, pincode: r.pincode },
    registrationProofUrl: r.registration_proof_url, documents: r.registration_proof_url ? [r.registration_proof_url] : [],
    operatingHours: parseJson(r.operating_hours_json, { open: toTime(r.operating_open), close: toTime(r.operating_close) }),
    workingDays: parseJson(r.working_days, []), is24x7: Boolean(r.is_24x7), emergencyServices: Boolean(r.emergency_services),
    rejectionReason: r.rejection_reason, createdAt: r.created_at,
  }));
  res.json({ success: true, facilities });
}));
app.put('/api/admin/facility/approve/:facilityId', auth, requireRole('admin'), asyncRoute(async (req, res) => {
  const [result] = await pool.execute("UPDATE users SET status = 'approved', rejection_reason = NULL WHERE id = ? AND role IN ('hospital', 'blood-lab') AND status = 'pending'", [req.params.facilityId]);
  if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Pending facility not found' });
  res.json({ success: true, message: 'Facility approved successfully' });
}));
app.put('/api/admin/facility/reject/:facilityId', auth, requireRole('admin'), asyncRoute(async (req, res) => {
  const reason = String(req.body?.rejectionReason || req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ success: false, message: 'Please provide a rejection reason' });
  const [result] = await pool.execute("UPDATE users SET status = 'rejected', rejection_reason = ? WHERE id = ? AND role IN ('hospital', 'blood-lab') AND status = 'pending'", [reason, req.params.facilityId]);
  if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Pending facility not found' });
  res.json({ success: true, message: 'Facility rejected successfully' });
}));
app.get('/api/admin/donors', auth, requireRole('admin'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.name, u.email, u.phone, u.status, u.created_at,
            d.age, d.gender, d.blood_group, d.weight, d.height, d.city, d.state,
            ${donorEligibleSql} AS computed_eligibility, d.last_donation_date,
            (SELECT COUNT(*) FROM donation_history dh WHERE dh.donor_id = u.id AND dh.status = 'completed') AS donation_count,
            (SELECT COALESCE(SUM(dh.quantity), 0) FROM donation_history dh WHERE dh.donor_id = u.id AND dh.status = 'completed') AS total_units
       FROM users u JOIN donors d ON d.user_id = u.id WHERE u.role = 'donor' ORDER BY u.created_at DESC`,
  );
  const donors = rows.map((r) => ({ _id: String(r.id), id: r.id, fullName: r.full_name || r.name, name: r.name, email: r.email,
    phone: r.phone, status: r.status, age: Number(r.age), gender: r.gender, bloodGroup: r.blood_group,
    weight: r.weight, height: r.height, city: r.city, state: r.state, eligibleToDonate: Boolean(r.computed_eligibility),
    lastDonationDate: r.last_donation_date, donationCount: Number(r.donation_count), totalUnits: Number(r.total_units) }));
  res.json({ success: true, donors });
}));

app.use((_req, res) => res.status(404).json({ message: 'API route not found' }));
app.use((error, _req, res, _next) => {
  console.error('[API error]', error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A record with the same unique value already exists' });
  res.status(500).json({ message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
});

if (!JWT_SECRET || JWT_SECRET.length < 24) {
  console.error('JWT_SECRET is missing or too short. Set a unique secret of at least 24 characters in backend/.env.');
  process.exit(1);
}
await testDatabase();
app.listen(PORT, () => console.log(`Blood Bank API running at http://localhost:${PORT}`));
