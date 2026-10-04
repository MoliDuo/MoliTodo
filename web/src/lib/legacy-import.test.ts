import { describe, expect, it } from "vitest";
import { legacyTaskId, parseLegacyStore, planLegacyImport } from "./legacy-import";

const old = [
  { id: 1, text: "买咖啡豆", done: true, doneAt: 1_700_000_000_000, archived: true, duration: 45 },
  { id: "abc", text: " 写周报 ", done: false },
  { id: 3, text: "无完成时间", done: true },
  { id: 4, text: "   " },
  { id: 5, text: "超长", done: true, doneAt: -5, duration: 99999.7, archived: "yes" },
  { id: 6, text: "未完成不带归档", done: false, doneAt: 5, archived: true, duration: 10 },
  "junk",
  null,
];

const none = () => false;

describe("parseLegacyStore", () => {
  it("reads the old file and refuses anything else", () => {
    expect(parseLegacyStore(JSON.stringify({ tasks: [1, 2], collapsed: true }))).toEqual([1, 2]);
    expect(parseLegacyStore("not json")).toBeNull();
    expect(parseLegacyStore(JSON.stringify({ tasks: "x" }))).toBeNull();
    expect(parseLegacyStore("null")).toBeNull();
    expect(parseLegacyStore("[]")).toBeNull();
  });
});

describe("legacyTaskId", () => {
  it("is the same every time, differs per task, and is a valid id", async () => {
    const a = await legacyTaskId("1");
    expect(a).toBe(await legacyTaskId("1"));
    expect(a).not.toBe(await legacyTaskId("2"));
    expect(a).toMatch(/^legacy-[0-9a-f]{32}$/);
  });
});

describe("planLegacyImport", () => {
  it("turns old tasks into new ones in order, cleaning the values", async () => {
    const plan = await planLegacyImport(old, none, null);
    expect(plan.skipped).toBe(0);
    expect(plan.invalid).toBe(3);
    const [a, b, c, d, e] = plan.items.map((i) => i.content);
    expect(a).toMatchObject({
      text: "买咖啡豆",
      done: true,
      doneAt: 1_700_000_000_000,
      archived: true,
      duration: 45,
    });
    expect(b).toMatchObject({ text: "写周报", done: false, doneAt: null, archived: false });
    expect(c).toMatchObject({ done: true, doneAt: null });
    expect(d).toMatchObject({ doneAt: null, duration: 6000, archived: false });
    expect(e).toMatchObject({ done: false, doneAt: null, archived: false, duration: 10 });
    const positions = plan.items.map((i) => i.content.position);
    expect(positions).toEqual([...positions].sort());
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("puts imported tasks after the existing list", async () => {
    const plan = await planLegacyImport(old, none, "m");
    expect(plan.items.every((i) => i.content.position > "m")).toBe(true);
  });

  it("skips tasks whose id is already here, and only adds the new ones next time", async () => {
    const first = await planLegacyImport(old.slice(0, 2), none, null);
    const have = new Set(first.items.map((i) => i.id));
    const second = await planLegacyImport(old, (id) => have.has(id), "z");
    expect(second.skipped).toBe(2);
    expect(second.items).toHaveLength(3);
    const again = await planLegacyImport(
      old,
      (id) => have.has(id) || second.items.some((i) => i.id === id),
      "z"
    );
    expect(again.items).toHaveLength(0);
    expect(again.skipped).toBe(5);
  });

  it("gives tasks without a usable id, or with a repeated id, separate ids", async () => {
    const plan = await planLegacyImport(
      [{ text: "a" }, { text: "b" }, { id: 7, text: "c" }, { id: 7, text: "d" }],
      none,
      null
    );
    expect(new Set(plan.items.map((i) => i.id)).size).toBe(4);
    const again = await planLegacyImport(
      [{ text: "a" }, { text: "b" }, { id: 7, text: "c" }, { id: 7, text: "d" }],
      none,
      null
    );
    expect(again.items.map((i) => i.id)).toEqual(plan.items.map((i) => i.id));
  });

  it("cuts overlong text to the limit", async () => {
    const plan = await planLegacyImport([{ id: 1, text: "x".repeat(5000) }], none, null);
    expect(plan.items[0]?.content.text).toHaveLength(2000);
  });
});
