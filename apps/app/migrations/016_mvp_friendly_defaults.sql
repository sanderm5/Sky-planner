-- Migration: MVP mode setup
-- Sets TRE Allservice to 'full' mode, all others to 'mvp'

-- Set TRE Allservice to 'full' mode
UPDATE organizations
SET app_mode = 'full'
WHERE LOWER(navn) LIKE '%tre allservice%'
   OR LOWER(navn) LIKE '%tre-allservice%';

-- Set all others to 'mvp' mode
UPDATE organizations
SET app_mode = 'mvp'
WHERE app_mode IS NULL
   OR app_mode = '';
