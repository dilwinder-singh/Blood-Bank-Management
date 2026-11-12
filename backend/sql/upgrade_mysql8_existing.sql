-- Run this ONCE only if you already created the older MySQL schema.sql.
-- Select the blood_bank_management database before running this migration.
USE blood_bank_management;

ALTER TABLE users
  ADD COLUMN rejection_reason TEXT NULL AFTER status;

ALTER TABLE facilities
  ADD COLUMN operating_hours_json JSON NULL AFTER operating_close,
  ADD COLUMN contact_person VARCHAR(150) NULL AFTER working_days,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE blood_inventory
  ADD COLUMN expiry_date DATE NULL AFTER units;

ALTER TABLE blood_camps
  ADD COLUMN pincode VARCHAR(10) NULL AFTER state,
  ADD COLUMN actual_donors INT UNSIGNED NOT NULL DEFAULT 0 AFTER expected_donors,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Older installations may not have created donation_history yet.
CREATE TABLE IF NOT EXISTS donation_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  donor_id BIGINT UNSIGNED NOT NULL,
  donation_date DATE NOT NULL,
  facility_name VARCHAR(200) NULL,
  city VARCHAR(100) NULL,
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  remarks TEXT NULL,
  status ENUM('completed','pending','cancelled') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_donation_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_donation_donor_date (donor_id, donation_date)
) ENGINE=InnoDB;

ALTER TABLE donation_history
  ADD COLUMN facility_id BIGINT UNSIGNED NULL AFTER donor_id,
  ADD INDEX idx_donation_facility_date (facility_id, donation_date),
  ADD CONSTRAINT fk_donation_facility FOREIGN KEY (facility_id) REFERENCES facilities(user_id) ON DELETE SET NULL;

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
