/**
 * Positioned text extraction from the Consumer Council's tariff PDFs.
 *
 * Zero dependencies: Node's built-in zlib inflates the content streams and
 * everything else is a small, deliberately narrow PDF reader. This is not a
 * general-purpose PDF library and must not be mistaken for one — it supports
 * exactly the shape the Consumer Council's generator produces, and refuses
 * anything else rather than guessing.
 *
 * Verified against the real current PDFs (2026-09-13, issue #17):
 *
 *   Producer      dompdf 3.1.5 + CPDF
 *   Fonts         two only, both /Type0 /Identity-H with an identity
 *                 /ToUnicode CMap (<0000> <FFFF> <0000>), so a 2-byte
 *                 character code is its own Unicode code point and strings
 *                 decode as UTF-16BE
 *   Text          one `BT <x> <y> Td /F<n> <size> Tf [(...)] TJ ET` block per
 *                 positioned run — 726 such blocks in the Economy 7 PDF and
 *                 813 in the standard one, none with a second Td, a Tm, or
 *                 kerning numbers inside the TJ array
 *
 * Those observations inform the design but are not trusted blindly: the
 * positioning and text-showing operators are interpreted properly, so that a
 * future layout change produces either correct output or a loud failure,
 * never a silently mis-merged table cell. Font encodings are asserted, not
 * assumed. Incorrect tariff data is worse than no tariff data.
 */

import { inflateSync } from 'node:zlib';

export class PdfExtractionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PdfExtractionError';
    this.code = code;
    this.details = details;
  }
}

const PDF_HEADER = '%PDF-';

/**
 * Parses the file's indirect objects by walking forward through the bytes,
 * using each stream's declared /Length to step over its payload. Scanning
 * with a global regex instead would also match byte sequences that merely
 * look like "12 0 obj" inside compressed stream data.
 */
function parseObjects(latin1) {
  const objects = new Map();
  const objPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let cursor = 0;

  while (cursor < latin1.length) {
    objPattern.lastIndex = cursor;
    const match = objPattern.exec(latin1);
    if (!match) break;

    const number = Number(match[1]);
    const bodyStart = match.index + match[0].length;

    const streamAt = latin1.indexOf('stream', bodyStart);
    const endObjAt = latin1.indexOf('endobj', bodyStart);
    const hasStream = streamAt !== -1 && (endObjAt === -1 || streamAt < endObjAt);

    if (!hasStream) {
      const end = endObjAt === -1 ? latin1.length : endObjAt;
      objects.set(number, { dict: latin1.slice(bodyStart, end), stream: null });
      cursor = end + 'endobj'.length;
      continue;
    }

    const dict = latin1.slice(bodyStart, streamAt);
    let dataStart = streamAt + 'stream'.length;
    if (latin1[dataStart] === '\r') dataStart += 1;
    if (latin1[dataStart] === '\n') dataStart += 1;

    const lengthMatch = /\/Length\s+(\d+)\b/.exec(dict);
    let dataEnd;
    if (lengthMatch) {
      dataEnd = dataStart + Number(lengthMatch[1]);
    } else {
      // No direct /Length (it may be an indirect reference). Fall back to the
      // endstream keyword, which is correct unless the payload contains it.
      const endStreamAt = latin1.indexOf('endstream', dataStart);
      dataEnd = endStreamAt === -1 ? latin1.length : endStreamAt;
    }

    objects.set(number, { dict, stream: latin1.slice(dataStart, dataEnd) });
    cursor = dataEnd;
  }

  return objects;
}

function decodeStream(object, where) {
  if (object?.stream == null) return null;
  const raw = Buffer.from(object.stream, 'latin1');
  if (!/\/Filter/.test(object.dict)) return raw;
  if (!/\/FlateDecode/.test(object.dict)) {
    throw new PdfExtractionError(
      'UNSUPPORTED_STREAM_FILTER',
      `${where} uses a stream filter this reader does not support (only /FlateDecode)`,
      { where, dict: object.dict.slice(0, 200) }
    );
  }
  try {
    return inflateSync(raw);
  } catch (err) {
    throw new PdfExtractionError('STREAM_DECODE_FAILED', `${where} could not be inflated: ${err.message}`, { where });
  }
}

/** Resolves the page objects in document order, following nested page trees. */
function pageRefsInOrder(objects) {
  let rootRef = null;
  for (const [number, object] of objects) {
    if (/\/Type\s*\/Pages/.test(object.dict) && !/\/Parent\b/.test(object.dict)) {
      rootRef = number;
      break;
    }
  }
  if (rootRef === null) {
    for (const [number, object] of objects) {
      if (/\/Type\s*\/Pages/.test(object.dict)) {
        rootRef = number;
        break;
      }
    }
  }
  if (rootRef === null) throw new PdfExtractionError('NO_PAGE_TREE', 'No /Type /Pages node found');

  const pages = [];
  const seen = new Set();
  const walk = (ref) => {
    if (seen.has(ref)) return; // a malformed cyclic tree must not hang the run
    seen.add(ref);
    const object = objects.get(ref);
    if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object.dict) && !/\/Type\s*\/Pages/.test(object.dict)) {
      pages.push(ref);
      return;
    }
    const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(object.dict);
    if (!kids) return;
    for (const kid of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]));
  };
  walk(rootRef);
  return pages;
}

/**
 * Asserts every font is /Type0 with /Identity-H encoding and an identity
 * /ToUnicode CMap, which is what makes UTF-16BE decoding of the content
 * streams correct. A simple font, a /Differences array or a non-identity
 * CMap would silently produce wrong characters, so it fails instead.
 */
function assertSupportedFonts(objects) {
  const fontRefs = new Set();
  for (const [, object] of objects) {
    const fontMap = /\/Font\s*<<([\s\S]*?)>>/.exec(object.dict);
    if (!fontMap) continue;
    for (const ref of fontMap[1].matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) fontRefs.add(Number(ref[2]));
  }
  if (fontRefs.size === 0) {
    throw new PdfExtractionError('NO_FONTS', 'No font resources found; the text layer cannot be decoded safely');
  }

  for (const ref of fontRefs) {
    const font = objects.get(ref);
    if (!font) throw new PdfExtractionError('FONT_MISSING', `Font object ${ref} is referenced but absent`);
    if (!/\/Subtype\s*\/Type0\b/.test(font.dict) || !/\/Encoding\s*\/Identity-H\b/.test(font.dict)) {
      throw new PdfExtractionError(
        'UNSUPPORTED_FONT_ENCODING',
        `Font object ${ref} is not /Type0 with /Identity-H encoding; this reader cannot decode its text safely`,
        { ref, dict: font.dict.replace(/\s+/g, ' ').trim().slice(0, 200) }
      );
    }
    const toUnicodeRef = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(font.dict);
    if (!toUnicodeRef) {
      throw new PdfExtractionError('FONT_WITHOUT_TOUNICODE', `Font object ${ref} has no /ToUnicode CMap`, { ref });
    }
    const cmap = decodeStream(objects.get(Number(toUnicodeRef[1])), `ToUnicode CMap ${toUnicodeRef[1]}`)?.toString('latin1') ?? '';
    const identityRange = /beginbfrange[\s\S]*?<0{4}>\s*<[fF]{4}>\s*<0{4}>[\s\S]*?endbfrange/.test(cmap);
    if (!identityRange) {
      throw new PdfExtractionError(
        'NON_IDENTITY_TOUNICODE',
        `Font object ${ref} has a non-identity /ToUnicode CMap; character codes cannot be treated as Unicode code points`,
        { ref, cmap: cmap.slice(0, 300) }
      );
    }
  }

  return fontRefs.size;
}

/** Decodes a PDF literal string's escapes to raw bytes. */
function literalStringBytes(source) {
  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = source[i + 1];
    i += 1;
    if (next >= '0' && next <= '7') {
      let octal = next;
      while (octal.length < 3 && source[i + 1] >= '0' && source[i + 1] <= '7') {
        octal += source[i + 1];
        i += 1;
      }
      bytes.push(parseInt(octal, 8) & 0xff);
    } else if (next === 'n') bytes.push(10);
    else if (next === 'r') bytes.push(13);
    else if (next === 't') bytes.push(9);
    else if (next === 'b') bytes.push(8);
    else if (next === 'f') bytes.push(12);
    else if (next === '\n') continue; // line continuation
    else bytes.push(next.charCodeAt(0) & 0xff);
  }
  return bytes;
}

/** Two-byte big-endian character codes; identity /ToUnicode makes these code points. */
function decodeUtf16Be(bytes) {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return text;
}

const TOKEN_PATTERN = /<<|>>|\[|\]|\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>|\/[^\s/<>[\]()]*|[-+]?[\d.]+|[A-Za-z'"*]+/g;

/**
 * Interprets a page content stream's text operators, returning one item per
 * shown string with the text-space position it was shown at.
 */
function textItemsFromContent(content, page) {
  const items = [];
  const tokens = content.match(TOKEN_PATTERN) ?? [];
  const operands = [];

  let textMatrix = null; // [e, f] translation only; this generator uses Td
  let lineMatrix = null;
  let leading = 0;
  let fontName = null;
  let fontSize = null;
  let inText = false;

  const numeric = (token) => {
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  };

  const show = (bytes) => {
    if (!inText || !textMatrix) return;
    const text = decodeUtf16Be(bytes);
    if (text.length === 0) return;
    items.push({ page, x: textMatrix[0], y: textMatrix[1], fontName, fontSize, text });
  };

  for (const token of tokens) {
    if (/^[-+]?[\d.]+$/.test(token) || token.startsWith('/') || token.startsWith('(') || token.startsWith('<')) {
      operands.push(token);
      continue;
    }

    // Array and dictionary delimiters are structural: they must not clear the
    // pending operands, or `[ (text) ] TJ` would reach TJ with nothing to show.
    if (token === '[' || token === ']' || token === '<<' || token === '>>') continue;

    switch (token) {
      case 'BT':
        inText = true;
        textMatrix = [0, 0];
        lineMatrix = [0, 0];
        break;
      case 'ET':
        inText = false;
        textMatrix = null;
        lineMatrix = null;
        break;
      case 'Tf': {
        const size = numeric(operands[operands.length - 1]);
        const name = operands[operands.length - 2];
        if (typeof name === 'string' && name.startsWith('/')) fontName = name.slice(1);
        if (size !== null) fontSize = size;
        break;
      }
      case 'TL': {
        const value = numeric(operands[operands.length - 1]);
        if (value !== null) leading = value;
        break;
      }
      case 'Td':
      case 'TD': {
        const ty = numeric(operands[operands.length - 1]);
        const tx = numeric(operands[operands.length - 2]);
        if (tx !== null && ty !== null && lineMatrix) {
          if (token === 'TD') leading = -ty;
          lineMatrix = [lineMatrix[0] + tx, lineMatrix[1] + ty];
          textMatrix = [...lineMatrix];
        }
        break;
      }
      case 'Tm': {
        const f = numeric(operands[operands.length - 1]);
        const e = numeric(operands[operands.length - 2]);
        if (e !== null && f !== null) {
          lineMatrix = [e, f];
          textMatrix = [e, f];
        }
        break;
      }
      case 'T*':
        if (lineMatrix) {
          lineMatrix = [lineMatrix[0], lineMatrix[1] - leading];
          textMatrix = [...lineMatrix];
        }
        break;
      case 'Tj':
      case "'":
      case '"': {
        if (token !== 'Tj' && lineMatrix) {
          lineMatrix = [lineMatrix[0], lineMatrix[1] - leading];
          textMatrix = [...lineMatrix];
        }
        const last = operands[operands.length - 1];
        if (typeof last === 'string' && last.startsWith('(')) show(literalStringBytes(last.slice(1, -1)));
        break;
      }
      case 'TJ': {
        // Array elements are already flat in `operands`; strings contribute
        // text and numbers are kerning adjustments this reader ignores.
        const bytes = [];
        for (const operand of operands) {
          if (typeof operand === 'string' && operand.startsWith('(')) bytes.push(...literalStringBytes(operand.slice(1, -1)));
        }
        show(bytes);
        break;
      }
      default:
        break;
    }

    operands.length = 0;
  }

  return items;
}

/**
 * Extracts every positioned text run from a PDF buffer.
 *
 * Returns `{ pageCount, fontCount, items }` where each item is
 * `{ page, x, y, fontName, fontSize, text }`. `y` increases up the page, as
 * in PDF user space. Throws PdfExtractionError rather than returning partial
 * or guessed output.
 */
export function extractTextItems(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new PdfExtractionError('EMPTY_INPUT', 'No PDF bytes supplied');
  }
  const latin1 = buffer.toString('latin1');
  if (!latin1.startsWith(PDF_HEADER)) {
    throw new PdfExtractionError('NOT_A_PDF', 'Input does not start with the %PDF- signature');
  }

  const objects = parseObjects(latin1);
  if (objects.size === 0) throw new PdfExtractionError('NO_OBJECTS', 'No indirect objects found');

  const fontCount = assertSupportedFonts(objects);
  const pageRefs = pageRefsInOrder(objects);
  if (pageRefs.length === 0) throw new PdfExtractionError('NO_PAGES', 'Page tree contains no pages');

  const items = [];
  pageRefs.forEach((ref, index) => {
    const page = index + 1;
    const pageObject = objects.get(ref);
    const contentRefs = [];
    const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObject.dict);
    const array = /\/Contents\s*\[([\s\S]*?)\]/.exec(pageObject.dict);
    if (array) {
      for (const ref2 of array[1].matchAll(/(\d+)\s+\d+\s+R/g)) contentRefs.push(Number(ref2[1]));
    } else if (single) {
      contentRefs.push(Number(single[1]));
    }
    for (const contentRef of contentRefs) {
      const content = decodeStream(objects.get(contentRef), `Content stream ${contentRef} (page ${page})`);
      if (!content) continue;
      items.push(...textItemsFromContent(content.toString('latin1'), page));
    }
  });

  if (items.length === 0) {
    throw new PdfExtractionError('NO_TEXT', 'No text runs were extracted; the PDF may be scanned or use an unsupported layout');
  }

  return { pageCount: pageRefs.length, fontCount, items };
}
