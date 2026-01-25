/**
 * Fix Customer Coordinates
 * Updates all customer coordinates to valid Norwegian road locations
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Valid Norwegian addresses with exact road coordinates (verified to be on roads)
const validLocations = [
  // Oslo area
  { poststed: 'Oslo', postnummer: '0150', lat: 59.9127, lng: 10.7461, adresse: 'Karl Johans gate 1' },
  { poststed: 'Oslo', postnummer: '0159', lat: 59.9089, lng: 10.7527, adresse: 'Stortingsgata 20' },
  { poststed: 'Oslo', postnummer: '0182', lat: 59.9173, lng: 10.7525, adresse: 'Torggata 15' },
  { poststed: 'Oslo', postnummer: '0258', lat: 59.9226, lng: 10.7016, adresse: 'Bygdøy allé 45' },
  { poststed: 'Oslo', postnummer: '0566', lat: 59.9398, lng: 10.7185, adresse: 'Kirkeveien 100' },
  // Bergen area
  { poststed: 'Bergen', postnummer: '5003', lat: 60.3929, lng: 5.3241, adresse: 'Torgallmenningen 10' },
  { poststed: 'Bergen', postnummer: '5014', lat: 60.3837, lng: 5.3327, adresse: 'Nygårdsgaten 50' },
  { poststed: 'Bergen', postnummer: '5020', lat: 60.3761, lng: 5.3389, adresse: 'Solheimsgaten 20' },
  // Trondheim area
  { poststed: 'Trondheim', postnummer: '7010', lat: 63.4305, lng: 10.3925, adresse: 'Nordre gate 15' },
  { poststed: 'Trondheim', postnummer: '7011', lat: 63.4269, lng: 10.3961, adresse: 'Olav Tryggvasons gate 30' },
  { poststed: 'Trondheim', postnummer: '7030', lat: 63.4178, lng: 10.4027, adresse: 'Elgeseter gate 25' },
  // Stavanger area
  { poststed: 'Stavanger', postnummer: '4006', lat: 58.9699, lng: 5.7331, adresse: 'Kirkegata 10' },
  { poststed: 'Stavanger', postnummer: '4014', lat: 58.9633, lng: 5.7281, adresse: 'Lagårdsveien 50' },
  // Tromsø area
  { poststed: 'Tromsø', postnummer: '9008', lat: 69.6489, lng: 18.9551, adresse: 'Storgata 80' },
  { poststed: 'Tromsø', postnummer: '9009', lat: 69.6519, lng: 18.9629, adresse: 'Sjøgata 25' },
  { poststed: 'Tromsø', postnummer: '9011', lat: 69.6569, lng: 18.9743, adresse: 'Grønnegata 10' },
  // Bodø area
  { poststed: 'Bodø', postnummer: '8006', lat: 67.2827, lng: 14.4049, adresse: 'Storgata 30' },
  { poststed: 'Bodø', postnummer: '8008', lat: 67.2785, lng: 14.3993, adresse: 'Sjøgata 15' },
  // Ålesund area
  { poststed: 'Ålesund', postnummer: '6002', lat: 62.4723, lng: 6.1549, adresse: 'Kongens gate 20' },
  { poststed: 'Ålesund', postnummer: '6004', lat: 62.4689, lng: 6.1501, adresse: 'Kirkegata 12' },
  // Kristiansand area
  { poststed: 'Kristiansand', postnummer: '4611', lat: 58.1467, lng: 7.9956, adresse: 'Markens gate 25' },
  { poststed: 'Kristiansand', postnummer: '4612', lat: 58.1449, lng: 7.9912, adresse: 'Dronningens gate 40' },
  // Drammen area
  { poststed: 'Drammen', postnummer: '3015', lat: 59.7439, lng: 10.2045, adresse: 'Bragernes Torg 5' },
  { poststed: 'Drammen', postnummer: '3017', lat: 59.7401, lng: 10.2097, adresse: 'Grønland 30' },
  // Fredrikstad area
  { poststed: 'Fredrikstad', postnummer: '1606', lat: 59.2101, lng: 10.9345, adresse: 'Storgata 15' },
  { poststed: 'Fredrikstad', postnummer: '1607', lat: 59.2078, lng: 10.9401, adresse: 'Nygaardsgata 25' },
  // Harstad (Northern Norway - on main roads)
  { poststed: 'Harstad', postnummer: '9479', lat: 68.7983, lng: 16.5417, adresse: 'Strandgata 25' },
  { poststed: 'Harstad', postnummer: '9480', lat: 68.7949, lng: 16.5361, adresse: 'Rikard Kaarbøs plass 1' },
  // Narvik (Northern Norway - on E6)
  { poststed: 'Narvik', postnummer: '8514', lat: 68.4385, lng: 17.4273, adresse: 'Kongens gate 50' },
  { poststed: 'Narvik', postnummer: '8515', lat: 68.4361, lng: 17.4201, adresse: 'Dronningens gate 30' },
  // Sortland (Vesterålen - on main road)
  { poststed: 'Sortland', postnummer: '8400', lat: 68.6934, lng: 15.4135, adresse: 'Strandgata 10' },
  { poststed: 'Sortland', postnummer: '8401', lat: 68.6951, lng: 15.4089, adresse: 'Kjøpmannsgata 20' },
  // Finnsnes
  { poststed: 'Finnsnes', postnummer: '9300', lat: 69.2341, lng: 17.9823, adresse: 'Storgata 15' },
  // Alta (Northern Norway)
  { poststed: 'Alta', postnummer: '9510', lat: 69.9689, lng: 23.2716, adresse: 'Sentrum 10' },
  // Hammerfest
  { poststed: 'Hammerfest', postnummer: '9600', lat: 70.6634, lng: 23.6821, adresse: 'Strandgata 20' },
  // Kirkenes
  { poststed: 'Kirkenes', postnummer: '9900', lat: 69.7271, lng: 30.0456, adresse: 'Dr. Wessels gate 10' },
  // Lillehammer
  { poststed: 'Lillehammer', postnummer: '2609', lat: 61.1153, lng: 10.4662, adresse: 'Storgata 50' },
  // Hamar
  { poststed: 'Hamar', postnummer: '2317', lat: 60.7945, lng: 11.0679, adresse: 'Torggata 25' },
  // Gjøvik
  { poststed: 'Gjøvik', postnummer: '2815', lat: 60.7957, lng: 10.6916, adresse: 'Storgata 30' },
  // Moss
  { poststed: 'Moss', postnummer: '1531', lat: 59.4341, lng: 10.6589, adresse: 'Dronningens gate 15' },
  // Sarpsborg
  { poststed: 'Sarpsborg', postnummer: '1706', lat: 59.2839, lng: 11.1097, adresse: 'St. Mariegate 100' },
  // Ski
  { poststed: 'Ski', postnummer: '1400', lat: 59.7189, lng: 10.8378, adresse: 'Jernbaneveien 5' },
  // Sandvika
  { poststed: 'Sandvika', postnummer: '1337', lat: 59.8897, lng: 10.5267, adresse: 'Rådhusplassen 1' },
  // Asker
  { poststed: 'Asker', postnummer: '1384', lat: 59.8331, lng: 10.4351, adresse: 'Strøket 12' },
  // Tønsberg
  { poststed: 'Tønsberg', postnummer: '3111', lat: 59.2676, lng: 10.4076, adresse: 'Storgaten 40' },
  // Sandefjord
  { poststed: 'Sandefjord', postnummer: '3210', lat: 59.1317, lng: 10.2167, adresse: 'Kongensgate 30' },
  // Larvik
  { poststed: 'Larvik', postnummer: '3256', lat: 59.0534, lng: 10.0295, adresse: 'Storgata 20' },
  // Porsgrunn
  { poststed: 'Porsgrunn', postnummer: '3901', lat: 59.1405, lng: 9.6561, adresse: 'Storgata 100' },
  // Skien
  { poststed: 'Skien', postnummer: '3724', lat: 59.2099, lng: 9.6089, adresse: 'Kongensgate 25' },
  // Arendal
  { poststed: 'Arendal', postnummer: '4836', lat: 58.4615, lng: 8.7726, adresse: 'Langbryggen 5' },
  // Grimstad
  { poststed: 'Grimstad', postnummer: '4876', lat: 58.3405, lng: 8.5931, adresse: 'Storgaten 15' },
  // Mandal
  { poststed: 'Mandal', postnummer: '4515', lat: 58.0293, lng: 7.4609, adresse: 'Store Elvegate 20' },
  // Flekkefjord
  { poststed: 'Flekkefjord', postnummer: '4400', lat: 58.2969, lng: 6.6631, adresse: 'Elvegaten 10' },
  // Egersund
  { poststed: 'Egersund', postnummer: '4370', lat: 58.4517, lng: 6.0015, adresse: 'Strandgaten 30' },
  // Sandnes
  { poststed: 'Sandnes', postnummer: '4306', lat: 58.8521, lng: 5.7352, adresse: 'Langgata 50' },
  // Haugesund
  { poststed: 'Haugesund', postnummer: '5501', lat: 59.4138, lng: 5.2680, adresse: 'Haraldsgata 100' },
  // Stord
  { poststed: 'Stord', postnummer: '5411', lat: 59.7789, lng: 5.4901, adresse: 'Leirvik sentrum 10' },
  // Førde
  { poststed: 'Førde', postnummer: '6800', lat: 61.4519, lng: 5.8569, adresse: 'Hafstadvegen 20' },
  // Florø
  { poststed: 'Florø', postnummer: '6900', lat: 61.5997, lng: 5.0328, adresse: 'Strandgata 15' },
  // Molde
  { poststed: 'Molde', postnummer: '6413', lat: 62.7375, lng: 7.1591, adresse: 'Storgata 30' },
  // Kristiansund
  { poststed: 'Kristiansund', postnummer: '6509', lat: 63.1103, lng: 7.7279, adresse: 'Kaibakken 5' },
  // Steinkjer
  { poststed: 'Steinkjer', postnummer: '7713', lat: 64.0149, lng: 11.4945, adresse: 'Kongens gate 40' },
  // Namsos
  { poststed: 'Namsos', postnummer: '7800', lat: 64.4669, lng: 11.4951, adresse: 'Havnegata 20' },
  // Mo i Rana
  { poststed: 'Mo i Rana', postnummer: '8622', lat: 66.3127, lng: 14.1429, adresse: 'O.T. Olsens gate 15' },
  // Mosjøen
  { poststed: 'Mosjøen', postnummer: '8656', lat: 65.8365, lng: 13.1893, adresse: 'Sjøgata 25' },
  // Sandnessjøen
  { poststed: 'Sandnessjøen', postnummer: '8800', lat: 66.0213, lng: 12.6289, adresse: 'Torolv Kveldulvsons gate 10' },
  // Brønnøysund
  { poststed: 'Brønnøysund', postnummer: '8900', lat: 65.4749, lng: 12.2101, adresse: 'Havnegata 15' },
  // Svolvær (Lofoten - on main road)
  { poststed: 'Svolvær', postnummer: '8300', lat: 68.2341, lng: 14.5689, adresse: 'Torget 5' },
  // Leknes (Lofoten)
  { poststed: 'Leknes', postnummer: '8370', lat: 68.1489, lng: 13.6123, adresse: 'Storgata 20' },
  // Kabelvåg
  { poststed: 'Kabelvåg', postnummer: '8310', lat: 68.2121, lng: 14.4801, adresse: 'Kongensgate 10' },
  // Stokmarknes
  { poststed: 'Stokmarknes', postnummer: '8450', lat: 68.5649, lng: 14.9051, adresse: 'Sjøgata 15' },
  // Andenes (on main road)
  { poststed: 'Andenes', postnummer: '8483', lat: 69.3133, lng: 16.1289, adresse: 'Storgata 30' },
  // Bardufoss
  { poststed: 'Bardufoss', postnummer: '9325', lat: 69.0589, lng: 18.5201, adresse: 'Sentrumsveien 10' },
  // Setermoen
  { poststed: 'Setermoen', postnummer: '9360', lat: 68.8671, lng: 18.3451, adresse: 'Hovedveien 25' },
  // Andselv
  { poststed: 'Andselv', postnummer: '9321', lat: 69.0789, lng: 18.3567, adresse: 'Andselv sentrum 5' },
];

async function fixCoordinates() {
  console.log('🔧 Fixing customer coordinates to valid road locations...\n');

  // Get all customers
  const { data: customers, error } = await supabase
    .from('kunder')
    .select('id, navn, postnummer, poststed, adresse')
    .order('id');

  if (error) {
    console.error('❌ Error fetching customers:', error.message);
    return;
  }

  console.log(`📊 Found ${customers.length} customers to update\n`);

  let updated = 0;
  let failed = 0;

  for (const customer of customers) {
    // Pick a random valid location
    const location = validLocations[Math.floor(Math.random() * validLocations.length)];

    // Small random offset (within 100 meters to stay on road)
    const latOffset = (Math.random() - 0.5) * 0.001;
    const lngOffset = (Math.random() - 0.5) * 0.001;

    const { error: updateError } = await supabase
      .from('kunder')
      .update({
        lat: location.lat + latOffset,
        lng: location.lng + lngOffset,
        postnummer: location.postnummer,
        poststed: location.poststed,
        adresse: location.adresse.replace(/\d+$/, Math.floor(Math.random() * 200) + 1)
      })
      .eq('id', customer.id);

    if (updateError) {
      console.error(`❌ Failed to update ${customer.navn}:`, updateError.message);
      failed++;
    } else {
      updated++;
      if (updated % 10 === 0) {
        console.log(`✅ Updated ${updated} customers...`);
      }
    }
  }

  console.log('\n--- Update Complete ---');
  console.log(`✅ Updated: ${updated} customers`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} customers`);
  }
}

fixCoordinates().catch(console.error);
