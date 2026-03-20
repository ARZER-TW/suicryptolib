/**
 * Manage secret values in localStorage.
 *
 * The account's value and blinding factor are stored locally --
 * they NEVER go on-chain. Losing localStorage means losing access
 * to the private balance information (though the SUI is still
 * recoverable via the solvency guard).
 */

const STORE_KEY = "confidential_accounts";

function getAll() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
}

/**
 * Save account secrets after deposit.
 */
export function saveAccountSecret(accountId, { value, blinding, senderHash }) {
  const all = getAll();
  all[accountId] = { value, blinding, senderHash };
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

/**
 * Update account secrets after withdraw (new value and blinding).
 */
export function updateAccountSecret(accountId, { value, blinding }) {
  const all = getAll();
  if (all[accountId]) {
    all[accountId].value = value;
    all[accountId].blinding = blinding;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

/**
 * Get account secrets.
 * @returns {{ value: string, blinding: string, senderHash: string } | null}
 */
export function getAccountSecret(accountId) {
  const all = getAll();
  return all[accountId] || null;
}
