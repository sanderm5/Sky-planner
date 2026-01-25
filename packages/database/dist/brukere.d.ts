/**
 * Bruker (admin/team member) database operations
 * Used for authentication of internal users
 */
import type { Bruker } from './types';
/**
 * Gets a bruker by email
 */
export declare function getBrukerByEmail(epost: string): Promise<Bruker | null>;
/**
 * Gets a bruker by ID
 */
export declare function getBrukerById(id: number): Promise<Bruker | null>;
//# sourceMappingURL=brukere.d.ts.map