const HTTP_ADMIN_TOKEN_STORAGE_KEY = "straja.vault.httpAdminToken"

export const VAULT_HTTP_UNAUTHORIZED_EVENT = "vault-http-unauthorized"

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function getStoredHttpAdminToken(): string | null {
  if (!canUseBrowserStorage()) {
    return null
  }
  const raw = window.localStorage.getItem(HTTP_ADMIN_TOKEN_STORAGE_KEY)
  const token = raw?.trim()
  return token ? token : null
}

export function setStoredHttpAdminToken(token: string): void {
  if (!canUseBrowserStorage()) {
    return
  }
  window.localStorage.setItem(HTTP_ADMIN_TOKEN_STORAGE_KEY, token.trim())
}

export function clearStoredHttpAdminToken(): void {
  if (!canUseBrowserStorage()) {
    return
  }
  window.localStorage.removeItem(HTTP_ADMIN_TOKEN_STORAGE_KEY)
}

export function dispatchVaultHttpUnauthorized(): void {
  if (typeof window === "undefined") {
    return
  }
  window.dispatchEvent(new CustomEvent(VAULT_HTTP_UNAUTHORIZED_EVENT))
}
