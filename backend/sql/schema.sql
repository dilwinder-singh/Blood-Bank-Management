-- Blood Bank Management System - MySQL 8.0
-- Fresh database setup. Run this whole file in MySQL Workbench.

CREATE DATABASE IF NOT EXISTS blood_bank_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE blood_bank_management;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  full_name VARCHAR(200) NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('donor','hospital','blood-lab','admin') NOT NULL,
  phone VARCHAR(20) NULL,
  emergency_contact VARCHAR(20) NULL,
  status ENUM('pending','approved','rejected','active') NOT NULL DEFAULT 'active',
  rejection_reason TEXT NULL,
  profile_json JSON NULL,
  last_login DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_status (status),
  INDEX idx_users_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donors (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  age TINYINT UNSIGNED NULL,
  gender VARCHAR(20) NULL,
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  weight DECIMAL(5,2) NULL,
  height DECIMAL(5,2) NULL,
  street VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  pincode VARCHAR(10) NULL,
  eligible_to_donate BOOLEAN NOT NULL DEFAULT TRUE,
  last_donation_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_donors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_donors_blood_group (blood_group),
  INDEX idx_donors_city (city, state),
  INDEX idx_donors_eligibility (eligible_to_donate, last_donation_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS facilities (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  facility_type ENUM('hospital','blood-lab') NOT NULL,
  registration_number VARCHAR(100) NOT NULL UNIQUE,
  facility_category VARCHAR(50) NULL,
  street VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  pincode VARCHAR(10) NULL,
  registration_proof_url TEXT NULL,
  operating_open TIME NULL,
  operating_close TIME NULL,
  operating_hours_json JSON NULL,
  working_days JSON NULL,
  contact_person VARCHAR(150) NULL,
  is_24x7 BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_services BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_facilities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_facilities_type_city (facility_type, city)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_inventory (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  facility_id BIGINT UNSIGNED NOT NULL,
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  units INT UNSIGNED NOT NULL DEFAULT 0,
  expiry_date DATE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_facility_group (facility_id, blood_group),
  CONSTRAINT fk_inventory_facility FOREIGN KEY (facility_id) REFERENCES facilities(user_id) ON DELETE CASCADE,
  INDEX idx_inventory_group (blood_group)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT UNSIGNED NOT NULL,
  lab_id BIGINT UNSIGNED NULL,
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  units INT UNSIGNED NOT NULL,
  status ENUM('pending','accepted','rejected','fulfilled') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_request_hospital FOREIGN KEY (hospital_id) REFERENCES facilities(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_request_lab FOREIGN KEY (lab_id) REFERENCES facilities(user_id) ON DELETE SET NULL,
  INDEX idx_requests_hospital (hospital_id, created_at),
  INDEX idx_requests_lab_status (lab_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_camps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  facility_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  event_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  venue VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  pincode VARCHAR(10) NULL,
  expected_donors INT UNSIGNED NOT NULL DEFAULT 0,
  actual_donors INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('Upcoming','Ongoing','Completed','Cancelled') NOT NULL DEFAULT 'Upcoming',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_camps_facility FOREIGN KEY (facility_id) REFERENCES facilities(user_id) ON DELETE CASCADE,
  INDEX idx_camps_date_status (event_date, status),
  INDEX idx_camps_facility (facility_id, event_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donation_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  donor_id BIGINT UNSIGNED NOT NULL,
  facility_id BIGINT UNSIGNED NULL,
  donation_date DATE NOT NULL,
  facility_name VARCHAR(200) NULL,
  city VARCHAR(100) NULL,
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  remarks TEXT NULL,
  status ENUM('completed','pending','cancelled') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_donation_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donation_facility FOREIGN KEY (facility_id) REFERENCES facilities(user_id) ON DELETE SET NULL,
  INDEX idx_donation_donor_date (donor_id, donation_date),
  INDEX idx_donation_facility_date (facility_id, donation_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS donor_contact_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT UNSIGNED NOT NULL,
  donor_id BIGINT UNSIGNED NOT NULL,
  notes TEXT NULL,
  contacted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contact_hospital FOREIGN KEY (hospital_id) REFERENCES facilities(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_contact_donor (donor_id, contacted_at)
) ENGINE=InnoDB;

-- Seed the administrator separately with: npm run seed:admin
