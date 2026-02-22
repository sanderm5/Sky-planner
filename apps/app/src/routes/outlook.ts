/**
 * Outlook sync routes
 * One-way sync of customer contacts to Microsoft Outlook
 * Feature: outlook_sync
 *
 * Uses Microsoft Graph API for contact management
 * OAuth2 auth flow handled via integrations system
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Kunde, ApiResponse } from '../types';

const router: Router = Router();

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

interface OutlookSyncEntry {
  id: number;
  organization_id: number;
  kunde_id: number;
  outlook_contact_id: string | null;
  last_synced_at: string;
  sync_status: string;
  error_message: string | null;
}

interface OutlookDbService {
  getKundeById(id: number, organizationId?: number): Promise<Kunde | null>;
  getAllKunder(organizationId: number): Promise<Kunde[]>;
  getOutlookSyncEntries(organizationId: number): Promise<OutlookSyncEntry[]>;
  getOutlookSyncEntry(organizationId: number, kundeId: number): Promise<OutlookSyncEntry | null>;
  upsertOutlookSyncEntry(data: Partial<OutlookSyncEntry>): Promise<OutlookSyncEntry>;
  // Integration credentials
  getIntegrationCredentials?(organizationId: number, integrationId: string): Promise<{ accessToken: string } | null>;
}

let dbService: OutlookDbService;

export function initOutlookRoutes(databaseService: OutlookDbService): Router {
  dbService = databaseService;
  return router;
}

// All routes require outlook_sync feature
router.use(requireTenantAuth, requireFeature('outlook_sync'));

/**
 * Map a Sky Planner customer to Microsoft Graph contact format
 */
function mapKundeToOutlookContact(kunde: Kunde): Record<string, unknown> {
  const contact: Record<string, unknown> = {
    givenName: kunde.kontaktperson || kunde.navn,
    companyName: kunde.navn,
    categories: ['kontroll'],
  };

  if (kunde.epost) {
    contact.emailAddresses = [{ address: kunde.epost, name: kunde.navn }];
  }
  if (kunde.telefon) {
    contact.businessPhones = [kunde.telefon];
  }
  if (kunde.adresse) {
    contact.businessAddress = {
      street: kunde.adresse,
      postalCode: kunde.postnummer || '',
      city: kunde.poststed || '',
      countryOrRegion: 'Norway',
    };
  }

  return contact;
}

/**
 * GET /api/outlook/status
 * Get sync status for all customers
 */
router.get(
  '/status',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const entries = await dbService.getOutlookSyncEntries(req.organizationId!);

    const response: ApiResponse<OutlookSyncEntry[]> = {
      success: true,
      data: entries,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/outlook/sync/:kundeId
 * Sync a single customer to Outlook
 */
router.post(
  '/sync/:kundeId',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) throw Errors.badRequest('Ugyldig kunde-ID');

    const kunde = await dbService.getKundeById(kundeId, req.organizationId);
    if (!kunde) throw Errors.notFound('Kunde');

    // Get Outlook credentials
    if (!dbService.getIntegrationCredentials) {
      throw Errors.internal('Outlook-integrasjon er ikke konfigurert');
    }
    const creds = await dbService.getIntegrationCredentials(req.organizationId!, 'outlook');
    if (!creds?.accessToken) {
      throw Errors.badRequest('Outlook er ikke tilkoblet. Koble til via Innstillinger → Integrasjoner.');
    }

    const contactData = mapKundeToOutlookContact(kunde);
    const existing = await dbService.getOutlookSyncEntry(req.organizationId!, kundeId);

    let outlookContactId: string;
    let syncError: string | null = null;

    try {
      if (existing?.outlook_contact_id) {
        // Update existing contact
        const updateRes = await fetch(`${GRAPH_BASE_URL}/me/contacts/${existing.outlook_contact_id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(contactData),
        });
        if (!updateRes.ok) {
          const err = await updateRes.text();
          throw new Error(`Outlook API feil: ${updateRes.status} - ${err}`);
        }
        outlookContactId = existing.outlook_contact_id;
      } else {
        // Create new contact
        const createRes = await fetch(`${GRAPH_BASE_URL}/me/contacts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(contactData),
        });
        if (!createRes.ok) {
          const err = await createRes.text();
          throw new Error(`Outlook API feil: ${createRes.status} - ${err}`);
        }
        const created = await createRes.json() as { id: string };
        outlookContactId = created.id;
      }
    } catch (error) {
      syncError = error instanceof Error ? error.message : 'Ukjent feil';
      outlookContactId = existing?.outlook_contact_id || '';
    }

    // Log sync result
    const entry = await dbService.upsertOutlookSyncEntry({
      organization_id: req.organizationId!,
      kunde_id: kundeId,
      outlook_contact_id: outlookContactId || null,
      last_synced_at: new Date().toISOString(),
      sync_status: syncError ? 'failed' : 'synced',
      error_message: syncError,
    });

    if (syncError) {
      throw Errors.internal(`Outlook-synk feilet: ${syncError}`);
    }

    logAudit(apiLogger, 'OUTLOOK_SYNC', req.user!.userId, 'outlook_sync', entry.id, {
      kunde_id: kundeId,
      action: existing?.outlook_contact_id ? 'update' : 'create',
    });

    const response: ApiResponse = {
      success: true,
      data: { message: 'Kontakt synkronisert til Outlook', entry },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/outlook/sync-all
 * Sync all customers to Outlook
 */
router.post(
  '/sync-all',
  requireRole('tekniker'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!dbService.getIntegrationCredentials) {
      throw Errors.internal('Outlook-integrasjon er ikke konfigurert');
    }
    const creds = await dbService.getIntegrationCredentials(req.organizationId!, 'outlook');
    if (!creds?.accessToken) {
      throw Errors.badRequest('Outlook er ikke tilkoblet');
    }

    const kunder = await dbService.getAllKunder(req.organizationId!);
    let synced = 0;
    let failed = 0;

    for (const kunde of kunder) {
      const contactData = mapKundeToOutlookContact(kunde);
      const existing = await dbService.getOutlookSyncEntry(req.organizationId!, kunde.id);

      try {
        let outlookContactId: string;

        if (existing?.outlook_contact_id) {
          const updateRes = await fetch(`${GRAPH_BASE_URL}/me/contacts/${existing.outlook_contact_id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(contactData),
          });
          if (!updateRes.ok) throw new Error(`${updateRes.status}`);
          outlookContactId = existing.outlook_contact_id;
        } else {
          const createRes = await fetch(`${GRAPH_BASE_URL}/me/contacts`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(contactData),
          });
          if (!createRes.ok) throw new Error(`${createRes.status}`);
          const created = await createRes.json() as { id: string };
          outlookContactId = created.id;
        }

        await dbService.upsertOutlookSyncEntry({
          organization_id: req.organizationId!, kunde_id: kunde.id,
          outlook_contact_id: outlookContactId, last_synced_at: new Date().toISOString(),
          sync_status: 'synced', error_message: null,
        });
        synced++;
      } catch (error) {
        await dbService.upsertOutlookSyncEntry({
          organization_id: req.organizationId!, kunde_id: kunde.id,
          outlook_contact_id: existing?.outlook_contact_id || null,
          last_synced_at: new Date().toISOString(), sync_status: 'failed',
          error_message: error instanceof Error ? error.message : 'Ukjent feil',
        });
        failed++;
      }
    }

    logAudit(apiLogger, 'OUTLOOK_SYNC_ALL', req.user!.userId, 'outlook_sync', 0, {
      total: kunder.length, synced, failed,
    });

    const response: ApiResponse = {
      success: true,
      data: { message: `Synkronisering fullført`, total: kunder.length, synced, failed },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;
