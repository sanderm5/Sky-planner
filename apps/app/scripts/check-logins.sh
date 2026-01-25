#!/bin/bash
# Sjekk innlogginger i dag fra Supabase

cd "/Users/sandermartinsen/Utvilkling : VISUAL CODE/Utvilkling/el-kontroll-kart"

node << 'SCRIPT'
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkLoginLogs() {
  console.log('\n=== INNLOGGINGER I DAG ===\n');
  console.log('Dato:', new Date().toLocaleDateString('nb-NO'));
  console.log('');
  
  // Check klient table
  const { data: klienter } = await supabase
    .from('klient')
    .select('*')
    .gte('sist_innlogget', new Date().toISOString().split('T')[0])
    .order('sist_innlogget', { ascending: false });
    
  if (klienter && klienter.length > 0) {
    console.log('KLIENTER:');
    klienter.forEach(k => {
      const tid = new Date(k.sist_innlogget).toLocaleTimeString('nb-NO');
      console.log('  ' + tid + ' - ' + k.navn + ' (' + k.epost + ')');
    });
    console.log('');
  }
  
  // Check brukere table
  const { data: brukere } = await supabase
    .from('brukere')
    .select('*')
    .gte('sist_innlogget', new Date().toISOString().split('T')[0])
    .order('sist_innlogget', { ascending: false });
    
  if (brukere && brukere.length > 0) {
    console.log('BRUKERE:');
    brukere.forEach(b => {
      const tid = new Date(b.sist_innlogget).toLocaleTimeString('nb-NO');
      console.log('  ' + tid + ' - ' + b.navn + ' (' + b.epost + ')');
    });
  }
  
  const total = (klienter?.length || 0) + (brukere?.length || 0);
  console.log('\nTotalt ' + total + ' innlogging(er) i dag');
}

checkLoginLogs().catch(console.error);
SCRIPT
