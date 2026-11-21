// Fast drop-in for make.fun's csv-reader 1.0.0: run(input) returns exactly
// csv-reader's {columns, rows, errors} for every {text, header}, but reads the
// text with indexOf jumps and whole-line fast paths instead of one character
// at a time. Dependency-free ES module, no state kept between calls.
//
// Policy (csv-reader 1.0.0's own): a U+FEFF at the very start is dropped; a
// record ends at LF or CRLF and an empty line is no record; outside quotes a
// CR not followed by LF is dropped (stray_cr); a field opening with a quote
// runs to the next non-doubled quote ("" inside is one quote, every CRLF or
// lone CR inside reads as LF), what follows the closing quote up to the next
// comma or line break is appended as it stands (quote_junk when the field
// ends); a quote that never closes is a literal character and the text after
// it is read again as unquoted (unterminated_quote); a quote inside an
// unquoted field is literal; fields stay strings, never trimmed or converted;
// columns is the first record when header is true, else null; rows are the
// records after it, each padded (short_row, with fields: its count) or cut
// (long_row, with extra: the cut fields) to the first record's width; each
// error is {code, line, row} in the order met, line the 1-based line its
// record starts on, row its record's index in rows, null for the header.
//
// Speed shape: records whose line holds no quote are split natively; the
// common quoted field (one closing quote, no doubled quote, no CR or LF
// inside) is a single slice; only doubled quotes, quoted line breaks and
// unterminated quotes take the general segment path.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Whole-text shortcut: when the text holds no quote at all, the per-record
  // quote search below is skipped entirely.
  const noQuote = text.indexOf('"') === -1;

  // The line the record being read starts on, and the index in rows it takes
  // (null while the header is being read).
  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos onto `value` up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr). Returns the
  // field's value, how it ended, and how many characters were kept.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const iComma = text.indexOf(',', pos);
      const iLf = text.indexOf('\n', pos);
      const iCr = text.indexOf('\r', pos);
      let i = -1;
      let kind = 0; // 0 comma, 1 LF, 2 CR
      if (iComma !== -1) { i = iComma; kind = 0; }
      if (iLf !== -1 && (i === -1 || iLf < i)) { i = iLf; kind = 1; }
      if (iCr !== -1 && (i === -1 || iCr < i)) { i = iCr; kind = 2; }
      if (i === -1) {
        if (pos < n) { value += text.slice(pos); added += n - pos; }
        pos = n;
        return { value, ended: END, added };
      }
      if (kind === 0) {
        if (i > pos) { value += text.slice(pos, i); added += i - pos; }
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        if (i > pos) { value += text.slice(pos, i); added += i - pos; }
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: CRLF ends the line, a lone CR is dropped with an error.
      if (text.charCodeAt(i + 1) === 10) {
        if (i > pos) { value += text.slice(pos, i); added += i - pos; }
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (i > pos) { value += text.slice(pos, i); added += i - pos; }
      pos = i + 1;
      pushError('stray_cr');
    }
  }

  // What follows a quoted field's closing quote: comma, line break, end of
  // text, or junk appended as it stands (quote_junk when the field ends).
  function afterQuoted(value) {
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { // ','
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) { // '\n'
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    const r = readUnquoted(value);
    if (r.added > 0) pushError('quote_junk');
    return r;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Fast attempt: the first quote after the opening one closes the field,
    // it is not doubled, and no CR or LF sits inside it.
    const q = text.indexOf('"', pos + 1);
    if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
      const iN = text.indexOf('\n', pos + 1);
      const iR = text.indexOf('\r', pos + 1);
      if ((iN === -1 || iN > q) && (iR === -1 || iR > q)) {
        pos = q + 1;
        return afterQuoted(text.slice(open + 1, q));
      }
    }
    // General path: doubled quotes, CR/LF inside, or a quote that never
    // closes. Segments are collected and joined at the end.
    const parts = [];
    let cur = pos + 1;
    for (;;) {
      const qq = text.indexOf('"', cur);
      if (qq === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(qq + 1) === 34) {
        // A doubled quote: one quote in the value, keep scanning after it.
        if (qq > cur) parts.push(normalizeSegment(text.slice(cur, qq)));
        parts.push('"');
        cur = qq + 2;
        continue;
      }
      if (qq > cur) parts.push(normalizeSegment(text.slice(cur, qq)));
      pos = qq + 1;
      return afterQuoted(parts.join(''));
    }
  }

  // Normalizes one run of characters from inside a quoted field: every CRLF
  // or lone CR reads as LF, and each counts one line. The common case (no CR
  // at all) returns the segment untouched.
  function normalizeSegment(seg) {
    if (seg.indexOf('\r') === -1) {
      let at = -1;
      for (;;) {
        at = seg.indexOf('\n', at + 1);
        if (at === -1) break;
        line += 1;
      }
      return seg;
    }
    return seg.replace(/\r\n?|\n/g, () => {
      line += 1;
      return '\n';
    });
  }

  // Finishes a record's fields: header, or a padded/cut row with its error.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: no quote on this physical line, so the whole record is one
    // line of plain fields, split natively instead of scanned.
    const iLf = text.indexOf('\n', pos);
    const iQ = noQuote ? -1 : text.indexOf('"', pos);
    if (iQ === -1 || (iLf !== -1 && iQ > iLf)) {
      const end = iLf === -1 ? n : iLf;
      const crlf = iLf !== -1 && end > pos && text.charCodeAt(end - 1) === 13;
      const seg = text.slice(pos, crlf ? end - 1 : end);
      pos = iLf === -1 ? n : iLf + 1;
      if (iLf !== -1) line += 1;
      let fields;
      if (seg.indexOf('\r') === -1) {
        fields = seg.split(',');
      } else {
        // Lone CRs mid-line: each is dropped with a stray_cr error.
        fields = seg.split(',');
        for (let f = 0; f < fields.length; f += 1) {
          const field = fields[f];
          if (field.indexOf('\r') !== -1) {
            const count = field.split('\r').length - 1;
            for (let k = 0; k < count; k += 1) pushError('stray_cr');
            fields[f] = field.replace(/\r/g, '');
          }
        }
      }
      finishRecord(fields, false);
      continue;
    }

    // Slow path: at least one quoted field on this line.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    finishRecord(fields, quoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
