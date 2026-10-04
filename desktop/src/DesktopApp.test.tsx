import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COLLAPSED_HEIGHT, DesktopApp } from "./DesktopApp";
import { createSession } from "./session";
import { createFakeWindow, createMemoryPlatform, createWorld } from "./test-support";

afterEach(cleanup);

const sleep = async () => undefined;

async function open(files: Parameters<typeof createMemoryPlatform>[1] = {}) {
  const world = createWorld();
  const platform = createMemoryPlatform(world, files);
  const session = await createSession({ platform, sleep });
  const win = createFakeWindow();
  render(
    <DesktopApp session={session} platform={platform} windowControl={win} version="2.0.0-test" />
  );
  return { world, platform, session, win };
}

const signedInFiles = {
  "settings.json": JSON.stringify({
    refreshToken: "saved",
    account: { username: "alice", name: "Alice" },
  }),
};

const login = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "登录" }));
  return screen.findByRole("dialog", { name: "登录" });
};

describe("first run, signed out", () => {
  it("works as a local list and says tasks stay on this computer", async () => {
    const { world } = await open();
    expect(screen.getByRole("status", { name: "登录提示" }).textContent).toContain("未登录");
    const input = screen.getByLabelText("添加任务");
    fireEvent.change(input, { target: { value: "离线任务" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("离线任务")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status", { name: "" })).toBeTruthy());
    expect(world.server.requests).toEqual([]);
  });

  it("signs in with a device code: shows the code, opens the browser, then syncs", async () => {
    const world = createWorld();
    const platform = createMemoryPlatform(world);
    let approve: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (approve = resolve));
    const session = await createSession({ platform, sleep: () => gate });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    fireEvent.change(screen.getByLabelText("添加任务"), { target: { value: "先写下来" } });
    fireEvent.keyDown(screen.getByLabelText("添加任务"), { key: "Enter" });
    const dialog = await login();
    expect((await within(dialog).findByLabelText("验证码")).textContent).toBe("WXYZ-9876");
    expect(platform.opened).toHaveLength(1);
    expect(platform.opened[0]).toContain("WXYZ-9876");
    approve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "登录" })).toBeNull());
    expect(session.tokens.signedIn).toBe(true);
    expect(screen.queryByRole("status", { name: "登录提示" })).toBeNull();
    await waitFor(() => expect(world.server.rows.size).toBe(1));
  });

  it("can reopen the sign-in page, and cancel", async () => {
    const world = createWorld();
    world.identity.pendingPolls = 1000;
    const platform = createMemoryPlatform(world);
    const session = await createSession({
      platform,
      // Slow polling, so the dialog stays on the code.
      sleep: () => new Promise(() => undefined),
    });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    const dialog = await login();
    await within(dialog).findByLabelText("验证码");
    fireEvent.click(within(dialog).getByText("重新打开登录页"));
    expect(platform.opened).toHaveLength(2);
    fireEvent.click(within(dialog).getByText("取消"));
    expect(screen.queryByRole("dialog", { name: "登录" })).toBeNull();
    expect(session.tokens.signedIn).toBe(false);
  });

  it("explains a refused sign-in and an expired code, and can try again", async () => {
    const world = createWorld();
    world.identity.outcome = "access_denied";
    const platform = createMemoryPlatform(world);
    const session = await createSession({ platform, sleep });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    const dialog = await login();
    expect((await within(dialog).findByRole("alert")).textContent).toBe("登录被拒绝了。");
    world.identity.polls = 0;
    world.identity.outcome = "expired_token";
    fireEvent.click(within(dialog).getByText("重试"));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("已过期"));
    world.identity.polls = 0;
    world.identity.outcome = "approve";
    fireEvent.click(within(dialog).getByText("重试"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "登录" })).toBeNull());
  });

  it("says so when the sign-in service cannot be reached", async () => {
    const world = createWorld();
    world.identity.down = true;
    const platform = createMemoryPlatform(world);
    const session = await createSession({ platform, sleep });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    const dialog = await login();
    expect((await within(dialog).findByRole("alert")).textContent).toContain("连不上登录服务");
  });
});

describe("signed in", () => {
  it("shows tasks from the server and the sync time, without a sign-in notice", async () => {
    const world = createWorld();
    world.server.remote("aaaaaaaa-1", {
      text: "来自服务器",
      done: false,
      doneAt: null,
      archived: false,
      duration: 0,
      position: "V",
      deleted: false,
    });
    const platform = createMemoryPlatform(world, signedInFiles);
    const session = await createSession({ platform, sleep });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    expect(await screen.findByText("来自服务器")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "登录提示" })).toBeNull();
    await waitFor(() => expect(screen.getByText(/已同步/)).toBeTruthy());
  });

  it("asks to sign in again when the server turns the token down, keeping the tasks", async () => {
    const world = createWorld();
    const platform = createMemoryPlatform(world, signedInFiles);
    const session = await createSession({ platform, sleep });
    world.server.fail = 401;
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    expect((await screen.findByRole("status", { name: "登录提示" })).textContent).toContain(
      "登录已失效"
    );
    const input = screen.getByLabelText("添加任务");
    fireEvent.change(input, { target: { value: "失效后写的" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("失效后写的")).toBeTruthy();
  });

  it("shows offline status and keeps the change", async () => {
    const world = createWorld();
    const platform = createMemoryPlatform(world, signedInFiles);
    const session = await createSession({ platform, sleep });
    world.server.fail = "network";
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    await waitFor(() => expect(screen.getByText(/离线/)).toBeTruthy());
  });
});

describe("window", () => {
  it("collapses to the title bar and expands again, remembering the choice", async () => {
    const { win, session } = await open();
    fireEvent.click(screen.getByLabelText("折叠"));
    expect(win.calls).toContain("collapsed:true:480");
    expect(screen.queryByLabelText("添加任务")).toBeNull();
    expect(session.settings().collapsed).toBe(true);
    fireEvent.click(screen.getByLabelText("展开"));
    expect(win.calls).toContain("collapsed:false:480");
    expect(screen.getByLabelText("添加任务")).toBeTruthy();
    expect(session.settings().collapsed).toBe(false);
    expect(COLLAPSED_HEIGHT).toBe(44);
  });

  it("starts collapsed when it was left collapsed", async () => {
    await open({ "settings.json": JSON.stringify({ collapsed: true }) });
    expect(screen.queryByLabelText("添加任务")).toBeNull();
    expect(screen.getByLabelText("展开")).toBeTruthy();
  });

  it("saves what it holds and then hides when the hide button is pressed", async () => {
    const { win, platform } = await open();
    fireEvent.change(screen.getByLabelText("添加任务"), { target: { value: "关窗前写的" } });
    fireEvent.keyDown(screen.getByLabelText("添加任务"), { key: "Enter" });
    fireEvent.click(screen.getByLabelText("隐藏"));
    await waitFor(() => expect(win.calls).toContain("hide"));
    expect(platform.files["state.json"]).toContain("关窗前写的");
  });

  it("has permanent-top and autostart switches in settings, and follows the tray", async () => {
    const { win, session } = await open();
    fireEvent.click(screen.getByLabelText("设置"));
    const top = (await screen.findByLabelText("窗口永久置顶")) as HTMLInputElement;
    const auto = (await screen.findByLabelText("开机自启")) as HTMLInputElement;
    expect(top.checked).toBe(true);
    expect(auto.checked).toBe(false);
    fireEvent.click(top);
    expect(win.calls).toContain("top:false");
    expect(session.settings().permanentTop).toBe(false);
    fireEvent.click(auto);
    await waitFor(() => expect(auto.checked).toBe(true));
    expect(win.calls).toContain("autostart:true");
    act(() => win.tray({ permanentTop: true, autostart: false }));
    await waitFor(() => expect(top.checked).toBe(true));
    expect(auto.checked).toBe(false);
    expect(session.settings().permanentTop).toBe(true);
    expect(screen.getByText("版本 2.0.0-test")).toBeTruthy();
  });

  it("puts the autostart switch back when the system refuses", async () => {
    const { win } = await open();
    win.setAutostart = async () => {
      throw new Error("denied");
    };
    fireEvent.click(screen.getByLabelText("设置"));
    const auto = (await screen.findByLabelText("开机自启")) as HTMLInputElement;
    fireEvent.click(auto);
    await waitFor(() => expect(auto.checked).toBe(false));
  });
});

describe("settings", () => {
  it("finds and imports the old app's tasks, and says so when there are none", async () => {
    const { platform } = await open();
    fireEvent.click(screen.getByLabelText("设置"));
    fireEvent.click(screen.getByText("自动查找并导入"));
    await screen.findByText("没有在这台电脑上找到旧版的任务文件。");
    platform.legacy = JSON.stringify({ tasks: [{ id: 1, text: "旧任务", done: false }] });
    fireEvent.click(screen.getByText("自动查找并导入"));
    await screen.findByText("导入 1 条，跳过 0 条（之前导入过）。");
    fireEvent.click(screen.getByText("自动查找并导入"));
    await screen.findByText("导入 0 条，跳过 1 条（之前导入过）。");
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.getByText("旧任务")).toBeTruthy();
  });

  it("reports a failure while looking for the old file", async () => {
    const { platform } = await open();
    platform.readLegacyStore = async () => {
      throw new Error("denied");
    };
    fireEvent.click(screen.getByLabelText("设置"));
    fireEvent.click(screen.getByText("自动查找并导入"));
    await screen.findByText("导入失败，请重试。");
  });

  it("offers sign-in when signed out", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("设置"));
    expect(
      screen.getByText("未登录：任务只保存在这台电脑上。", { selector: "p.text-muted" })
    ).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "设置" })).getByText("登录"));
    expect(await screen.findByRole("dialog", { name: "登录" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
  });

  it("signs out and keeps the tasks, after asking", async () => {
    const world = createWorld();
    world.server.remote("aaaaaaaa-1", {
      text: "保留我",
      done: false,
      doneAt: null,
      archived: false,
      duration: 0,
      position: "V",
      deleted: false,
    });
    const platform = createMemoryPlatform(world, signedInFiles);
    const session = await createSession({ platform, sleep });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    await screen.findByText("保留我");
    fireEvent.click(screen.getByLabelText("设置"));
    expect(screen.getByText("已登录：Alice")).toBeTruthy();
    fireEvent.click(screen.getByText("退出登录"));
    fireEvent.click(screen.getByText("取消", { selector: "button.text-muted" }));
    fireEvent.click(screen.getByText("退出登录"));
    fireEvent.click(screen.getByText("保留任务，只退出登录"));
    await waitFor(() => expect(session.tokens.signedIn).toBe(false));
    expect(
      screen.getByText("未登录：任务只保存在这台电脑上。", { selector: "p.text-muted" })
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.getByText("保留我")).toBeTruthy();
  });

  it("signs out and deletes the tasks on this computer when asked", async () => {
    const world = createWorld();
    world.server.remote("aaaaaaaa-1", {
      text: "删掉我",
      done: false,
      doneAt: null,
      archived: false,
      duration: 0,
      position: "V",
      deleted: false,
    });
    const platform = createMemoryPlatform(world, signedInFiles);
    const session = await createSession({ platform, sleep });
    render(<DesktopApp session={session} platform={platform} windowControl={createFakeWindow()} />);
    await screen.findByText("删掉我");
    fireEvent.click(screen.getByLabelText("设置"));
    fireEvent.click(screen.getByText("退出登录"));
    fireEvent.click(screen.getByText("退出并删除这台电脑上的任务"));
    await waitFor(() => expect(session.store.engine.all()).toEqual([]));
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(screen.queryByText("删掉我")).toBeNull();
  });
});
