import { strToU8, zipSync } from "fflate";

/**
 * Minimal, dependency-light OOXML workbook writer.
 *
 * Design notes vs. the ReviewBoost generator this replaces:
 *  - string interning uses a Map (O(1)) instead of `Array.indexOf` (O(n²));
 *  - multiple sheets and Korean headers are supported;
 *  - identifiers are always written as text cells so leading zeros survive;
 *  - XML control characters are stripped and `& < >` escaped.
 */

export type SheetValue = string | number | null;
export type SheetSpec = {
  name: string;
  headers: string[];
  rows: SheetValue[][];
  /** Columns (0-based) to write as numeric cells when the value is a number. */
  numericColumns?: Set<number>;
  columnWidths?: number[];
};

const MAX_SHEET_NAME = 31;

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\[\]:*?/\\]/g, " ").slice(0, MAX_SHEET_NAME).trim() || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` ${i++}`;
    candidate = base.slice(0, MAX_SHEET_NAME - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

function cellRef(col: number, row: number): string {
  let s = "";
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s}${row}`;
}

function stripInvalidXmlChars(s: string): string {
  // XML 1.0 disallows most control chars; keep tab (0x09) and newline (0x0A).
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x09 || c === 0x0a || c === 0x0d || c >= 0x20) out += ch;
  }
  return out;
}

export function escapeXml(s: string): string {
  return stripInvalidXmlChars(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Cell =
  | { ref: string; kind: "empty" }
  | { ref: string; kind: "number"; value: number }
  | { ref: string; kind: "string"; index: number };

export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const intern = (s: string): number => {
    const found = index.get(s);
    if (found != null) return found;
    const i = strings.length;
    strings.push(s);
    index.set(s, i);
    return i;
  };

  const usedNames = new Set<string>();
  const prepared = sheets.map((sheet) => {
    const name = sanitizeSheetName(sheet.name, usedNames);
    const headerCells: Cell[] = sheet.headers.map((h, col) => ({
      ref: cellRef(col, 1),
      kind: "string",
      index: intern(h)
    }));
    const dataCells: Cell[][] = sheet.rows.map((row, r) =>
      row.map((v, col): Cell => {
        const ref = cellRef(col, r + 2);
        if (v == null || v === "") return { ref, kind: "empty" };
        if (typeof v === "number" && Number.isFinite(v) && (sheet.numericColumns?.has(col) ?? true)) {
          return { ref, kind: "number", value: v };
        }
        return { ref, kind: "string", index: intern(String(v)) };
      })
    );
    return { name, headers: sheet.headers, headerCells, dataCells, columnWidths: sheet.columnWidths };
  });

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes(prepared.length)),
    "_rels/.rels": strToU8(ROOT_RELS),
    "docProps/core.xml": strToU8(corePropsXml()),
    "docProps/app.xml": strToU8(appProps(prepared.map((s) => s.name))),
    "xl/workbook.xml": strToU8(workbookXml(prepared.map((s) => s.name))),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels(prepared.length)),
    "xl/styles.xml": strToU8(STYLES),
    "xl/sharedStrings.xml": strToU8(sharedStringsXml(strings))
  };

  prepared.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });

  return zipSync(files, { level: 6 });
}

function sheetXml(sheet: {
  name: string;
  headerCells: Cell[];
  dataCells: Cell[][];
  columnWidths?: number[];
}): string {
  const colCount = sheet.headerCells.length;
    const widths =
    sheet.columnWidths && sheet.columnWidths.length === colCount
      ? sheet.columnWidths
      : Array.from({ length: colCount }, () => "18.0");
  const cols = widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" outlineLevel="0" customWidth="true" bestFit="false"/>`
    )
    .join("");
  const totalRows = sheet.dataCells.length + 1;
  const lastCol = cellRef(Math.max(0, colCount - 1), 1).replace(/\d+$/, "");
  const rows = [
    rowXml(1, sheet.headerCells),
    ...sheet.dataCells.map((cells, i) => rowXml(i + 2, cells))
  ].join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="false" autoPageBreaks="false"/></sheetPr>' +
    `<dimension ref="A1:${lastCol}${totalRows}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15.0"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${totalRows}"/>` +
    "</worksheet>"
  );
}

function rowXml(rowNum: number, cells: Cell[]): string {
  return `<row r="${rowNum}">${cells.map(cellXml).join("")}</row>`;
}

function cellXml(c: Cell): string {
  if (c.kind === "empty") return `<c r="${c.ref}" s="2"/>`;
  if (c.kind === "number") return `<c r="${c.ref}" s="2" t="n"><v>${c.value}</v></c>`;
  return `<c r="${c.ref}" s="2" t="s"><v>${c.index}</v></c>`;
}

function sharedStringsXml(strings: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("") +
    "</sst>"
  );
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<workbookPr date1904="false"/>' +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    `<sheets>${sheets}</sheets>` +
    "<definedNames></definedNames>" +
    "</workbook>"
  );
}

function workbookRels(count: number): string {
  const sheetRels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`
  ).join("");
  const styleId = count + 1;
  const sharedId = count + 2;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetRels +
    `<Relationship Id="rId${styleId}" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>` +
    `<Relationship Id="rId${sharedId}" Target="sharedStrings.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"/>` +
    "</Relationships>"
  );
}

function contentTypes(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>"
  );
}

function corePropsXml(): string {
  const created = new Date().toISOString();
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:creator>NaverCafeExporter</dc:creator>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    "</cp:coreProperties>"
  );
}

function appProps(sheetNames: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    "<Application>NaverCafeExporter</Application>" +
    "<AppVersion>1.0</AppVersion>" +
    `<HeadingPairs><vt:vector xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" size="${sheetNames.length}" baseType="lpstr">${sheetNames
      .map((n) => `<vt:lpstr>${escapeXml(n)}</vt:lpstr>`)
      .join("")}</vt:vector></TitlesOfParts>` +
    "</Properties>"
  );
}

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  "</Relationships>";

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="0"></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11.00"/><color rgb="FF000000"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11.00"/><color rgb="FF000000"/><name val="Calibri"/></font>' +
  "</fonts>" +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEEFF"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyBorder="1" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="true"/></xf>' +
  "</cellXfs>" +
  '<dxfs count="0"></dxfs>' +
  "</styleSheet>";
