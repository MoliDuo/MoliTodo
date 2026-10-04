// Release notes from commit messages (standard 006, 6.7): Chinese headings, one fixed template.

export interface Commit {
  subject: string;
  body: string;
}

interface Parsed {
  type: string;
  scope: string | null;
  breaking: boolean;
  text: string;
  breakingNote: string | null;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

function parse(commit: Commit): Parsed | null {
  const match = CONVENTIONAL.exec(commit.subject);
  if (!match) return null;
  const note = /^BREAKING[ -]CHANGE: ([\s\S]+)$/m.exec(commit.body);
  return {
    type: match[1]!.toLowerCase(),
    scope: match[2] ?? null,
    breaking: match[3] === "!" || note !== null,
    // Squash-merged subjects end with "(#12)"; the number means nothing to a reader of the notes.
    text: match[4]!.replace(/\s*\(#\d+\)$/, ""),
    breakingNote: note?.[1]?.split("\n\n")[0]?.trim() ?? null,
  };
}

const SECTIONS: [string[], string][] = [
  [["feat"], "✨ 新功能"],
  [["fix"], "🐛 修复"],
  [["perf", "refactor"], "⚡ 优化"],
];

export const FIRST_INSTALL = [
  "- **Windows**：运行安装包。没有代码签名，系统弹出「Windows 已保护你的电脑」时，点「更多信息」，再点「仍要运行」。",
  "- **macOS（Apple 芯片）**：打开 `.dmg`，把 Moli Todo 拖进「应用程序」。没有公证，第一次打开被拦住时，到「系统设置 → 隐私与安全性」点「仍要打开」。",
].join("\n");

export function buildNotes(options: {
  commits: Commit[];
  version: string;
  sha: string;
  /** `[platform, asset name]` for the download table. */
  downloads: [string, string][];
}): string {
  const parsed = options.commits.map(parse).filter((p): p is Parsed => p !== null);
  const out: string[] = [];

  const breaking = parsed.filter((p) => p.breaking);
  if (breaking.length) {
    out.push("## ⚠️ 不兼容的改动", "");
    for (const p of breaking) out.push(`- ${p.text}${p.breakingNote ? `：${p.breakingNote}` : ""}`);
    out.push("");
  }

  out.push("## 更新内容", "");
  let any = false;
  for (const [types, heading] of SECTIONS) {
    const lines = parsed.filter((p) => types.includes(p.type) && !p.breaking);
    if (!lines.length) continue;
    any = true;
    out.push(`**${heading}**`, "");
    for (const p of lines) out.push(`- ${p.scope ? `${p.scope}：` : ""}${p.text}`);
    out.push("");
  }
  if (!any) out.push("这个版本没有用户能看到的变化（内部改进）。", "");

  out.push("## 下载", "", "| 平台 | 文件 |", "| --- | --- |");
  for (const [platform, file] of options.downloads) out.push(`| ${platform} | \`${file}\` |`);
  out.push("", "## 首次安装", "", FIRST_INSTALL, "");
  out.push(
    "## 校验",
    "",
    `对应提交 ${options.sha}；校验和见 \`SHA256SUMS\`（\`sha256sum -c SHA256SUMS\`）。`,
    ""
  );
  return out.join("\n");
}
