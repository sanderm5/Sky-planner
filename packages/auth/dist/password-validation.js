/**
 * Password Validation Module
 * Enforces strong password requirements for security
 */
// Top 100 most common passwords to reject
// Source: Various security research publications
const COMMON_PASSWORDS = new Set([
    'password', 'password1', 'password123', '123456', '12345678', '123456789',
    '1234567890', 'qwerty', 'qwerty123', 'abc123', 'monkey', 'master',
    'dragon', 'letmein', 'login', 'welcome', 'admin', 'admin123',
    'passw0rd', 'p@ssword', 'p@ssw0rd', 'iloveyou', 'princess', 'sunshine',
    'football', 'baseball', 'basketball', 'soccer', 'hockey', 'batman',
    'superman', 'trustno1', 'shadow', 'ashley', 'michael', 'jennifer',
    'jessica', 'charlie', 'daniel', 'thomas', 'jordan', 'hunter',
    'buster', 'soccer', 'harley', 'ranger', 'george', 'summer',
    'taylor', 'robert', 'pepper', 'killer', 'computer', 'internet',
    'whatever', 'starwars', 'pokemon', 'cheese', 'chocolate', 'banana',
    'orange', 'cookie', 'flower', 'guitar', 'music', 'movie',
    'hello', 'secret', 'test', 'test123', 'guest', 'user',
    '111111', '000000', '121212', '123123', '654321', '666666',
    '696969', '777777', '888888', '999999', 'aaaaaa', 'qqqqqq',
    'zzzzzz', 'asdfgh', 'zxcvbn', 'qazwsx', 'qwertyuiop', 'asdfghjkl',
    'zxcvbnm', '1q2w3e', '1q2w3e4r', '1q2w3e4r5t', 'passpass', 'pass1234',
]);
// Norwegian common passwords
const NORWEGIAN_COMMON = new Set([
    'passord', 'passord1', 'passord123', 'hemmelig', 'velkommen', 'skansen',
    'bergen', 'oslo', 'norsk', 'norge', 'viking', 'fotball', 'haaland',
    'sommerferie', 'vinter', 'brunost', 'kvansen', 'fjord',
]);
const DEFAULT_OPTIONS = {
    minLength: 10,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    checkCommonPasswords: true,
};
/**
 * Check if password is similar to user context (email, name)
 */
function isSimilarToUserContext(password, context) {
    if (!context)
        return false;
    const lowerPassword = password.toLowerCase();
    // Check email
    if (context.email) {
        const emailParts = context.email.toLowerCase().split('@');
        const localPart = emailParts[0];
        // Check if password contains email local part (or vice versa)
        if (localPart.length >= 4) {
            if (lowerPassword.includes(localPart) || localPart.includes(lowerPassword)) {
                return true;
            }
        }
    }
    // Check name
    if (context.name) {
        const nameParts = context.name.toLowerCase().split(/\s+/);
        for (const part of nameParts) {
            if (part.length >= 3) {
                if (lowerPassword.includes(part) || part.includes(lowerPassword)) {
                    return true;
                }
            }
        }
    }
    return false;
}
/**
 * Calculate password entropy (bits)
 */
function calculateEntropy(password) {
    let charsetSize = 0;
    if (/[a-z]/.test(password))
        charsetSize += 26;
    if (/[A-Z]/.test(password))
        charsetSize += 26;
    if (/[0-9]/.test(password))
        charsetSize += 10;
    if (/[^a-zA-Z0-9]/.test(password))
        charsetSize += 32;
    if (charsetSize === 0)
        return 0;
    return Math.floor(password.length * Math.log2(charsetSize));
}
/**
 * Check for common patterns that weaken passwords
 */
function hasCommonPatterns(password) {
    // Keyboard patterns
    const keyboardPatterns = [
        'qwerty', 'asdfgh', 'zxcvbn', 'qwertyuiop', 'asdfghjkl',
        '1234567890', '0987654321', 'qazwsx', 'wsxedc',
    ];
    const lowerPassword = password.toLowerCase();
    for (const pattern of keyboardPatterns) {
        if (lowerPassword.includes(pattern) || lowerPassword.includes(pattern.split('').reverse().join(''))) {
            return true;
        }
    }
    // Repeated characters (e.g., "aaaaaa")
    if (/(.)\1{3,}/.test(password)) {
        return true;
    }
    // Sequential numbers (e.g., "123456")
    if (/012|123|234|345|456|567|678|789|890/.test(password)) {
        if (password.match(/\d{4,}/)) {
            return true;
        }
    }
    return false;
}
/**
 * Validate password against security requirements
 */
export function validatePassword(password, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const errors = [];
    let score = 0;
    // Length check
    if (password.length < opts.minLength) {
        errors.push(`Passordet må være minst ${opts.minLength} tegn`);
    }
    else {
        score += 20;
        // Bonus for longer passwords
        if (password.length >= 12)
            score += 10;
        if (password.length >= 14)
            score += 10;
    }
    // Uppercase check
    if (opts.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Passordet må inneholde minst én stor bokstav');
    }
    else if (/[A-Z]/.test(password)) {
        score += 10;
    }
    // Lowercase check
    if (opts.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Passordet må inneholde minst én liten bokstav');
    }
    else if (/[a-z]/.test(password)) {
        score += 10;
    }
    // Number check
    if (opts.requireNumber && !/[0-9]/.test(password)) {
        errors.push('Passordet må inneholde minst ett tall');
    }
    else if (/[0-9]/.test(password)) {
        score += 10;
    }
    // Special character check
    if (opts.requireSpecial && !/[^a-zA-Z0-9]/.test(password)) {
        errors.push('Passordet må inneholde minst ett spesialtegn (!@#$%^&*...)');
    }
    else if (/[^a-zA-Z0-9]/.test(password)) {
        score += 15;
    }
    // Common password check
    if (opts.checkCommonPasswords) {
        const lowerPassword = password.toLowerCase();
        const isCommon = COMMON_PASSWORDS.has(lowerPassword) ||
            NORWEGIAN_COMMON.has(lowerPassword) ||
            COMMON_PASSWORDS.has(password) ||
            NORWEGIAN_COMMON.has(password);
        if (isCommon) {
            errors.push('Dette passordet er for vanlig og lett å gjette');
            score = Math.max(0, score - 30);
        }
    }
    // User context check
    if (options.userContext && isSimilarToUserContext(password, options.userContext)) {
        errors.push('Passordet kan ikke ligne på e-postadressen eller navnet ditt');
        score = Math.max(0, score - 20);
    }
    // Pattern check
    if (hasCommonPatterns(password)) {
        errors.push('Passordet inneholder vanlige mønstre som er lette å gjette');
        score = Math.max(0, score - 15);
    }
    // Entropy bonus
    const entropy = calculateEntropy(password);
    if (entropy >= 60)
        score += 15;
    else if (entropy >= 50)
        score += 10;
    else if (entropy >= 40)
        score += 5;
    // Cap score
    score = Math.min(100, Math.max(0, score));
    // Determine strength
    let strength;
    if (score < 40)
        strength = 'weak';
    else if (score < 60)
        strength = 'fair';
    else if (score < 80)
        strength = 'good';
    else
        strength = 'strong';
    return {
        valid: errors.length === 0,
        errors,
        strength,
        score,
    };
}
/**
 * Quick check if password meets minimum requirements
 * Returns true if valid, throws error with message if not
 */
export function assertValidPassword(password, options = {}) {
    const result = validatePassword(password, options);
    if (!result.valid) {
        throw new Error(result.errors[0]);
    }
}
/**
 * Get a human-readable password strength label
 */
export function getPasswordStrengthLabel(strength) {
    const labels = {
        weak: 'Svakt',
        fair: 'Middels',
        good: 'Bra',
        strong: 'Sterkt',
    };
    return labels[strength] || 'Ukjent';
}
//# sourceMappingURL=password-validation.js.map