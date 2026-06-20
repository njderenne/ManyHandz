/**
 * Worker API base URL. Its own module so both the API client and the auth client can read it
 * without importing each other (avoids a circular import now that apiFetch attaches the session).
 *
 * Native builds have no same-origin server, so requests are prefixed with the Worker's absolute
 * URL from EXPO_PUBLIC_API_URL. On RN Web served by the Worker, leave it empty so relative `/api`
 * paths resolve same-origin.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? ''
