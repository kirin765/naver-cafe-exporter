import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildXlsx, escapeXml } from "../src/lib/xlsx";

function parts(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = strFromU8(data as Uint8Array);
  return out;
}

describe("escapeXml", () => {
  it("escapes markup characters", () => {
    expect(escapeXml('a<b>&"c')).toBe("a&lt;b&gt;&amp;&quot;c");
  });

  it("strips invalid control characters but keeps tab and newline", () => {
    expect(escapeXml("a\u0001b\tc\nd")).toBe("ab\tc\nd");
  });
});

describe("buildXlsx", () => {
  const bytes = buildXlsx([
    {
      name: "게시글",
      headers: ["post_id", "title", "views"],
      numericColumns: new Set([2]),
      rows: [
        ["007", '=1+1 <b>"x"', 12],
        ["8", "한글 😀\n줄바꿈", 3]
      ]
    },
    { name: "댓글", headers: ["comment_id"], rows: [["c1"]] }
  ]);

  it("produces the required OOXML parts", () => {
    const p = parts(bytes);
    expect(Object.keys(p)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "xl/workbook.xml",
        "xl/sharedStrings.xml",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml"
      ])
    );
  });

  it("writes formula-looking and zero-padded values as literal strings", () => {
    const p = parts(bytes);
    const sst = p["xl/sharedStrings.xml"];
    expect(sst).toContain("=1+1 &lt;b&gt;");
    expect(sst).toContain("007");
    // The string is not stored as a formula (<f>) anywhere.
    expect(p["xl/worksheets/sheet1.xml"]).not.toContain("<f>");
  });

  it("writes numeric cells with t=\"n\"", () => {
    expect(parts(bytes)["xl/worksheets/sheet1.xml"]).toContain('t="n"');
  });

  it("registers both sheets and freezes the header row", () => {
    const p = parts(bytes);
    expect(p["xl/workbook.xml"]).toContain('name="게시글"');
    expect(p["xl/workbook.xml"]).toContain('name="댓글"');
    expect(p["xl/worksheets/sheet1.xml"]).toContain('state="frozen"');
  });

  it("every XML part is well-formed", () => {
    const parser = new DOMParser();
    for (const [name, xml] of Object.entries(parts(bytes))) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      const doc = parser.parseFromString(xml, "application/xml");
      expect(doc.querySelector("parsererror"), name).toBeNull();
    }
  });
});
