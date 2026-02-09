-- Migration 027: Customer email templates
-- Configurable email templates per organization for manual customer communication

CREATE TABLE IF NOT EXISTS customer_email_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system template
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generell',  -- forespørsel, bekreftelse, påminnelse, generell
  is_system BOOLEAN DEFAULT false,
  aktiv BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_org ON customer_email_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON customer_email_templates(category);

-- Log of sent customer emails (extends the existing email_varsler system)
CREATE TABLE IF NOT EXISTS customer_emails_sent (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kunde_id INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES customer_email_templates(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',  -- sent, failed
  error_message TEXT,
  sent_by INTEGER,  -- klient.id who sent it
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_sent_org ON customer_emails_sent(organization_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_kunde ON customer_emails_sent(kunde_id);

-- RLS
ALTER TABLE customer_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_emails_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_read ON customer_email_templates;
CREATE POLICY email_templates_read ON customer_email_templates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS email_templates_write ON customer_email_templates;
CREATE POLICY email_templates_write ON customer_email_templates
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS emails_sent_service ON customer_emails_sent;
CREATE POLICY emails_sent_service ON customer_emails_sent
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed system templates (available to all organizations)
-- Variables: {{kunde_navn}}, {{kunde_adresse}}, {{neste_kontroll}}, {{org_navn}}, {{kontaktperson}}
INSERT INTO customer_email_templates (organization_id, name, subject_template, body_template, category, is_system, sort_order) VALUES
  (NULL, 'Forespørsel om kontroll', 'Forespørsel om kontroll – {{kunde_navn}}',
   '<p>Hei {{kontaktperson}},</p><p>Vi ønsker å informere om at det nærmer seg tid for kontroll hos <strong>{{kunde_navn}}</strong>.</p><p>Planlagt dato: <strong>{{neste_kontroll}}</strong></p><p>Vennligst ta kontakt for å avtale tidspunkt.</p><p>Med vennlig hilsen,<br>{{org_navn}}</p>',
   'forespørsel', true, 10),

  (NULL, 'Bekreftelse på oppdrag', 'Bekreftelse – oppdrag hos {{kunde_navn}}',
   '<p>Hei {{kontaktperson}},</p><p>Vi bekrefter herved oppdrag hos <strong>{{kunde_navn}}</strong>, {{kunde_adresse}}.</p><p>Dato: <strong>{{neste_kontroll}}</strong></p><p>Ta gjerne kontakt om du har spørsmål.</p><p>Med vennlig hilsen,<br>{{org_navn}}</p>',
   'bekreftelse', true, 20),

  (NULL, 'Påminnelse om kontroll', 'Påminnelse: Kontroll hos {{kunde_navn}}',
   '<p>Hei {{kontaktperson}},</p><p>Dette er en vennlig påminnelse om at det er tid for kontroll hos <strong>{{kunde_navn}}</strong>.</p><p>Forrige kontroll: <strong>{{siste_kontroll}}</strong><br>Neste kontroll: <strong>{{neste_kontroll}}</strong></p><p>Vennligst ta kontakt for å bekrefte.</p><p>Med vennlig hilsen,<br>{{org_navn}}</p>',
   'påminnelse', true, 30),

  (NULL, 'Generell melding', '{{emne}}',
   '<p>Hei {{kontaktperson}},</p><p>{{melding}}</p><p>Med vennlig hilsen,<br>{{org_navn}}</p>',
   'generell', true, 40)
ON CONFLICT DO NOTHING;
