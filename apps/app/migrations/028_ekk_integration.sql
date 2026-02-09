-- Migration 028: EKK/IKK integration tables
-- Track control reports and their status through the workflow

CREATE TABLE IF NOT EXISTS ekk_reports (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL DEFAULT 'elkontroll',  -- elkontroll, brannkontroll, ikkontroll
  external_report_id TEXT,                          -- ID in EKK system
  status TEXT NOT NULL DEFAULT 'utkast',            -- utkast, sendt_fg, fakturert, ferdig
  fg_submitted_at TIMESTAMPTZ,                      -- When submitted to FG (Finans Garanti)
  invoice_reference TEXT,                            -- Tripletex invoice/project reference
  checklist_data JSONB DEFAULT '{}',                -- Checklist data from EKK
  report_url TEXT,                                   -- URL to report in EKK
  notes TEXT,
  created_by INTEGER,                                -- klient.id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ekk_reports_org ON ekk_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_ekk_reports_kunde ON ekk_reports(kunde_id);
CREATE INDEX IF NOT EXISTS idx_ekk_reports_status ON ekk_reports(organization_id, status);

-- RLS
ALTER TABLE ekk_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ekk_reports_service ON ekk_reports;
CREATE POLICY ekk_reports_service ON ekk_reports
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
