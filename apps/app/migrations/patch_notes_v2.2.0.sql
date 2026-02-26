INSERT INTO patch_notes (version, title, summary, items) VALUES (
  'v2.2.0',
  'Vedlikeholdsmodus og ny nettside',
  'Ny vedlikeholdsmodus for planlagt nedetid, fullstendig oppgradert nettside, og SSO-forbedringer.',
  '[
    {"text": "Vedlikeholdsmodus med to nivaer", "type": "nytt", "visibility": "mvp", "description": "Administratorer kan na aktivere banner-varsling eller full vedlikeholdsside — appen sjekker automatisk og gjenoppretter seg nar vedlikehold er over"},
    {"text": "Oppgradert nettside og dashboard", "type": "nytt", "visibility": "mvp", "description": "Nettsiden er fullstendig oppgradert med ny teknologi for raskere lasting og bedre brukeropplevelse"},
    {"text": "Forbedret enkel-innlogging (SSO)", "type": "forbedring", "visibility": "mvp", "description": "Smidigere overgang mellom nettside og app uten ekstra innlogging"},
    {"text": "Forbedret kalender og ukeplan", "type": "forbedring", "visibility": "mvp", "tab": "kalender", "description": "Diverse forbedringer i kalender- og ukeplanvisningen"},
    {"text": "Forbedret kunderegistrering", "type": "fiks", "visibility": "mvp", "tab": "kunder", "description": "Fikset feil ved registrering av nye kunder og unike organisasjonsnavn"},
    {"text": "Forbedret stabilitet ved innlogging", "type": "fiks", "visibility": "mvp", "description": "Kartet og klynger lastes na korrekt etter innlogging"}
  ]'::jsonb
);
