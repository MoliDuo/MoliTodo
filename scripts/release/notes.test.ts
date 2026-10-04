import { describe, expect, it } from "vitest";
import { buildNotes, type Commit } from "./notes.ts";

const c = (subject: string, body = ""): Commit => ({ subject, body });
const base = {
  version: "2.1.0",
  sha: "abc123",
  downloads: [["Windows", "MoliTodo_2.1.0_windows_x64.exe"]] as [string, string][],
};

describe("buildNotes", () => {
  it("groups user-visible commits and drops the rest", () => {
    const notes = buildNotes({
      ...base,
      commits: [
        c("feat(desktop): add a tray menu (#5)"),
        c("fix: keep the window on screen"),
        c("perf(sync): fewer requests"),
        c("refactor: split the store"),
        c("chore(release): v2.1.0"),
        c("docs: update the readme"),
        c("ci: add a job"),
        c("Bump vite from 1 to 2"),
      ],
    });
    expect(notes).toContain("## 更新内容");
    expect(notes).toContain("**✨ 新功能**\n\n- desktop：add a tray menu\n");
    expect(notes).toContain("- keep the window on screen");
    expect(notes).toContain("**⚡ 优化**\n\n- sync：fewer requests\n- split the store");
    expect(notes).not.toContain("readme");
    expect(notes).not.toContain("Bump");
    expect(notes).not.toContain("(#5)");
    expect(notes).not.toContain("不兼容");
  });

  it("puts breaking changes first with what to do", () => {
    const notes = buildNotes({
      ...base,
      commits: [
        c("feat!: new data format"),
        c("fix: small", "BREAKING CHANGE: sign in again after updating\n\nmore text"),
        c("feat: other"),
      ],
    });
    expect(notes.indexOf("不兼容的改动")).toBeLessThan(notes.indexOf("## 更新内容"));
    expect(notes).toContain("- new data format\n");
    expect(notes).toContain("- small：sign in again after updating");
    expect(notes).toContain("- other");
  });

  it("always has the required sections, even with nothing to say", () => {
    const notes = buildNotes({ ...base, commits: [c("docs: x")] });
    for (const heading of ["## 更新内容", "## 下载", "## 首次安装", "## 校验"])
      expect(notes).toContain(heading);
    expect(notes).toContain("没有用户能看到的变化");
    expect(notes).toContain("| Windows | `MoliTodo_2.1.0_windows_x64.exe` |");
    expect(notes).toContain("对应提交 abc123");
    expect(notes).toContain("SHA256SUMS");
    expect(notes).toContain("仍要运行");
    expect(notes).toContain("仍要打开");
  });
});
