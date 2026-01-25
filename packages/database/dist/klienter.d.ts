/**
 * Klient (account owner) database operations
 * Used for authentication and registration
 */
import type { Klient, InsertKlient, UpdateKlient } from './types';
/**
 * Creates a new klient (account owner)
 */
export declare function createKlient(data: InsertKlient): Promise<Klient>;
/**
 * Gets a klient by email
 */
export declare function getKlientByEmail(epost: string): Promise<Klient | null>;
/**
 * Gets a klient by ID
 */
export declare function getKlientById(id: number): Promise<Klient | null>;
/**
 * Updates a klient
 */
export declare function updateKlient(id: number, data: UpdateKlient): Promise<Klient>;
/**
 * Updates password for a klient
 */
export declare function updateKlientPassword(id: number, hashedPassword: string): Promise<void>;
/**
 * Checks if an email is already registered
 */
export declare function isEmailRegistered(epost: string): Promise<boolean>;
/**
 * Gets all klienter for an organization
 */
export declare function getKlienterByOrganization(organizationId: number): Promise<Klient[]>;
//# sourceMappingURL=klienter.d.ts.map