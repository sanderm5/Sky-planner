/**
 * Email Notification Service
 * Handles sending email reminders for upcoming controls via Nodemailer
 */

const cron = require('node-cron');
const nodemailer = require('nodemailer');

// Logger utility
const Logger = {
  isDev: () => process.env.NODE_ENV !== 'production',
  log: function(...args) {
    if (this.isDev()) console.log('[DEBUG]', ...args);
  },
  warn: function(...args) {
    if (this.isDev()) console.warn('[WARN]', ...args);
  },
  info: function(...args) {
    console.log('[INFO]', ...args);
  },
  error: console.error.bind(console, '[ERROR]')
};

// HTML escape function to prevent XSS in emails
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to get today's date at midnight in Norwegian timezone
function getNorwegianToday() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value || '0';
  return new Date(
    Number.parseInt(get('year'), 10),
    Number.parseInt(get('month'), 10) - 1,
    Number.parseInt(get('day'), 10)
  );
}

// Email transporter (initialized lazily)
let emailTransporter = null;

/**
 * Check if email is properly configured
 */
function isEmailConfigured() {
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!host || !user || !pass) {
    return false;
  }

  // Check for common placeholder patterns
  const placeholders = ['your_', 'xxx', 'placeholder', 'change_me', 'insert_'];
  const lowerUser = user.toLowerCase();
  const lowerPass = pass.toLowerCase();

  for (const placeholder of placeholders) {
    if (lowerUser.includes(placeholder) || lowerPass.includes(placeholder)) {
      return false;
    }
  }

  return true;
}

/**
 * Get or create email transporter
 */
function getEmailTransporter() {
  if (!emailTransporter && isEmailConfigured()) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number.parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return emailTransporter;
}

/**
 * Initialize email notification tables in the database
 */
function initEmailTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_varsler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER,
      epost TEXT NOT NULL,
      emne TEXT NOT NULL,
      melding TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sendt_dato DATETIME,
      feil_melding TEXT,
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS email_innstillinger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER UNIQUE NOT NULL,
      email_aktiv INTEGER DEFAULT 1,
      forste_varsel_dager INTEGER DEFAULT 30,
      paaminnelse_etter_dager INTEGER DEFAULT 7,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id)
    );
  `);

  // Add epost column to kunder table if it doesn't exist
  try {
    db.exec(`ALTER TABLE kunder ADD COLUMN epost TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  Logger.log('Email tables initialized');
}

/**
 * Validate email address format
 */
function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Send email via Nodemailer
 */
async function sendEmail(to, subject, message) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    Logger.log('Email not configured - Email would be sent to:', to);
    Logger.log('Subject:', subject);
    Logger.log('Message:', message);
    return {
      success: false,
      error: 'E-post er ikke konfigurert. Legg inn gyldige e-post-credentials i .env filen.'
    };
  }

  const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  try {
    const result = await transporter.sendMail({
      from: fromEmail,
      to: to,
      subject: subject,
      text: message,
      html: escapeHtml(message).replace(/\n/g, '<br>')
    });

    Logger.log(`Email sent successfully to ${to}, ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generate reminder email content
 * These emails are sent to the company as reminders about upcoming customer controls
 */
function generateReminderEmail(customer, daysUntil, companyName, isReminder = false) {
  const kategori = customer.kategori || 'El-kontroll';
  const subject = `Påminnelse om kontroll hos: ${customer.navn}`;
  let message;

  // Build customer info section
  let kundeInfo = `Kunde: ${customer.navn}\n`;
  if (customer.adresse) kundeInfo += `Adresse: ${customer.adresse}`;
  if (customer.postnummer || customer.poststed) {
    kundeInfo += `, ${customer.postnummer || ''} ${customer.poststed || ''}`.trim();
  }
  kundeInfo += '\n';
  if (customer.telefon) kundeInfo += `Telefon: ${customer.telefon}\n`;
  if (customer.epost) kundeInfo += `E-post: ${customer.epost}\n`;

  if (isReminder) {
    message = `PÅMINNELSE: ${kategori}\n\n`;
    message += kundeInfo + '\n';
    if (daysUntil > 0) {
      message += `Det er ${daysUntil} dager til fristen for neste kontroll.\n\n`;
    } else if (daysUntil === 0) {
      message += `Fristen for neste kontroll er I DAG!\n\n`;
    } else {
      message += `OBS: Fristen har gått ut med ${Math.abs(daysUntil)} dager!\n\n`;
    }
    message += `Ta kontakt med kunden for å avtale tid.`;
  } else {
    message = `KOMMENDE KONTROLL: ${kategori}\n\n`;
    message += kundeInfo + '\n';
    message += `Det er ${daysUntil} dager til fristen for neste kontroll.\n\n`;
    message += `Husk å kontakte kunden for å avtale et passende tidspunkt.`;
  }

  return { subject, message };
}

/**
 * Check and send reminders for all customers
 */
async function checkAndSendReminders(db) {
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') {
    Logger.log('Email notifications are disabled');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const companyName = process.env.COMPANY_NAME || 'Sky Planner';
  const firstReminderDays = Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS) || 30;
  const reminderAfterDays = Number.parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS) || 7;

  // Use Norwegian timezone for date calculations
  const today = getNorwegianToday();

  // OPTIMIZED: Single query to get customers with email settings
  const customers = db.prepare(`
    SELECT k.*,
           COALESCE(e.email_aktiv, 1) as email_aktiv,
           COALESCE(e.forste_varsel_dager, ?) as forste_varsel_dager,
           COALESCE(e.paaminnelse_etter_dager, ?) as paaminnelse_etter_dager
    FROM kunder k
    LEFT JOIN email_innstillinger e ON k.id = e.kunde_id
    WHERE k.neste_kontroll IS NOT NULL
      AND k.epost IS NOT NULL
      AND k.epost != ''
  `).all(firstReminderDays, reminderAfterDays);

  if (customers.length === 0) {
    Logger.log('No customers with upcoming controls found');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  // OPTIMIZED: Pre-fetch all email history in batch instead of per-customer queries
  const customerIds = customers.map(c => c.id);
  const placeholders = customerIds.map(() => '?').join(',');

  // Get all recent email_varsler for these customers in ONE query
  const emailHistory = db.prepare(`
    SELECT kunde_id, type, status, sendt_dato, id
    FROM email_varsler
    WHERE kunde_id IN (${placeholders})
      AND status = 'sent'
      AND DATE(sendt_dato) >= DATE('now', '-60 days')
    ORDER BY sendt_dato DESC
  `).all(...customerIds);

  // Build lookup maps for O(1) access
  const firstReminderMap = new Map(); // kunde_id -> most recent first_reminder
  const secondReminderMap = new Map(); // kunde_id -> most recent second_reminder after first

  for (const email of emailHistory) {
    if (email.type === 'first_reminder') {
      // Keep only the most recent first reminder per customer
      if (!firstReminderMap.has(email.kunde_id)) {
        firstReminderMap.set(email.kunde_id, email);
      }
    } else if (email.type === 'second_reminder') {
      // Keep track of second reminders
      if (!secondReminderMap.has(email.kunde_id)) {
        secondReminderMap.set(email.kunde_id, []);
      }
      secondReminderMap.get(email.kunde_id).push(email);
    }
  }

  let sent = 0, skipped = 0, errors = 0;

  for (const customer of customers) {
    if (!customer.email_aktiv) {
      skipped++;
      continue;
    }

    if (!isValidEmail(customer.epost)) {
      Logger.log(`Invalid email for customer ${customer.id}: ${customer.epost}`);
      skipped++;
      continue;
    }

    const nextControl = new Date(customer.neste_kontroll);
    nextControl.setHours(0, 0, 0, 0);
    const daysUntil = Math.ceil((nextControl - today) / (1000 * 60 * 60 * 24));

    // Check if we should send first email (30 days before)
    if (daysUntil === customer.forste_varsel_dager) {
      // OPTIMIZED: Check map instead of database query
      const existingFirst = firstReminderMap.get(customer.id);

      if (!existingFirst) {
        const { subject, message } = generateReminderEmail(customer, daysUntil, companyName, false);
        const result = await sendAndLogEmail(db, customer, subject, message, 'first_reminder');
        if (result.success) sent++; else errors++;
        continue;
      }
    }

    // Check if we should send reminder (7 days after first email was sent)
    // OPTIMIZED: Use pre-fetched data
    const firstEmail = firstReminderMap.get(customer.id);

    if (firstEmail) {
      const firstSentDate = new Date(firstEmail.sendt_dato);
      const daysSinceFirst = Math.ceil((today - firstSentDate) / (1000 * 60 * 60 * 24));

      if (daysSinceFirst === customer.paaminnelse_etter_dager) {
        // OPTIMIZED: Check if second reminder was sent after first email
        const secondReminders = secondReminderMap.get(customer.id) || [];
        const existingReminder = secondReminders.find(r =>
          new Date(r.sendt_dato) > firstSentDate
        );

        if (!existingReminder) {
          const { subject, message } = generateReminderEmail(customer, daysUntil, companyName, true);
          const result = await sendAndLogEmail(db, customer, subject, message, 'second_reminder');
          if (result.success) sent++; else errors++;
          continue;
        }
      }
    }

    // Note: No automatic reminders for overdue controls
    // Client can see overdue customers in the app's "Varsler" tab
  }

  Logger.log(`Email check completed: ${sent} sent, ${skipped} skipped, ${errors} errors`);
  return { sent, skipped, errors };
}

/**
 * Helper function to send and log email
 * Emails are sent to the CLIENT (company), not to customers
 */
async function sendAndLogEmail(db, customer, subject, message, type) {
  // Get client email from klient table or fallback to env
  let clientEmail = process.env.KLIENT_EPOST;
  try {
    const klient = db.prepare('SELECT epost FROM klient WHERE aktiv = 1 LIMIT 1').get();
    if (klient && klient.epost) {
      clientEmail = klient.epost;
    }
  } catch (e) {
    // klient table might not exist, use env fallback
  }

  if (!clientEmail) {
    Logger.log('No client email configured - skipping notification');
    return { success: false, error: 'Ingen klient-epost konfigurert' };
  }

  // Log the email in database
  const insertStmt = db.prepare(`
    INSERT INTO email_varsler (kunde_id, epost, emne, melding, type, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  const result = insertStmt.run(customer.id, clientEmail, subject, message, type);
  const varselId = result.lastInsertRowid;

  // Send email to CLIENT (not customer)
  const emailResult = await sendEmail(clientEmail, subject, message);

  // Update status
  if (emailResult.success) {
    db.prepare(`
      UPDATE email_varsler
      SET status = 'sent', sendt_dato = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(varselId);
    Logger.log(`Reminder sent to client (${clientEmail}) about: ${customer.navn} - ${type}`);
    return { success: true };
  } else {
    db.prepare(`
      UPDATE email_varsler
      SET status = 'failed', feil_melding = ?
      WHERE id = ?
    `).run(emailResult.error, varselId);
    return { success: false, error: emailResult.error };
  }
}

/**
 * Start the cron job for automatic reminders
 * Runs every day at 09:00 Norwegian time (Europe/Oslo)
 */
function startReminderCron(db) {
  cron.schedule('0 9 * * *', async () => {
    Logger.log('Running scheduled email reminder check...');
    await checkAndSendReminders(db);
  }, {
    timezone: 'Europe/Oslo'
  });

  Logger.log('Email reminder cron job started (runs daily at 09:00 Europe/Oslo)');
}

/**
 * Send a test email
 */
async function sendTestEmail(db, emailAddress, message) {
  if (!isValidEmail(emailAddress)) {
    return { success: false, error: 'Ugyldig e-postadresse' };
  }

  const companyName = process.env.COMPANY_NAME || 'Sky Planner';
  const subject = `Test e-post fra ${companyName}`;

  // Log the test email (kunde_id = NULL for test messages)
  db.prepare(`
    INSERT INTO email_varsler (kunde_id, epost, emne, melding, type, status)
    VALUES (NULL, ?, ?, ?, 'test', 'pending')
  `).run(emailAddress, subject, message);

  const result = await sendEmail(emailAddress, subject, message);
  return result;
}

/**
 * Get email history for a customer or all
 */
function getEmailHistory(db, kundeId = null, limit = 50) {
  let query = `
    SELECT ev.*, k.navn as kunde_navn
    FROM email_varsler ev
    LEFT JOIN kunder k ON ev.kunde_id = k.id
  `;

  if (kundeId) {
    query += ` WHERE ev.kunde_id = ?`;
    query += ` ORDER BY ev.opprettet DESC LIMIT ?`;
    return db.prepare(query).all(kundeId, limit);
  } else {
    query += ` ORDER BY ev.opprettet DESC LIMIT ?`;
    return db.prepare(query).all(limit);
  }
}

module.exports = {
  initEmailTables,
  sendEmail,
  sendTestEmail,
  checkAndSendReminders,
  startReminderCron,
  isValidEmail,
  generateReminderEmail,
  isEmailConfigured,
  getEmailHistory
};
