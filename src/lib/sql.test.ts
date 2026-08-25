import { describe, expect, it } from "vitest";

import {
  clausesOf,
  isSqlFence,
  roleOf,
  splitStatements,
  sqlSpeechFor,
  sqlToMarkdown,
  stepText,
  stepsOf,
  stepsOfScript,
  stripComments,
} from "./sql";

/**
 * Clause boundaries are a lexical problem wearing a semantic hat.
 *
 * Almost everything below is a way of being fooled: a keyword inside a string,
 * a keyword inside a subquery, a keyword inside a bracketed column name, a
 * comment containing a semicolon. Each one produces a *plausible* split rather
 * than a crash — the query still renders, the steps still play, and the reader
 * is quietly taught the wrong evaluation order for that statement. That is the
 * failure mode this file exists for, and it is why the fixtures are shaped like
 * real T-SQL rather than like minimal cases.
 */

const FEASIBILITY = `WITH RankedLabs AS (        -- criterion 3: latest HbA1c per patient
    SELECT PATIENT_ID,
           ROW_NUMBER() OVER (PARTITION BY PATIENT_ID ORDER BY TEST_DATE DESC) AS rn
    FROM lab_results
    WHERE LOINC_CODE = '4548-4'
),
RankedGFR AS (
    SELECT PATIENT_ID, RESULT_VALUE
    FROM lab_results
    WHERE LOINC_CODE = '33914-3'
)
SELECT p.PATIENT_ID
FROM patients p
JOIN RankedLabs a ON a.PATIENT_ID = p.PATIENT_ID AND a.rn = 1
JOIN RankedGFR  g ON g.PATIENT_ID = p.PATIENT_ID
WHERE p.DEATHDATE IS NULL
  AND EXISTS (
        SELECT 1 FROM conditions c
        WHERE c.PATIENT_ID = p.PATIENT_ID
          AND c.DESCRIPTION LIKE '%type 2 diabetes%'
  )
ORDER BY p.PATIENT_ID;`;

describe("isSqlFence", () => {
  it.each(["sql", "SQL", "tsql", "t-sql", " mssql "])("accepts %s", (info) => {
    expect(isSqlFence(info)).toBe(true);
  });

  it.each(["", "js", "python", "fp-grid", "sqlite"])("rejects %s", (info) => {
    expect(isSqlFence(info)).toBe(false);
  });
});

describe("stripComments", () => {
  it("removes a line comment but keeps the code before it", () => {
    expect(stripComments("SELECT 1 -- why\nFROM t").trim()).toBe("SELECT 1 \nFROM t".trim());
  });

  it("removes a block comment", () => {
    expect(stripComments("SELECT /* note */ 1")).toBe("SELECT  1");
  });

  it("handles nested block comments, which T-SQL allows", () => {
    expect(stripComments("A /* outer /* inner */ still */ B")).toBe("A  B");
  });

  it("leaves a string that looks like a comment alone", () => {
    expect(stripComments("WHERE note = '-- not a comment'")).toBe(
      "WHERE note = '-- not a comment'"
    );
  });
});

describe("splitStatements", () => {
  it("splits on a semicolon", () => {
    expect(splitStatements("SELECT 1; SELECT 2;")).toHaveLength(2);
  });

  it("splits on GO, which is a batch marker and not SQL", () => {
    const out = splitStatements("USE Practice\nGO\nSELECT 1");
    expect(out).toHaveLength(2);
    expect(out[1].text).toBe("SELECT 1");
  });

  it("does not split on GO inside an identifier", () => {
    expect(splitStatements("SELECT GOAL FROM targets")).toHaveLength(1);
  });

  it("does not split on a semicolon inside a string", () => {
    expect(splitStatements("SELECT 'a;b' AS x")).toHaveLength(1);
  });

  it("does not split on a semicolon inside a comment", () => {
    expect(splitStatements("SELECT 1 -- one; two\nFROM t")).toHaveLength(1);
  });

  it("drops a trailing slice that is only a comment", () => {
    expect(splitStatements("SELECT 1;\n-- done")).toHaveLength(1);
  });

  it("keeps a statement that is only a string literal", () => {
    // Comments are inert, strings are not: `SELECT 'x'` really is a statement.
    expect(splitStatements("SELECT 'x'")).toHaveLength(1);
  });
});

describe("clausesOf", () => {
  it("finds the top-level clauses of a plain query", () => {
    const out = clausesOf("SELECT a FROM t WHERE b = 1 ORDER BY a");
    expect(out.map((c) => c.keyword)).toEqual(["SELECT", "FROM", "WHERE", "ORDER BY"]);
  });

  it("does not cut inside a subquery", () => {
    // Depth-0 only. Splitting here would present a predicate's internals as
    // steps of the statement containing it, in an order that is fiction.
    const out = clausesOf("SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.id = t.id)");
    expect(out.map((c) => c.keyword)).toEqual(["SELECT", "FROM", "WHERE"]);
  });

  it("does not cut inside a string literal", () => {
    const out = clausesOf("SELECT a FROM t WHERE note LIKE '%select from where%'");
    expect(out.map((c) => c.keyword)).toEqual(["SELECT", "FROM", "WHERE"]);
  });

  it("does not cut inside a bracketed identifier", () => {
    const out = clausesOf("SELECT [Order By Date] FROM t");
    expect(out.map((c) => c.keyword)).toEqual(["SELECT", "FROM"]);
  });

  it("does not cut on a keyword that only prefixes a longer word", () => {
    // Guarded by the word-boundary anchor in the patterns themselves.
    expect(clausesOf("SELECT wherefore, fromage FROM t").map((c) => c.keyword)).toEqual([
      "SELECT",
      "FROM",
    ]);
  });

  it("does not cut on a keyword that only ends a longer word", () => {
    // A different guard entirely, and the one easy to leave out: a word
    // boundary is
    // satisfied at the *end* of "myfrom", so only refusing to start a match
    // mid-word stops a bogus FROM clause here. Written the other way round —
    // "fromage" alone — this test passed with that check deleted.
    expect(clausesOf("SELECT a FROM myfrom").map((c) => c.keyword)).toEqual([
      "SELECT",
      "FROM",
    ]);
    expect(clausesOf("SELECT a FROM t JOIN nowhere n ON 1=1").map((c) => c.keyword)).toEqual([
      "SELECT",
      "FROM",
      "JOIN",
    ]);
  });

  it("takes GROUP BY and ORDER BY whole", () => {
    const out = clausesOf("SELECT a FROM t GROUP BY a ORDER BY a");
    expect(out.map((c) => c.keyword)).toEqual(["SELECT", "FROM", "GROUP BY", "ORDER BY"]);
  });

  it("keeps a join and its ON condition as one clause", () => {
    // "on a.id = b.id" as its own step gives no way to know which join it
    // belonged to.
    const out = clausesOf("SELECT a FROM t JOIN u ON u.id = t.id WHERE x = 1");
    expect(out[2].keyword).toBe("JOIN");
    expect(out[2].text).toContain("ON u.id = t.id");
  });

  it("recognises every join flavour as one keyword", () => {
    for (const join of ["INNER JOIN", "LEFT OUTER JOIN", "CROSS JOIN", "FULL JOIN"]) {
      expect(clausesOf(`SELECT a FROM t ${join} u ON 1=1`)[2].keyword).toBe("JOIN");
    }
  });

  it("keeps whatever came before the first keyword rather than dropping it", () => {
    const out = clausesOf("USE Practice; SELECT 1");
    expect(out[0].keyword).toBe("OTHER");
    expect(out[0].text).toBe("USE Practice;");
  });

  it("returns one OTHER clause for something it does not recognise", () => {
    expect(clausesOf("EXEC sp_who2").map((c) => c.keyword)).toEqual(["OTHER"]);
  });

  it("is empty for empty input", () => {
    expect(clausesOf("   ")).toEqual([]);
  });
});

describe("stepsOf — evaluation order", () => {
  it("puts SELECT after the filters, which is the entire point", () => {
    const steps = stepsOf("SELECT a FROM t WHERE b = 1");
    expect(steps.map((s) => s.keyword)).toEqual(["FROM", "WHERE", "SELECT"]);
  });

  it("orders the full shape the way an engine evaluates it", () => {
    const steps = stepsOf(
      "SELECT a, COUNT(*) FROM t JOIN u ON 1=1 WHERE b = 1 GROUP BY a HAVING COUNT(*) > 2 ORDER BY a"
    );
    expect(steps.map((s) => s.keyword)).toEqual([
      "FROM",
      "JOIN",
      "WHERE",
      "GROUP BY",
      "HAVING",
      "SELECT",
      "ORDER BY",
    ]);
  });

  it("keeps two joins in the order they were written", () => {
    const steps = stepsOf("SELECT a FROM t JOIN u ON 1=1 JOIN v ON 2=2");
    const joins = steps.filter((s) => s.keyword === "JOIN");
    expect(joins[0].text).toContain(" u ");
    expect(joins[1].text).toContain(" v ");
  });

  it("records where each step sits in the written statement", () => {
    const steps = stepsOf("SELECT a FROM t WHERE b = 1");
    // SELECT is written first and evaluated last.
    const select = steps.find((s) => s.keyword === "SELECT")!;
    expect(select.written).toBe(0);
    expect(select.i).toBe(2);
  });

  it("spans point at the right characters of the statement", () => {
    const statement = "SELECT a FROM t WHERE b = 1";
    for (const step of stepsOf(statement)) {
      expect(statement.slice(step.start, step.end).trim()).toBe(step.text);
    }
  });
});

describe("stepsOf — common table expressions", () => {
  const steps = stepsOf(FEASIBILITY);

  it("steps each CTE's own clauses rather than treating WITH as one lump", () => {
    expect(steps.some((s) => s.cte === "RankedLabs")).toBe(true);
    expect(steps.some((s) => s.cte === "RankedGFR")).toBe(true);
  });

  it("builds each CTE whole before starting the next", () => {
    // Interleaving them — both FROMs, then both WHEREs — presents two
    // independent queries as one, and is what this looked like at first.
    const names = steps.filter((s) => s.cte).map((s) => s.cte);
    const firstGfr = names.indexOf("RankedGFR");
    expect(names.slice(0, firstGfr).every((n) => n === "RankedLabs")).toBe(true);
    expect(names.slice(firstGfr).every((n) => n === "RankedGFR")).toBe(true);
  });

  it("evaluates every CTE before any of the main body", () => {
    const lastCte = steps.map((s) => Boolean(s.cte)).lastIndexOf(true);
    const firstBody = steps.findIndex((s) => !s.cte);
    expect(lastCte).toBeLessThan(firstBody);
  });

  it("puts the main SELECT last but for the ORDER BY", () => {
    const body = steps.filter((s) => !s.cte).map((s) => s.keyword);
    expect(body).toEqual(["FROM", "JOIN", "JOIN", "WHERE", "SELECT", "ORDER BY"]);
  });

  it("does not let the EXISTS subquery contribute steps of its own", () => {
    // Three keywords live inside that predicate and none of them is a clause
    // of this statement.
    expect(steps.filter((s) => !s.cte && s.keyword === "SELECT")).toHaveLength(1);
  });

  it("keeps CTE spans pointing into the original statement", () => {
    for (const step of steps) {
      expect(FEASIBILITY.slice(step.start, step.end).trim()).toBe(step.text);
    }
  });
});

describe("stepsOfScript", () => {
  it("numbers steps across every statement in the block", () => {
    const steps = stepsOfScript("SELECT a FROM t;\nSELECT b FROM u;");
    expect(steps.map((s) => s.i)).toEqual([0, 1, 2, 3]);
    expect(steps.map((s) => s.statement)).toEqual([0, 0, 1, 1]);
  });

  it("rebases spans onto the block, not onto the statement", () => {
    const script = "SELECT a FROM t;\nSELECT b FROM u;";
    for (const step of stepsOfScript(script)) {
      expect(script.slice(step.start, step.end).trim()).toBe(step.text);
    }
  });
});

describe("roleOf and stepText", () => {
  it("names when WHERE runs, which is what a reader gets wrong", () => {
    expect(roleOf("WHERE")).toContain("before any grouping");
    expect(roleOf("SELECT")).toContain("after the filters");
  });

  it("leads with the role, because that is the part not on screen", () => {
    const step = stepsOf("SELECT a FROM t")[0];
    expect(stepText(step)).toBe("the row source. FROM t");
  });

  it("names the CTE a step belongs to", () => {
    const step = stepsOf(FEASIBILITY).find((s) => s.cte === "RankedGFR" && s.keyword === "FROM")!;
    expect(stepText(step)).toBe("RankedGFR: the row source. FROM lab_results");
  });

  it("says nothing extra for a fragment with no role", () => {
    const step = stepsOf("USE Practice; SELECT 1")[0];
    expect(stepText(step)).toBe("USE Practice;");
  });
});

describe("sqlSpeechFor", () => {
  it.each([
    ["p.PATIENT_ID", "p PATIENT ID"],
    ["a.rn", "a rn"],
    ["=", "equals"],
    [">=", "greater than or equal to"],
    ["<>", "not equal to"],
    ["7.5", "7.5"],
    ["'4548-4'", "4548-4"],
    ["TRY_CAST(RESULT_VALUE", "TRY CAST RESULT VALUE"],
    ["DECIMAL(10,2))", "DECIMAL 10,2"],
    ["--", ""],
    ["/*", ""],
    ["ROW_NUMBER()", "ROW NUMBER"],
  ])("says %s as %s", (token, expected) => {
    expect(sqlSpeechFor(token)).toBe(expected);
  });

  it("keeps a trailing comma, which is the pause a column list needs", () => {
    expect(sqlSpeechFor("PATIENT_ID,")).toBe("PATIENT ID,");
  });

  it("does not weld a function onto its argument", () => {
    // Deleting parens rather than spacing them produced "try castresult value".
    expect(sqlSpeechFor("COUNT(*)")).not.toContain("COUNTstar");
  });

  it("does not split a decimal or a hyphenated code", () => {
    expect(sqlSpeechFor("0.20")).toBe("0.20");
    expect(sqlSpeechFor("33914-3")).toBe("33914-3");
  });
});

describe("sqlToMarkdown", () => {
  const script = `/* =============================================================
   DRILL SET 02 — Window Functions
   Dataset: CDA-001 extract
   ============================================================= */

USE Practice;
GO

/* -------------------------------------------------------------
   D2.1  ROW_NUMBER vs RANK
   -------------------------------------------------------------
   164 patient-days have more than one result on the same date.
   ------------------------------------------------------------- */

SELECT PATIENT_ID  -- keep this note with the query
FROM lab_results;`;

  const md = sqlToMarkdown(script);

  it("makes an = ruled comment a level-one heading", () => {
    expect(md).toContain("# DRILL SET 02 — Window Functions");
  });

  it("makes a - ruled comment a level-two heading", () => {
    // Headings are what arm the intercepts, so this is the difference between
    // a drill set that can be enforced and one that is only read.
    expect(md).toContain("## D2.1  ROW_NUMBER vs RANK");
  });

  it("keeps the rest of a comment as prose", () => {
    expect(md).toContain("164 patient-days have more than one result");
  });

  it("drops the rule lines themselves", () => {
    expect(md).not.toContain("=====");
    expect(md).not.toContain("-----");
  });

  it("fences the SQL", () => {
    expect(md).toContain("```sql");
    expect(md).toContain("SELECT PATIENT_ID");
  });

  it("leaves a line comment inside the query it explains", () => {
    // `-- NOTE: no threshold here` explains why a filter is *absent* from the
    // clause it sits in. Moving it out destroys the only reason it exists.
    const fence = /```sql\n([\s\S]*?)\n```/g;
    const bodies = [...md.matchAll(fence)].map((m) => m[1]);
    expect(bodies.some((b) => b.includes("-- keep this note with the query"))).toBe(true);
  });

  it("emits no empty fence for a comment-only file", () => {
    expect(sqlToMarkdown("/* just a note */")).not.toContain("```");
  });

  it("treats a comment that is not at the start of a line as part of the query", () => {
    const inline = sqlToMarkdown("SELECT 1 /* inline */ FROM t;");
    expect(inline).toContain("```sql");
    expect(inline).toContain("/* inline */");
  });
});
