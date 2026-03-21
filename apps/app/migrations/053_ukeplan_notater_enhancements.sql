-- Huskeliste v2: Note types, assignment, target day, carry-forward
-- Extends ukeplan_notater with categorization, team assignment, and workflow features

ALTER TABLE ukeplan_notater ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'notat';
ALTER TABLE ukeplan_notater ADD COLUMN IF NOT EXISTS tilordnet TEXT;
ALTER TABLE ukeplan_notater ADD COLUMN IF NOT EXISTS maldag TEXT;
ALTER TABLE ukeplan_notater ADD COLUMN IF NOT EXISTS overfort_fra INTEGER REFERENCES ukeplan_notater(id) ON DELETE SET NULL;

-- Index for carry-forward query (uncompleted notes from previous weeks)
CREATE INDEX IF NOT EXISTS idx_ukeplan_notater_overforte
  ON ukeplan_notater(organization_id, fullfort, uke_start);
