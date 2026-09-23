/**
 * src/config.ts
 * Application-wide constants and feature flags.
 */

/**
 * IDENTITY_ROLLOUT_CUTOFF
 * 
 * Accounts created before this instant are grandfathered into
 * optional profile setup (Legacy users). Accounts created at/after it
 * require mandatory profile onboarding when no profile exists.
 *
 * IMMUTABLE PRODUCTION ROLLOUT BOUNDARY.
 * Do not change this value.
 */
export const IDENTITY_ROLLOUT_CUTOFF = new Date('2026-09-23T10:00:00Z').getTime();
