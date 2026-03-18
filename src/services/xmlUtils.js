/**
 * xmlUtils.js
 *
 * Safe JSON <-> XML conversions using xml2js.
 * Exports:
 *  - jsonToXmlSafe(obj, options) -> string
 *  - xmlToJsonSafe(xml, options) -> Promise<{ success, data?, error? }>
 */

import { Builder, parseStringPromise } from 'xml2js';

/**
 * Convert JSON object to XML string safely.
 * options:
 *  - rootName: string (default 'root')
 *  - headless: boolean (omit xml header)
 *  - renderOpts: { pretty, indent, newline }
 */
export function jsonToXmlSafe(obj, options = {}) {
  const rootName = options.rootName || 'root';
  const headless = options.headless === true;
  const renderOpts = options.renderOpts || { pretty: true, indent: '  ', newline: '\n' };

  try {
    const builder = new Builder({
      rootName,
      headless,
      renderOpts
    });
    return builder.buildObject(obj);
  } catch (e) {
    throw new Error(`jsonToXmlSafe failed: ${e?.message || String(e)}`);
  }
}

/**
 * Parse XML string into JS object safely.
 * Returns { success: true, data } or { success: false, error }
 * options passed to xml2js.parseStringPromise are accepted.
 */
export async function xmlToJsonSafe(xml, options = {}) {
  if (typeof xml !== 'string') {
    return { success: false, error: 'xml must be a string' };
  }
  try {
    const parseOpts = options.parseOpts || { explicitArray: false, explicitRoot: true, mergeAttrs: true, trim: true };
    const result = await parseStringPromise(xml, parseOpts);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export default {
  jsonToXmlSafe,
  xmlToJsonSafe
};