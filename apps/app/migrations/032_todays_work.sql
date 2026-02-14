-- Migration 032: Today's work / field technician view
-- Adds route assignment to technicians and planned dates

-- Route assignment to technician
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES brukere(id);
ALTER TABLE ruter ADD COLUMN IF NOT EXISTS planned_date DATE;
CREATE INDEX IF NOT EXISTS idx_ruter_assigned ON ruter(assigned_to, planned_date);

-- Feature flag (default_enabled=true = MVP for all orgs)
INSERT INTO feature_definitions (key, name, description, category, default_enabled, sort_order)
VALUES ('todays_work', 'Dagens arbeid', 'Feltarbeid-visning for teknikere med rute-tildeling og daglig planlegging', 'feltarbeid', true, 90)
ON CONFLICT (key) DO NOTHING;
