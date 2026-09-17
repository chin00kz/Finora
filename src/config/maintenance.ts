/**
 * Maintenance Mode Configuration
 * Set `enabled: true` to display the maintenance landing page to regular visitors.
 * Existing users and testers can bypass by visiting `/skip` (or `?skip=true`),
 * which saves a token in localStorage.
 */
export const MAINTENANCE_CONFIG = {
  enabled: true,
  title: "We're Upgrading Finora",
  badge: 'Scheduled Maintenance & Upgrades',
  description:
    'Finora is currently undergoing essential security enhancements, database hardening, and near real-time multi-device sync improvements.',
  statusNote: 'All local data is safe. Normal service will resume shortly.',
};

const BYPASS_STORAGE_KEY = 'finora_maintenance_bypass';

export function isMaintenanceBypassed(): boolean {
  try {
    return localStorage.getItem(BYPASS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMaintenanceBypass(bypass: boolean): void {
  try {
    if (bypass) {
      localStorage.setItem(BYPASS_STORAGE_KEY, 'true');
    } else {
      localStorage.removeItem(BYPASS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

