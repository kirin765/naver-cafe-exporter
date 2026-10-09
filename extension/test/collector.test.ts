import { describe, expect, it } from "vitest";
import { paginate } from "../src/lib/collector";
import { CollectError, type PageResult } from "../src/lib/types";

const noSleep = async (): Promise<void> => {};
const zero = (): number => 0;

function page(items: number[], nextCursor: string | null, total: number | null = null): PageResult<number> {
  return { items, nextCursor, hasNext: nextCursor != null, total };
}

describe("paginate", () => {
  it("collects every page until the cursor ends", async () => {
    const pages: Record<string, PageResult<number>> = {
      root: page([1, 2, 3], "p2", 6),
      p2: page([4, 5, 6], null, 6)
    };
    const out = await paginate(
      async (cursor) => pages[cursor ?? "root"],
      { maxItems: 100, delayMs: zero, sleep: noSleep }
    );
    expect(out).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("stops at maxItems", async () => {
    const out = await paginate(
      async (cursor) => (cursor == null ? page([1, 2, 3], "p2") : page([4, 5, 6], null)),
      { maxItems: 4, delayMs: zero, sleep: noSleep }
    );
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it("retries transient network errors", async () => {
    let attempts = 0;
    const out = await paginate(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new CollectError("NETWORK", "boom");
        return page([1], null);
      },
      { maxItems: 10, delayMs: zero, sleep: noSleep }
    );
    expect(out).toEqual([1]);
    expect(attempts).toBe(3);
  });

  it("propagates terminal errors immediately", async () => {
    await expect(
      paginate(
        async () => {
          throw new CollectError("ACCESS", "no access");
        },
        { maxItems: 10, delayMs: zero, sleep: noSleep }
      )
    ).rejects.toMatchObject({ code: "ACCESS" });
  });

  it("does not loop forever on a repeated cursor", async () => {
    let calls = 0;
    const out = await paginate(
      async () => {
        calls += 1;
        return page([calls], "same");
      },
      { maxItems: 100, delayMs: zero, sleep: noSleep }
    );
    expect(calls).toBeLessThan(5);
    expect(out.length).toBeGreaterThan(0);
  });

  it("honors cancellation", async () => {
    let cancelled = false;
    const out = await paginate(
      async () => {
        cancelled = true;
        return page([1], "p2");
      },
      { maxItems: 100, delayMs: zero, sleep: noSleep, shouldCancel: () => cancelled }
    );
    expect(out).toEqual([1]);
  });
});
