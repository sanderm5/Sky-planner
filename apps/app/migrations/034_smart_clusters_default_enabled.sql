-- Migration 034: Promote smart_clusters to default (all orgs)
-- Previously enterprise-only, now available to everyone

UPDATE feature_definitions SET default_enabled = true WHERE key = 'smart_clusters';

-- Enable for all existing orgs that don't already have it
INSERT INTO organization_features (organization_id, feature_key, enabled, config)
SELECT o.id, 'smart_clusters', true, '{}'::jsonb
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_features of2
  WHERE of2.organization_id = o.id AND of2.feature_key = 'smart_clusters'
)
ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = true;
