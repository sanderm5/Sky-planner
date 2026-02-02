/**
 * Klient (account owner) database operations
 * Used for authentication and registration
 */
import type { Klient, InsertKlient, UpdateKlient, PasswordResetToken, InsertPasswordResetToken } from './types';
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
/**
 * Creates a password reset token
 */
export declare function createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken>;
/**
 * Gets a valid (not expired, not used) password reset token by hash
 */
export declare function getValidPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | null>;
/**
 * Marks a password reset token as used
 */
export declare function markPasswordResetTokenUsed(tokenId: number): Promise<void>;
/**
 * Deletes expired password reset tokens (cleanup)
 */
export declare function deleteExpiredPasswordResetTokens(): Promise<number>;
/**
 * Gets the count of kunder (customers) for an organization
 */
export declare function getKundeCountByOrganization(organizationId: number): Promise<number>;
//# sourceMappingURL=klienter.d.ts.map