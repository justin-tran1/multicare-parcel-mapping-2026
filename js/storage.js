// Safe localStorage wrapper. Storage may be unavailable (private mode, blocked, sandboxed
// preview), so every access is guarded and the app renders correctly without it.
const PREFIX = 'mcpm:';

export function loadJSON(key, fallback = null) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
