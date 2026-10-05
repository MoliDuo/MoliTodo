import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi } from "../test-support/fake-api";
import { renderApp, seedSession, synced, TODAY } from "../test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LONG = "很长很长的任务名字";

/**
 * TODAY is Sunday 2026-10-04, so "this week" is 9-28 to 10-04. In it: 阅读 2h, 单词 30min, LONG 10min,
 * 跑步 1min (too thin for a label). 小作文 is the week before.
 */
function seedWeek() {
  const api = createFakeApi();
  seedSession(api, "阅读", TODAY, 7200);
  seedSession(api, "单词", "2026-10-03", 1800);
  seedSession(api, LONG, "2026-10-01", 600);
  const run = seedSession(api, "跑步", "2026-09-28", 60);
  seedSession(api, "小作文", "2026-09-20", 1200);
  return { api, run };
}

const card = (title: RegExp) => screen.getByText(title).closest("section") as HTMLElement;
const pieCard = () => card(/^专注时长分布/);
const rangeLabel = () =>
  (screen.getByText(/^专注时长分布/).querySelector("span") as HTMLElement).textContent;
const legend = () =>
  within(pieCard())
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
const total = () => (within(pieCard()).getByText(/^总计/).textContent ?? "").replace(/\s+/g, " ");

describe("StatsPage totals", () => {
  it("shows the total and the daily average since the first session", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    // 3h1min over the 15 days from 9-20 to 10-04: 12 minutes a day.
    expect(card(/^累计专注$/).textContent).toBe("累计专注时长3小时1分钟日均时长12分钟");
  });

  it("shows zero with no sessions", async () => {
    await renderApp({ hash: "#/timer/stats" });
    expect(card(/^累计专注$/).textContent).toBe("累计专注时长0分钟日均时长0分钟");
    expect(within(pieCard()).getByText("这段时间没有专注记录")).toBeTruthy();
    expect(legend()).toEqual([]);
  });
});

describe("StatsPage distribution", () => {
  it("shows this week as a pie with labels and a legend in percent", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    expect(rangeLabel()).toBe("9月28日 – 10月4日");
    expect(screen.getByRole("tab", { name: "周" }).getAttribute("aria-selected")).toBe("true");
    const pie = within(pieCard()).getByRole("img", { name: "专注时长分布" });
    expect(pie.querySelectorAll("path")).toHaveLength(4);
    // The long name is cut short on the pie; 跑步 is too small a slice to label.
    expect(within(pie).getByText("很长很长的任…")).toBeTruthy();
    expect(within(pie).queryByText("跑步")).toBeNull();
    expect(within(pie).getByText("2小时")).toBeTruthy();
    expect(legend()).toEqual([
      "阅读2小时74.5%",
      "单词30分钟18.6%",
      `${LONG}10分钟6.2%`,
      "跑步1分钟0.6%",
    ]);
    expect(total()).toBe("总计 2小时41分");
  });

  it("steps through weeks: none, then a single slice", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    expect(rangeLabel()).toBe("9月21日 – 9月27日");
    expect(within(pieCard()).getByText("这段时间没有专注记录")).toBeTruthy();
    expect(within(pieCard()).queryByRole("img")).toBeNull();
    expect(legend()).toEqual([]);
    expect(total()).toBe("总计 0分钟");

    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    expect(rangeLabel()).toBe("9月14日 – 9月20日");
    const pie = within(pieCard()).getByRole("img", { name: "专注时长分布" });
    expect(pie.querySelectorAll("path")).toHaveLength(1);
    expect(within(pie).getByText("小作文")).toBeTruthy();
    expect(legend()).toEqual(["小作文20分钟100.0%"]);

    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    expect(rangeLabel()).toBe("9月28日 – 10月4日");
  });

  it("switches to a day and steps through days", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("tab", { name: "日" }));
    expect(rangeLabel()).toBe("10月4日 周日");
    expect(legend()).toEqual(["阅读2小时100.0%"]);
    fireEvent.click(screen.getByRole("button", { name: "上一日" }));
    expect(rangeLabel()).toBe("10月3日 周六");
    expect(legend()).toEqual(["单词30分钟100.0%"]);
    fireEvent.click(screen.getByRole("button", { name: "下一日" }));
    fireEvent.click(screen.getByRole("button", { name: "下一日" }));
    expect(rangeLabel()).toBe("10月5日 周一");
    expect(legend()).toEqual([]);
  });

  it("switches to a month and steps through months", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("tab", { name: "月" }));
    expect(rangeLabel()).toBe("2026年10月");
    expect(legend().map((item) => item?.replace(/\d.*$/, ""))).toEqual([
      "阅读",
      "单词",
      "很长很长的任务名字",
    ]);
    const stepper = within(pieCard());
    fireEvent.click(stepper.getByRole("button", { name: "上一月" }));
    expect(rangeLabel()).toBe("2026年9月");
    expect(legend()).toEqual(["小作文20分钟95.2%", "跑步1分钟4.8%"]);
    fireEvent.click(stepper.getByRole("button", { name: "下一月" }));
    expect(rangeLabel()).toBe("2026年10月");
  });

  it("uses a custom range from the two date boxes", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("tab", { name: "日" }));
    fireEvent.click(screen.getByRole("tab", { name: "自定义" }));
    // A custom range starts as this week and has no stepper.
    expect(within(pieCard()).queryByRole("button", { name: /^上一/ })).toBeNull();
    const start = screen.getByLabelText("开始日期") as HTMLInputElement;
    const end = screen.getByLabelText("结束日期") as HTMLInputElement;
    expect([start.value, end.value]).toEqual(["2026-09-28", "2026-10-04"]);
    expect(start.max).toBe("2026-10-04");
    expect(end.min).toBe("2026-09-28");

    fireEvent.change(start, { target: { value: "2026-09-01" } });
    expect(rangeLabel()).toBe("9月1日 – 10月4日");
    expect(legend()).toHaveLength(5);

    fireEvent.change(end, { target: { value: "2026-09-30" } });
    expect(rangeLabel()).toBe("9月1日 – 9月30日");
    expect(legend()).toEqual(["小作文20分钟95.2%", "跑步1分钟4.8%"]);

    // Clearing a box keeps the range it had.
    fireEvent.change(start, { target: { value: "" } });
    fireEvent.change(end, { target: { value: "" } });
    expect(rangeLabel()).toBe("9月1日 – 9月30日");

    fireEvent.click(screen.getByRole("tab", { name: "周" }));
    expect(rangeLabel()).toBe("9月28日 – 10月4日");
    expect(screen.queryByLabelText("开始日期")).toBeNull();
  });
});

describe("StatsPage records", () => {
  it("lists the range's sessions and deletes one after asking", async () => {
    const { api, run } = seedWeek();
    const { store } = await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("button", { name: "查看专注记录" }));
    const dialog = screen.getByRole("dialog", { name: "专注记录" });
    const rows = () =>
      within(dialog)
        .queryAllByRole("listitem")
        .map((item) => item.textContent);
    expect(rows()).toEqual([
      "阅读10月4日 周日 10:00–12:002小时",
      "单词10月3日 周六 11:30–12:0030分钟",
      `${LONG}10月1日 周四 11:50–12:0010分钟`,
      "跑步9月28日 周一 11:59–12:001分钟",
    ]);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 跑步" }));
    expect(confirm).toHaveBeenCalledWith("删除这条「跑步」的记录？");
    expect(rows()).toHaveLength(4);

    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 跑步" }));
    expect(rows()).toHaveLength(3);
    expect(legend()).toHaveLength(3);
    await synced(store);
    expect(api.data("session", run)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes in a session by hand and changes one", async () => {
    const { api } = seedWeek();
    const { store } = await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("tab", { name: "周" }));
    fireEvent.click(screen.getByRole("button", { name: "查看专注记录" }));
    fireEvent.click(screen.getByRole("button", { name: "添加记录" }));
    const form = screen.getByRole("dialog", { name: "添加记录" });
    expect(screen.queryByRole("dialog", { name: "专注记录" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("名称"), { target: { value: "听力" } });
    expect((within(form).getByLabelText("日期") as HTMLInputElement).value).toBe(TODAY);
    fireEvent.change(within(form).getByLabelText("开始时间"), { target: { value: "08:00" } });
    fireEvent.change(within(form).getByLabelText("用时"), { target: { value: "两小时" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));
    expect(within(form).getByText(/用时写成/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("用时"), { target: { value: "0" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));
    expect(within(form).getByText(/用时写成/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("用时"), { target: { value: "1h20min" } });
    fireEvent.change(within(form).getByLabelText("日期"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));
    expect(within(form).getByText("日期或开始时间不对")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("日期"), { target: { value: TODAY } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    const dialog = screen.getByRole("dialog", { name: "专注记录" });
    // Newest first: after 阅读 at 10:00.
    expect(within(dialog).getAllByRole("listitem")[1]?.textContent).toBe(
      "听力10月4日 周日 08:00–09:201小时20分"
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "修改 单词" }));
    const edit = screen.getByRole("dialog", { name: "修改记录" });
    expect((within(edit).getByLabelText("名称") as HTMLInputElement).value).toBe("单词");
    expect((within(edit).getByLabelText("用时") as HTMLInputElement).value).toBe("30min");
    fireEvent.change(within(edit).getByLabelText("名称"), { target: { value: "背单词" } });
    fireEvent.change(within(edit).getByLabelText("用时"), { target: { value: "45" } });
    fireEvent.click(within(edit).getByRole("button", { name: "保存" }));
    expect(
      within(screen.getByRole("dialog", { name: "专注记录" })).getByText("背单词")
    ).toBeTruthy();
    expect(legend().some((item) => item?.startsWith("背单词"))).toBe(true);

    // Cancel leaves it as it was.
    fireEvent.click(screen.getByRole("button", { name: "修改 背单词" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("dialog", { name: "专注记录" })).toBeTruthy();

    await synced(store);
    const sessions = [...api.rows.values()]
      .filter((r) => r.kind === "session" && !r.deleted)
      .map((r) => r.data as { name: string; seconds: number });
    expect(sessions).toContainEqual(expect.objectContaining({ name: "听力", seconds: 4800 }));
    expect(sessions).toContainEqual(expect.objectContaining({ name: "背单词", seconds: 2700 }));
  });

  it("says when the range has no records, with the year for another year", async () => {
    const api = createFakeApi();
    seedSession(api, "旧事", "2025-12-31", 900);
    await renderApp({ api, hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("button", { name: "查看专注记录" }));
    const dialog = screen.getByRole("dialog", { name: "专注记录" });
    expect(within(dialog).getByText("这段时间没有记录")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("tab", { name: "自定义" }));
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2025-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "查看专注记录" }));
    expect(screen.getByRole("dialog", { name: "专注记录" }).textContent).toContain(
      "2025年12月31日 周三"
    );
  });
});

describe("StatsPage charts", () => {
  it("draws the month in minutes and steps across the year end", async () => {
    const { api } = seedWeek();
    await renderApp({ api, hash: "#/timer/stats" });
    const month = within(card(/^月度专注统计/));
    expect(month.getByText("2026年10月")).toBeTruthy();
    const chart = month.getByRole("img", { name: "专注时长曲线" });
    // 2 hours on 10-4: the axis goes up in half hours.
    expect([...chart.querySelectorAll("text")].map((t) => t.textContent).slice(0, 5)).toEqual([
      "0分",
      "30分",
      "1h",
      "90分",
      "2h",
    ]);
    expect(within(chart).getByText("2小时")).toBeTruthy();
    expect(within(chart).getByText("10-1")).toBeTruthy();
    expect(within(chart).getByText("10-6")).toBeTruthy();
    expect(within(chart).queryByText("10-2")).toBeNull();

    fireEvent.click(month.getByRole("button", { name: "上一月" }));
    expect(month.getByText("2026年09月")).toBeTruthy();
    // 20 minutes on 9-20 is labelled; 1 minute on 9-28 is too low next to it on a 30-day chart.
    const september = month.getByRole("img", { name: "专注时长曲线" });
    expect(within(september).getByText("20分钟")).toBeTruthy();
    expect(within(september).queryByText("1分钟")).toBeNull();
    expect(september.querySelectorAll("circle")).toHaveLength(2);

    fireEvent.click(month.getByRole("button", { name: "下一月" }));
    fireEvent.click(month.getByRole("button", { name: "下一月" }));
    fireEvent.click(month.getByRole("button", { name: "下一月" }));
    fireEvent.click(month.getByRole("button", { name: "下一月" }));
    expect(month.getByText("2027年01月")).toBeTruthy();
    expect(month.getByRole("img").querySelectorAll("circle")).toHaveLength(0);
  });

  it("draws the year by month and steps through years", async () => {
    const { api } = seedWeek();
    seedSession(api, "旧事", "2025-12-31", 900);
    await renderApp({ api, hash: "#/timer/stats" });
    const year = within(card(/^年度专注统计/));
    expect(year.getByText("2026年")).toBeTruthy();
    const chart = year.getByRole("img", { name: "专注时长曲线" });
    expect(within(chart).getByText("1月")).toBeTruthy();
    expect(within(chart).getByText("12月")).toBeTruthy();
    // September 21 minutes, October 2h40min: both written, since a year has only 12 points.
    expect(within(chart).getByText("21分钟")).toBeTruthy();
    expect(within(chart).getByText("2小时40分")).toBeTruthy();

    fireEvent.click(year.getByRole("button", { name: "上一年" }));
    expect(year.getByText("2025年")).toBeTruthy();
    expect(within(year.getByRole("img")).getByText("15分钟")).toBeTruthy();
    fireEvent.click(year.getByRole("button", { name: "下一年" }));
    expect(year.getByText("2026年")).toBeTruthy();
  });
});

describe("StatsPage header", () => {
  it("goes back to the timer", async () => {
    await renderApp({ hash: "#/timer/stats" });
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(window.location.hash).toBe("#/timer");
    expect(await screen.findByRole("timer", { name: "已计时" })).toBeTruthy();
  });
});
