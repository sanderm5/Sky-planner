-- Fix: assigned_to FK points to brukere but team members are in klient
-- Drop the incorrect FK constraint and re-add pointing to klient

-- Drop the old constraint (brukere)
ALTER TABLE ruter DROP CONSTRAINT IF EXISTS ruter_assigned_to_fkey;

-- Re-add pointing to klient (where team members actually live)
ALTER TABLE ruter ADD CONSTRAINT ruter_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES klient(id) ON DELETE SET NULL;
