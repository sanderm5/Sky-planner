-- Add smart_clusters feature (Ruteplanlegger with geographic clustering)
-- default_enabled = false → only orgs that explicitly enable it (Tre Allservice) get it

INSERT INTO feature_definitions (key, name, description, category, default_enabled, dependencies, sort_order) VALUES
  ('smart_clusters', 'Smarte ruteklynger', 'Ruteplanlegger med geografisk klynging og effektivitetsberegning', 'ruter', false, NULL, 90)
ON CONFLICT (key) DO NOTHING;
