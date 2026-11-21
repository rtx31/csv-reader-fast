// csv-reader-fast: a fast drop-in replacement for make.fun's csv-reader 1.0.0.
//
// Same answers on every input: same {columns, rows, errors} shape, same error
// codes, same error order, same line/row attribution. The semantics it mirrors:
//
//   - a U+FEFF at the very start is dropped, anywhere else it is literal;
//   - empty lines (\n or \r\n) are no records; a lone \r is not skipped;
//   - a record ends at LF or CRLF; fields are never trimmed or converted;
//   - a field opening with '"' runs to the next undoubled '"'; "" inside is one
//     '"'; every CRLF or lone CR inside becomes one '\n' and moves the line;
//   - junk after a closing quote is appended as it stands; quote_junk only
//     when that junk kept more than zero characters;
//   - a quote that never closes becomes a literal '"', the line resets to the
//     line the quote opened on, unterminated_quote is recorded first, and the
//     text after it is re-read as an unquoted field;
//   - a lone CR outside quotes is dropped as stray_cr and does not move the line;
//   - a record of one empty unquoted field is dropped (its errors stay, with
//     the row index the next row will take);
//   - the first record sets the width; the header is never short/long-checked;
//   - header=true with no records gives columns [].
//
// Speed: one pass over the input string. Every scan is bounded by the line or
// the field it works on — no indexOf ever runs past the next line break, so
// there is no quadratic rescanning. A line with no '"' is split with native
// indexOf scans on the line slice; a line holding a stray CR goes through a
// CR-aware scan on the same slice; only a line with a '"' takes the
// field-by-field quoted path. Fields are slices, never built char by char.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header).
  let recordLine = 1;
  let recordRow = null;
  // Whether the last field read by the slow path was quoted.
  let sq = false;

  // Shared outputs of the unquoted scanner, so no object is built per field.
  // ue: 0 = ended at a comma, 1 = ended at a line break, 2 = end of text.
  let uv = '';
  let ue = 0;
  let ua = 0;
  // Index of the next '\n' at or after the position it was computed for.
  // Unquoted fields on the same line share it, so the newline scan runs once
  // per line instead of once per field. It is refreshed whenever pos has
  // moved past it (a quoted field may have run over several lines).
  let nlCache = -1;

  // Scan unquoted characters from pos, appending them to `value`, up to the
  // next comma or line break. A CR not followed by LF is dropped and recorded
  // as stray_cr; it does not end the field and does not move `line`. The CR
  // check runs on the field slice only, never past the field's end.
  function unq(value) {
    let acc = null; // pieces joined once a stray CR forces accumulation
    let cur = pos;
    if (nlCache < pos) nlCache = text.indexOf('\n', pos);
    for (;;) {
      const cm = text.indexOf(',', cur);
      const nl = nlCache;
      let d = n;
      let kind = 2; // 0 comma, 1 LF, 2 end of text
      if (cm !== -1 && (nl === -1 || cm < nl)) { d = cm; kind = 0; }
      else if (nl !== -1) { d = nl; kind = 1; }
      const seg = text.slice(cur, d);
      const crRel = seg.indexOf('\r');
      if (crRel === -1) {
        uv = acc === null ? value + seg : acc + seg;
        ua = uv.length - value.length;
        if (kind === 0) { pos = d + 1; ue = 0; }
        else if (kind === 1) { pos = d + 1; line += 1; ue = 1; }
        else { pos = n; ue = 2; }
        return;
      }
      const cr = cur + crRel;
      if (cr === d - 1 && kind === 1) {
        // CRLF: the field ends at the CR.
        const head = text.slice(cur, cr);
        uv = acc === null ? value + head : acc + head;
        ua = uv.length - value.length;
        pos = d + 1;
        line += 1;
        ue = 1;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (acc === null) acc = value + text.slice(cur, cr);
      else acc += text.slice(cur, cr);
      cur = cr + 1;
    }
  }

  // Split the slice s on commas, up to index end (end <= s.length).
  function splitStr(s, end) {
    const out = [];
    let f = 0;
    for (;;) {
      const cm = s.indexOf(',', f);
      if (cm === -1 || cm >= end) { out.push(s.slice(f, end)); return out; }
      out.push(s.slice(f, cm));
      f = cm + 1;
    }
  }

  // Split the quote-free line slice ls on commas, dropping stray CRs (each a
  // stray_cr). A CR at the very end of the slice is the CRLF of a line ending
  // only when hasNl is true; otherwise it is a stray CR too.
  function scanLineCrSlice(ls, hasNl) {
    const out = [];
    const m = ls.length;
    let f = 0; // start of the current field
    let cur = 0; // scan position
    let acc = '';
    let hasAcc = false;
    for (;;) {
      const cm = ls.indexOf(',', cur);
      const cr = ls.indexOf('\r', cur);
      let d = -1;
      let kind = 0; // 1 comma, 2 CR
      if (cm !== -1 && (cr === -1 || cm < cr)) { d = cm; kind = 1; }
      else if (cr !== -1) { d = cr; kind = 2; }
      if (d === -1) {
        const tail = ls.slice(cur, m);
        out.push(hasAcc ? acc + tail : tail);
        return out;
      }
      if (kind === 1) {
        const seg = ls.slice(cur, d);
        out.push(hasAcc ? acc + seg : seg);
        acc = '';
        hasAcc = false;
        f = d + 1;
        cur = d + 1;
      } else if (d === m - 1 && hasNl) {
        // CRLF at the end of the line: the field ends here, the record ends.
        const seg = ls.slice(cur, d);
        out.push(hasAcc ? acc + seg : seg);
        return out;
      } else {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        acc += ls.slice(cur, d);
        hasAcc = true;
        cur = d + 1;
      }
    }
  }

  // Read one record whose first line holds a '"' — field by field. A quoted
  // field may run over several lines; unquoted fields end at the next comma,
  // line break or end of text.
  function parseSlow() {
    const fields = [];
    let ended = 0; // 0 comma, 1 line break, 2 end of text
    for (;;) {
      let value;
      if (text.charCodeAt(pos) === 34) {
        sq = true;
        const open = pos;
        const openLine = line;
        let p = pos + 1;
        let segStart = pos + 1; // start of the current literal run
        let parts = null; // pieces once a doubled quote or CR break appears
        let closedAt = -1;
        let fastValue = null; // set by the single-line fast close below
        // Fast close for the common single-line quoted field: the closing
        // quote is on the same line, it is not doubled, and no CR sits
        // before it. Then the value is one slice and no segment loop runs.
        const qq0 = text.indexOf('"', open + 1);
        const nl0 = text.indexOf('\n', open + 1);
        if (qq0 !== -1 && (nl0 === -1 || qq0 < nl0) && text.charCodeAt(qq0 + 1) !== 34) {
          const head0 = text.slice(open + 1, qq0);
          if (head0.indexOf('\r') === -1) {
            closedAt = qq0;
            fastValue = head0;
          }
        }
        if (closedAt === -1) {
        for (;;) {
          // One segment: up to the next LF (a plain LF inside quotes is a
          // literal '\n', so the run simply continues through it).
          const nl = text.indexOf('\n', p);
          const segEnd = nl === -1 ? n : nl;
          const seg = text.slice(p, segEnd);
          const qRel = seg.indexOf('"');
          const crRel = seg.indexOf('\r');
          if (qRel !== -1 && (crRel === -1 || qRel < crRel)) {
            const qq = p + qRel;
            if (text.charCodeAt(qq + 1) === 34) {
              // A doubled quote: one literal quote, keep scanning.
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, qq), '"');
              p = qq + 2;
              segStart = qq + 2;
              continue;
            }
            closedAt = qq;
            break;
          }
          if (crRel !== -1) {
            // A CR before any quote in this segment: a line break inside
            // the quotes (CRLF or lone CR), one '\n' in the value.
            const br = p + crRel;
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, br), '\n');
            line += 1;
            p = br + (text.charCodeAt(br + 1) === 10 ? 2 : 1);
            segStart = p;
            continue;
          }
          if (nl === -1) break; // no quote, no CR, no more newlines
          // Plain segment up to the newline: the run continues through it.
          line += 1;
          p = segEnd + 1;
        }
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, the line
          // resets to the line the quote opened on, and the text after it
          // is re-read as an unquoted field. The unterminated_quote error
          // is recorded before any stray_cr from that re-read.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          unq('"');
          value = uv;
          ended = ue;
        } else {
          value = fastValue !== null
            ? fastValue
            : parts === null
              ? text.slice(open + 1, closedAt)
              : parts.join('') + text.slice(segStart, closedAt);
          pos = closedAt + 1;
          if (pos >= n) {
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos += 1; ended = 0; }
            else if (c === 10) { pos += 1; line += 1; ended = 1; }
            else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 1; }
            else {
              // Junk after the closing quote, appended as it stands.
              unq(value);
              if (ua > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = uv;
              ended = ue;
            }
          }
        }
      } else {
        sq = false;
        unq('');
        value = uv;
        ended = ue;
      }
      fields.push(value);
      if (ended !== 0) break;
    }
    return fields;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const le0 = text.indexOf('\n', pos);
    const le = le0 === -1 ? n : le0;
    const ls = text.slice(pos, le); // this line, without its line break
    const q = ls.indexOf('"');
    let fields;
    let lastQuoted = false;

    if (q === -1) {
      // No quote on this line: the record ends at the line break (or EOF).
      const r = ls.indexOf('\r');
      if (r === -1) {
        fields = splitStr(ls, ls.length);
      } else if (r === ls.length - 1 && le0 !== -1) {
        // The only CR is the trailing one of a CRLF line ending.
        fields = splitStr(ls, ls.length - 1);
      } else {
        fields = scanLineCrSlice(ls, le0 !== -1);
      }
      if (le0 === -1) pos = n;
      else { pos = le0 + 1; line += 1; }
    } else {
      fields = parseSlow();
      lastQuoted = sq;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
