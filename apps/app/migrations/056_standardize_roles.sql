-- Migration: Standardize roles to admin/teammedlem/kontor/leser
-- Replaces legacy role values: 'medlem' → 'leser', 'redigerer' → 'teammedlem', 'tekniker' → 'teammedlem'

-- Update legacy roles in klient table
UPDATE klient SET rolle = 'leser' WHERE rolle = 'medlem';
UPDATE klient SET rolle = 'teammedlem' WHERE rolle = 'redigerer';
UPDATE klient SET rolle = 'teammedlem' WHERE rolle = 'tekniker';

-- Update legacy roles in brukere table (if any)
UPDATE brukere SET rolle = 'leser' WHERE rolle = 'medlem';
UPDATE brukere SET rolle = 'teammedlem' WHERE rolle = 'bruker';
UPDATE brukere SET rolle = 'teammedlem' WHERE rolle = 'tekniker';
