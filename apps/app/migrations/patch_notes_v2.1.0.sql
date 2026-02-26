INSERT INTO patch_notes (version, title, summary, items) VALUES (
  'v2.1.0',
  'Dekningsomrader, forbedret kart og kontekstmeny',
  'Ny funksjonalitet for dekningsomrader, utvidet hoyreklikkmeny, Google Maps-ruter i kalender, og en rekke forbedringer og feilrettinger.',
  '[
    {"text": "Dekningsomrader med isokron-visualisering", "type": "nytt", "visibility": "mvp", "description": "Se og administrer dekningsomrader direkte i kartet med kjoretidsbaserte soner", "tab": "kunder"},
    {"text": "Utvidet hoyreklikkmeny pa kart, kundeliste, kalender og ukeplan", "type": "nytt", "visibility": "mvp", "description": "Nytt generisk kontekstmenysystem med flere handlinger tilgjengelig fra hoyreklikk"},
    {"text": "Google Maps-rute direkte fra kalender", "type": "nytt", "visibility": "mvp", "description": "Apne dagens avtaler som optimert rute i Google Maps med ett klikk", "tab": "kalender"},
    {"text": "Forbedret omradevalg pa kart", "type": "forbedring", "visibility": "mvp", "description": "Dra-for-a-velge kunder er na raskere og mer responsivt", "tab": "kunder"},
    {"text": "Forbedrede ukeplan-funksjoner", "type": "forbedring", "visibility": "mvp", "description": "Hoyreklikkmeny pa planlagte stopp og bedre teamfokus-visning", "tab": "kunder"},
    {"text": "Forbedret geokoding og adresseoppslag", "type": "forbedring", "visibility": "mvp"},
    {"text": "Oppgradert kartmotor med bedre ytelse", "type": "forbedring", "visibility": "mvp"},
    {"text": "Klynger vises na korrekt etter utlogging og ny innlogging", "type": "fiks", "visibility": "mvp", "tab": "kunder"},
    {"text": "Forbedret sikkerhet pa API-endepunkter", "type": "fiks", "visibility": "mvp"}
  ]'::jsonb
);
