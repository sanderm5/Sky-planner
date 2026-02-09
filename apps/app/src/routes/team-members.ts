/**
 * Team Members routes
 * CRUD operations for team members with quota enforcement
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@skyplanner/auth';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

// Team member record type
interface TeamMember {
  id: number;
  navn: string;
  epost: string;
  telefon?: string;
  rolle?: string;
  aktiv: boolean;
  sist_innlogget?: string;
  opprettet?: string;
}

// Database service interface
interface TeamMemberDbService {
  getTeamMembers(organizationId: number): Promise<TeamMember[]>;
  createTeamMember(data: {
    navn: string;
    epost: string;
    passord_hash: string;
    telefon?: string;
    rolle?: string;
    organization_id: number;
  }): Promise<TeamMember>;
  updateTeamMember(
    id: number,
    organizationId: number,
    data: { navn?: string; telefon?: string; rolle?: string; aktiv?: boolean }
  ): Promise<TeamMember | null>;
  deleteTeamMember(id: number, organizationId: number): Promise<boolean>;
  getTeamMemberByEpost(epost: string, organizationId: number): Promise<TeamMember | null>;
  getOrganizationUserLimits(organizationId: number): Promise<{ max_brukere: number; current_count: number } | null>;
}

let dbService: TeamMemberDbService;

/**
 * Initialize team-members routes with database service
 */
export function initTeamMembersRoutes(databaseService: TeamMemberDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/team-members
 * Get all team members for the organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const members = await dbService.getTeamMembers(req.organizationId!);
    const limits = await dbService.getOrganizationUserLimits(req.organizationId!);

    const response: ApiResponse<{
      members: TeamMember[];
      limits: { max_brukere: number; current_count: number } | null;
    }> = {
      success: true,
      data: { members, limits },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/team-members
 * Create a new team member (with quota check)
 */
router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { navn, epost, passord, telefon, rolle } = req.body;

    // Validate required fields
    if (!navn || !epost || !passord) {
      throw Errors.badRequest('Navn, e-post og passord er påkrevd');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(epost)) {
      throw Errors.badRequest('Ugyldig e-postformat');
    }

    // Validate password using enhanced validation
    const passwordResult = validatePassword(passord, {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
      checkCommonPasswords: true,
      userContext: { email: epost, name: navn },
    });
    if (!passwordResult.valid) {
      throw Errors.badRequest(passwordResult.errors[0]);
    }

    // Check quota
    const limits = await dbService.getOrganizationUserLimits(req.organizationId!);
    if (limits && limits.current_count >= limits.max_brukere) {
      throw Errors.quotaExceeded('brukere', limits.max_brukere);
    }

    // Check if email already exists in organization
    const existing = await dbService.getTeamMemberByEpost(epost, req.organizationId!);
    if (existing) {
      throw Errors.badRequest('E-postadressen er allerede registrert');
    }

    // Hash password
    const passord_hash = await bcrypt.hash(passord, 12);

    // Create member
    const member = await dbService.createTeamMember({
      navn,
      epost,
      passord_hash,
      telefon,
      rolle: rolle || 'medlem',
      organization_id: req.organizationId!,
    });

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'team_member', member.id, {
      navn: member.navn,
      epost: member.epost,
    });

    // Don't return password hash (database returns all fields including passord_hash)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { passord_hash: _, ...memberWithoutPassword } = member as any;

    const response: ApiResponse<TeamMember> = {
      success: true,
      data: memberWithoutPassword,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/team-members/:id
 * Update a team member
 */
router.put(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig bruker-ID');
    }

    const { navn, telefon, rolle, aktiv } = req.body;

    const updated = await dbService.updateTeamMember(id, req.organizationId!, {
      navn,
      telefon,
      rolle,
      aktiv,
    });

    if (!updated) {
      throw Errors.notFound('Bruker ikke funnet');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'team_member', id, {
      navn: updated.navn,
    });

    const response: ApiResponse<TeamMember> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/team-members/:id
 * Delete a team member
 */
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig bruker-ID');
    }

    // Prevent self-deletion
    if (id === req.user!.userId) {
      throw Errors.badRequest('Du kan ikke slette din egen bruker');
    }

    const deleted = await dbService.deleteTeamMember(id, req.organizationId!);

    if (!deleted) {
      throw Errors.notFound('Bruker ikke funnet');
    }

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'team_member', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Bruker slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;
