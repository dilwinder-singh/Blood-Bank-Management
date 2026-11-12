-- Legacy convenience script retained for older installations.
-- For a complete upgrade of an existing project database, use
-- upgrade_mysql8_existing.sql instead (run it only once).
-- For a fresh installation, use schema.sql.

USE blood_bank_management;

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
