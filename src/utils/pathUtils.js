/**
 * pathUtils.js
 *
 * Utilities for working with a simple JSONPath-like syntax.
 * Supported path examples:
 *  - $.a.b[0].c
 *  - a.b[0]['x']
 *  - $['complex-key'].arr[2]
 *
 * Exports:
 *  - getValueAtJsonPath(obj, path)
 *  - setValueAtJsonPath(obj, path, value)
 *  - toJsonPath(path) // normalize to start with $
 */

/**
 * Tokenize a JSONPath-like string into property/index tokens.
 * Returns array of tokens where numeric tokens are numbers, others are strings.
 */
function tokenize(path) {
  if (typeof path !== 'string') return [];
  let p = path.trim();
  // strip leading $
  if (p.startsWith('$')) p = p.slice(1);
  const tokens = [];
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '.' ) {
      i++;
      // read identifier
      let start = i;
      while (i < p.length && p[i] !== '.' && p[i] !== '[') i++;
      if (i > start) tokens.push(p.slice(start, i));
      continue;
    }
    if (ch === '[') {
      i++;
      // find closing ]
      let start = i;
      let inQuotes = false;
      let quoteChar = '';
      let tokenStr = '';
      while (i < p.length) {
        const c = p[i];
        if (!inQuotes && (c === '"' || c === "'")) {
          inQuotes = true;
          quoteChar = c;
          i++;
          continue;
        }
        if (inQuotes) {
          if (c === '\\') {
            // escape next
            if (i + 1 < p.length) {
              tokenStr += p[i+1];
              i += 2;
              continue;
            }
          }
          if (c === quoteChar) {
            inQuotes = false;
            i++;
            continue;
          }
          tokenStr += c;
          i++;
          continue;
        }
        if (!inQuotes && c === ']') {
          // tokenStr may be empty for numeric
          const raw = tokenStr.length ? tokenStr : p.slice(start, i).trim();
          // try parse number
          if (/^\d+$/.test(raw)) tokens.push(Number(raw));
          else tokens.push(raw);
          i++; // skip ]
          break;
        }
        // accumulate for unquoted (number) case
        tokenStr += c;
        i++;
      }
      continue;
    }
    // no dot or bracket - treat as leading identifier
    let start = i;
    while (i < p.length && p[i] !== '.' && p[i] !== '[') i++;
    if (i > start) tokens.push(p.slice(start, i));
  }
  return tokens.filter(t => t !== '');
}

/**
 * Normalize path to start with $
 */
export function toJsonPath(path) {
  if (typeof path !== 'string') return '$';
  const trimmed = path.trim();
  return trimmed.startsWith('$') ? trimmed : '$' + (trimmed.startsWith('.') ? '' : '.') + trimmed;
}

/**
 * Get value at JSONPath-like path. Returns undefined if not found.
 */
export function getValueAtJsonPath(obj, path) {
  const tokens = tokenize(path);
  let cur = obj;
  for (let token of tokens) {
    if (cur == null) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[token];
    } else {
      cur = cur[token];
    }
  }
  return cur;
}

/**
 * Set value at JSONPath-like path, creating objects/arrays as needed.
 * Returns true on success.
 */
export function setValueAtJsonPath(obj, path, value) {
  if (obj == null || (typeof obj !== 'object' && typeof obj !== 'function')) {
    throw new TypeError('target must be an object or array');
  }
  const tokens = tokenize(path);
  if (tokens.length === 0) {
    // replace root
    return false;
  }
  let cur = obj;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isLast = i === tokens.length - 1;
    if (typeof token === 'number') {
      // ensure cur is array
      if (!Array.isArray(cur)) {
        // if current is empty object, convert to array by replacing keys? safer: set as array on parent
        // but we cannot replace parent reference here; prefer to create array on missing property only.
        return false;
      }
      if (isLast) {
        cur[token] = value;
        return true;
      }
      if (cur[token] == null) {
        // decide next token type: if next token is number -> array, else object
        const next = tokens[i+1];
        cur[token] = typeof next === 'number' ? [] : {};
      }
      cur = cur[token];
    } else {
      // string key
      if (isLast) {
        cur[token] = value;
        return true;
      }
      if (cur[token] == null || (typeof cur[token] !== 'object')) {
        // create container
        const next = tokens[i+1];
        cur[token] = typeof next === 'number' ? [] : {};
      }
      cur = cur[token];
    }
  }
  return false;
}