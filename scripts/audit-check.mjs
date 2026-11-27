/**
 * 相依套件的資安稽核守門。
 *
 * audit 的問題是它永遠有東西，而且多半是建置鏈裡上游還沒修的傳遞相依。
 * 跑久了就會變成「反正都有，先不管」，然後真的出現一個 critical 的時候
 * 也被當成雜訊跳過。
 *
 * 所以這支腳本只問兩件事：
 *
 *   1. 有沒有 critical？有就不給過，不接受例外
 *   2. 有沒有**沒被登記過**的 high？有就不給過
 *
 * 已經判斷過、決定接受的列在 ACCEPTED，每一條要寫原因與判斷日期。
 * 新的東西一定會浮出來，舊的不會每天吵。
 *
 *   npm run audit:check
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repo = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 已經看過、決定接受的項目：套件名對應一句「為什麼可以接受」。
 *
 * 刻意留空。這個專案的 high 還沒有人逐條判斷過，預先填上「大概是建置鏈
 * 的吧」就是這支腳本存在要防的那件事。第一次跑會把每一條連同它的相依
 * 路徑印出來，判斷完一條就往這裡加一條，寫清楚原因與日期。
 */
const ACCEPTED = {
  // 範例（判斷完才留下，不要照抄）：
  // braces: "build chain only, no upstream fix（2026-11-27 判斷）",
};

const manager = () => {
  if (existsSync(join(repo, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repo, "yarn.lock"))) return "yarn";
  return "npm";
};

/** 兩種形狀正規化成同一種：{ name, severity, title, where, fix } */
const normalise = (audit) => {
  const out = [];
  // pnpm：以 advisory id 為鍵，套件名在 module_name，相依路徑在 findings[].paths
  for (const a of Object.values(audit.advisories ?? {})) {
    const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []);
    out.push({
      name: a.module_name ?? "(unknown)",
      severity: a.severity ?? "unknown",
      title: a.title ?? "",
      where: paths[0] ?? "",
      fix: a.patched_versions ?? "",
    });
  }
  // npm：以套件名為鍵，來源在 via，有沒有修正版在 fixAvailable
  for (const [name, v] of Object.entries(audit.vulnerabilities ?? {})) {
    if (!v || typeof v !== "object") continue;
    const via = (v.via ?? []).map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
    out.push({
      name,
      severity: v.severity ?? "unknown",
      title: typeof v.via?.[0] === "object" ? (v.via[0].title ?? "") : "",
      where: via.length ? `via ${via.join(", ")}` : "（直接相依）",
      fix:
        v.fixAvailable === true
          ? "有修正版"
          : v.fixAvailable && typeof v.fixAvailable === "object"
            ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? "（跨大版本）" : ""}`
            : "沒有修正版",
    });
  }
  return out;
};

/** 同一個套件可能從好幾條相依路徑進來，audit 的 metadata 把每條各算一筆。
 *  這裡以套件為單位收斂，所以「總計」的數字會比列出來的套件數多，那是對的。 */
const byPackage = (rows) => {
  const m = new Map();
  for (const r of rows) if (!m.has(r.name)) m.set(r.name, r);
  return [...m.values()];
};

const show = (rows) => {
  for (const r of rows) {
    console.error(`    ${r.name}`);
    if (r.title) console.error(`      ${r.title.slice(0, 90)}`);
    if (r.where) console.error(`      來源：${r.where}`);
    if (r.fix) console.error(`      修正：${r.fix}`);
  }
};

const main = async () => {
  const mgr = manager();
  let raw = "";
  try {
    const { stdout } = await run(mgr, ["audit", "--json"], {
      cwd: repo,
      maxBuffer: 64 * 1024 * 1024,
    });
    raw = stdout;
  } catch (error) {
    // 有漏洞時 audit 以非 0 結束，但 stdout 還是完整的 JSON。
    raw = error?.stdout ?? "";
    if (!raw) {
      console.error(`\n無法執行 ${mgr} audit：${error?.message ?? "（沒有訊息）"}\n`);
      process.exit(1);
    }
  }

  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    console.error(`\n${mgr} audit 的輸出不是合法 JSON，不當成通過。`);
    console.error(`原始輸出開頭：${raw.slice(0, 300)}\n`);
    process.exit(1);
  }

  /**
   * 壞掉的稽核不准算通過。
   *
   * 這一段不是多餘的防禦，它真的發生過（華竹，2026-11-27）：換成 pnpm、
   * 刪掉 package-lock.json 之後，`npm audit --json` 回 ENOLOCK，但它**仍然在
   * stdout 印出合法 JSON**（`{"error":{…}}`）。上面的 catch 看到 stdout 非空
   * 就不會 exit，JSON.parse 成功，metadata 是 undefined 於是當成 {}，最後印出
   * 「沒有 critical」並 exit 0。整道閘門失效、而且回報綠燈。
   *
   * 所以不能只修資料來源，要讓「稽核自己壞掉」這件事變成紅燈。
   */
  if (audit.error !== undefined || audit.metadata?.vulnerabilities === undefined) {
    console.error(
      "\n稽核沒有產出可用的結果（缺少 metadata.vulnerabilities）。" +
        "這不是「沒有漏洞」，是這道檢查本身壞了，不當成通過。\n" +
        `原始輸出開頭：${raw.slice(0, 300)}\n`,
    );
    process.exit(1);
  }

  const counts = audit.metadata.vulnerabilities;
  const all = normalise(audit);
  const criticals = byPackage(all.filter((r) => r.severity === "critical"));
  const unlisted = byPackage(all.filter((r) => r.severity === "high" && !(r.name in ACCEPTED)));

  console.log(`\n相依套件稽核（${mgr} audit）`);
  console.log("────────────────────────────────────────────────────────");
  console.log(
    `  總計：critical ${counts.critical ?? 0}、high ${counts.high ?? 0}、` +
      `moderate ${counts.moderate ?? 0}、low ${counts.low ?? 0}` +
      "（以筆數計，同一套件走好幾條相依路徑會算好幾筆）",
  );
  console.log(`  已登記接受：${Object.keys(ACCEPTED).length} 項\n`);

  if (criticals.length) {
    console.error(`✗ 有 ${criticals.length} 個 critical 套件：`);
    show(criticals);
    console.error("\n  critical 不接受例外，先升級或換掉。\n");
  }
  if (unlisted.length) {
    console.error(`✗ 有 ${unlisted.length} 個沒登記過的 high 套件：`);
    show(unlisted);
    console.error(
      "\n  先判斷能不能升級。真的要接受，把它加進 scripts/audit-check.mjs\n" +
        "  的 ACCEPTED 並寫清楚原因與日期：那張表是給下一個人看的。\n",
    );
  }
  if (criticals.length || unlisted.length) process.exit(1);
  console.log("沒有 critical，也沒有未登記的 high。\n");
};

main().catch((e) => {
  console.error(`\n稽核腳本本身出錯：${e?.message ?? e}\n`);
  process.exit(1);
});
