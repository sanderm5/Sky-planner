/**
 * Patch Notes / Changelog Routes
 * Endpoints for fetching release notes filtered by org feature access
 */

import { Router, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse, PatchNote, PatchNoteItem } from '../types';

const router: Router = Router();

// Database service interface
interface PatchNotesDbService {
  getPatchNotes(limit?: number): Promise<PatchNote[]>;
  getPatchNotesSince(sinceId: number): Promise<PatchNote[]>;
  getLatestPatchNoteId(): Promise<number>;
  getEnabledFeatureKeys(organizationId: number): Promise<string[]>;
}

let dbService: PatchNotesDbService;

export function initPatchNotesRoutes(databaseService: PatchNotesDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * Filter patch note items based on organization's enabled features.
 * MVP items are always visible. Full items require the org to have
 * the corresponding feature enabled.
 */
function filterItemsForOrg(items: PatchNoteItem[], enabledFeatures: string[]): PatchNoteItem[] {
  return items.filter(item => {
    if (item.visibility === 'mvp') return true;
    if (item.feature_key) {
      return enabledFeatures.includes(item.feature_key);
    }
    // Generic "full" items without specific feature_key: show to all
    return true;
  });
}

/**
 * GET /api/patch-notes
 * Get all patch notes, filtered for the org's feature access.
 * Query: ?since=<id> to only get notes newer than a given ID
 * Query: ?limit=<n> to limit results (default 50)
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const sinceId = parseInt(req.query.since as string, 10) || 0;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const enabledFeatures = await dbService.getEnabledFeatureKeys(req.organizationId!);

    let notes: PatchNote[];
    if (sinceId > 0) {
      notes = await dbService.getPatchNotesSince(sinceId);
    } else {
      notes = await dbService.getPatchNotes(limit);
    }

    // Filter items per note based on org features
    const filteredNotes = notes.map(note => ({
      ...note,
      items: filterItemsForOrg(note.items, enabledFeatures),
    }));

    const response: ApiResponse<PatchNote[]> = {
      success: true,
      data: filteredNotes,
    };

    res.json(response);
  })
);

/**
 * GET /api/patch-notes/latest-id
 * Get the ID of the most recent patch note (for "unseen" checking).
 */
router.get(
  '/latest-id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const latestId = await dbService.getLatestPatchNoteId();

    const response: ApiResponse<{ latestId: number }> = {
      success: true,
      data: { latestId },
    };

    res.json(response);
  })
);

export default router;
