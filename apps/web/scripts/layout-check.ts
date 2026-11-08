/**
 * Automated layout check (mobile first), against a running `next build && next start`:
 *
 *   SERVER_LOG=/path/to/next-start.log pnpm --filter @repo/web test:layout
 *
 * Uses the installed Google Chrome (playwright-core, channel "chrome"). Logs in as
 * the seeded OWNER and STAFF of dhaka-fashion (OTP read from the server log, so
 * the server must run with the console SMS provider), walks every admin page,
 * the onboarding wizard (on a temporary PENDING store, deleted afterwards), the
 * login/verify and root signup pages and the storefront, at 360×740 and 1280×800.
 *
 * Fails when
 *   - the page scrolls horizontally (documentElement.scrollWidth > viewport width),
 *   - a visible button/link/input/select/textarea/summary is smaller than 44×44 px
 *     (the tap target is the element, or its enclosing <label> when that is ≥ 44×44),
 *   - at 360 px an input/select/textarea uses a font smaller than 16 px (iOS zoom).
 * Screenshots: docs/screenshots/day3/<page>-<width>.png
 *
 * Env: SERVER_LOG (required), LAYOUT_PORT (3000), ROOT_DOMAIN (localhost:3000),
 *      LAYOUT_STORE (dhaka-fashion), LAYOUT_ONLY (comma-separated page names).
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true });

const SERVER_LOG = process.env.SERVER_LOG;
if (!SERVER_LOG) throw new Error("Set SERVER_LOG to the `next start` log file (OTP codes are read from it).");
const PORT = Number(process.env.LAYOUT_PORT ?? 3000);
const ROOT = process.env.ROOT_DOMAIN ?? `localhost:${PORT}`;
const STORE = process.env.LAYOUT_STORE ?? "dhaka-fashion";
const ONLY = process.env.LAYOUT_ONLY?.split(",").filter(Boolean);
const OUT = path.join(repoRoot, "docs/screenshots/day3");
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
];
const OWNER_PHONE = "01711000001";
// Every request without a proxy shares the IP bucket "unknown" (10 OTP sends per hour). Give each run
// its own test address so repeated runs don't hit the limit; the per-phone limits still apply.
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const contextOptions = { extraHTTPHeaders: { "x-forwarded-for": RUN_IP } };
const STAFF_PHONE = "01711000005";

const { adminClient } = await import("@repo/db/admin");
const { disconnectAll } = await import("@repo/db");
const { createSession, SESSION_COOKIE } = await import("@repo/core");

const storeHost = (sub: string) => `${sub}.${ROOT}`;
const url = (host: string, p: string) => `http://${host}${p}`;

type Offence = { page: string; width: number; kind: string; detail: string };
const offences: Offence[] = [];
let checked = 0;

// ---------------------------------------------------------------------------

function otpAfter(offset: number, to: string): string | null {
  const log = readFileSync(SERVER_LOG!, "utf8").slice(offset);
  const line = log
    .split(/\r?\n/)
    .filter((l) => l.includes("[sms:console]") && l.includes(to))
    .pop();
  return line ? (/\b(\d{6})\b/.exec(line)?.[1] ?? null) : null;
}

async function waitForOtp(offset: number, to: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const code = otpAfter(offset, to);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No OTP for ${to} in ${SERVER_LOG}`);
}

const logSize = () => readFileSync(SERVER_LOG!, "utf8").length;

/** Real OTP login; screenshots the login and verify pages on the way (first call only). */
async function login(context: BrowserContext, phone: string, shoot: boolean): Promise<void> {
  const page = await context.newPage();
  const host = storeHost(STORE);
  await page.goto(url(host, "/admin/login"));
  if (shoot) await checkPage(page, "login", url(host, "/admin/login"));
  let offset = logSize();
  // A run shortly before may have started the 60 s resend cooldown: wait it out and retry.
  for (let attempt = 0; ; attempt++) {
    offset = logSize();
    await page.fill('input[name="identifier"]', phone);
    await page.click('form:has(input[name="identifier"]) button[type="submit"]');
    const outcome = await Promise.race([
      page.waitForURL(/\/admin\/verify/).then(
        () => "verify" as const,
        () => "timeout" as const,
      ),
      page.waitForSelector('[data-error-code="RESEND_COOLDOWN"]').then(
        () => "cooldown" as const,
        () => "timeout" as const,
      ),
    ]);
    if (outcome === "verify") break;
    if (outcome === "timeout") {
      const code = await page.getAttribute("[data-error-code]", "data-error-code").catch(() => null);
      throw new Error(`Login for ${phone} didn't reach the code page (${code ?? "no error shown"})`);
    }
    if (attempt >= 2) throw new Error(`Login for ${phone} is stuck in the resend cooldown`);
    console.log(`(resend cooldown for ${phone}: waiting 61 s)`);
    await page.waitForTimeout(61_000);
  }
  if (shoot) await checkPage(page, "verify", page.url());
  const code = await waitForOtp(offset, `+88${phone}`);
  await page.fill('input[name="code"]', code);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/verify")),
    page.click('form:has(input[name="code"]) button[type="submit"]'),
  ]);
  await page.close();
}

/** The in-page measurement (plain JS, see layout-in-page.js), wrapped per viewport. */
const IN_PAGE = readFileSync(path.join(import.meta.dirname, "layout-in-page.js"), "utf8");

/** Measures one page at every viewport (the page is reloaded per viewport). */
async function checkPage(page: Page, name: string, target: string): Promise<void> {
  if (ONLY && !ONLY.includes(name)) return;
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    const res = await page.goto(target, { waitUntil: "networkidle" });
    if (!res || res.status() >= 400) {
      offences.push({ page: name, width: vp.width, kind: "status", detail: String(res?.status()) });
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    const found = (await page.evaluate(`(() => { const mobile = ${vp.width < 768}; ${IN_PAGE} })()`)) as {
      kind: string;
      detail: string;
    }[];
    for (const f of found) offences.push({ page: name, width: vp.width, ...f });
    await page.screenshot({ path: path.join(OUT, `${name}-${vp.width}.png`), fullPage: true });
    checked++;
  }
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const browser: Browser = await chromium.launch({ channel: "chrome", headless: true });
const db = adminClient();
let tempStoreId: string | null = null;

try {
  const store = await db.store.findUniqueOrThrow({ where: { subdomain: STORE } });
  const product = await db.product.findFirst({
    where: { storeId: store.id, deletedAt: null, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  const category = await db.category.findFirst({
    where: { storeId: store.id, deletedAt: null, isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
  });
  const host = storeHost(STORE);

  // Root signup pages: the real phone → code → store-details flow (no store is created).
  {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await checkPage(page, "signup", url(ROOT, "/signup"));
    const phone = `0179${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    await page.goto(url(ROOT, "/signup"));
    const offset = logSize();
    await page.fill('input[name="phone"]', phone);
    await Promise.all([
      page.waitForURL(/\/signup\/verify/),
      page.click('form:has(input[name="phone"]) button[type="submit"]'),
    ]);
    await checkPage(page, "signup-verify", page.url());
    const code = await waitForOtp(offset, `+88${phone}`);
    await page.goto(url(ROOT, `/signup/verify?phone=${phone}`));
    await page.locator('input[name="digit"]').first().fill(code);
    await Promise.all([
      page.waitForURL(/\/signup\/store/),
      page.click('form:has(input[name="code"]) button[type="submit"]:not([disabled])'),
    ]);
    await checkPage(page, "signup-store", url(ROOT, "/signup/store"));
    await context.close();
  }

  // OWNER: every admin page.
  {
    const context = await browser.newContext(contextOptions);
    await login(context, OWNER_PHONE, true);
    const page = await context.newPage();
    const pages: [string, string][] = [
      ["dashboard", "/admin"],
      ["products", "/admin/products"],
      ["products-new", "/admin/products/new"],
      ...(product ? ([["product-edit", `/admin/products/${product.id}`]] as [string, string][]) : []),
      ["featured", "/admin/products/featured"],
      ["trash", "/admin/products/trash"],
      ["categories", "/admin/categories"],
      ["staff", "/admin/staff"],
      ["settings-identity", "/admin/settings?tab=identity"],
      ["settings-branding", "/admin/settings?tab=branding"],
      ["settings-payments", "/admin/settings?tab=payments"],
      ["settings-delivery", "/admin/settings?tab=delivery"],
      ["settings-social", "/admin/settings?tab=social"],
      ["more", "/admin/more"],
    ];
    for (const [name, p] of pages) await checkPage(page, name, url(host, p));
    await context.close();
  }

  // STAFF.
  {
    const context = await browser.newContext(contextOptions);
    await login(context, STAFF_PHONE, false);
    const page = await context.newPage();
    for (const [name, p] of [
      ["staff-dashboard", "/admin"],
      ["staff-products", "/admin/products"],
      ["staff-more", "/admin/more"],
    ] as const) {
      await checkPage(page, name, url(host, p));
    }
    await context.close();
  }

  // Onboarding wizard on a temporary PENDING store (all steps reachable, not launched).
  {
    const sub = `layout-${Date.now().toString(36)}`;
    const temp = await db.store.create({
      data: {
        nameBn: "লেআউট পরীক্ষা",
        nameEn: "Layout Check",
        subdomain: sub,
        status: "PENDING",
        settings: {
          create: {
            onboardingStep: 4,
            contactPhone: "+8801799000000",
            addressDivision: "dhaka",
            addressDistrict: "dhaka",
          },
        },
        users: { create: { name: "Layout", role: "OWNER", phone: "+8801799000000" } },
      },
      include: { users: true },
    });
    tempStoreId = temp.id;
    const session = await createSession(temp.id, temp.users[0]!);
    const context = await browser.newContext(contextOptions);
    await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: url(storeHost(sub), "/") }]);
    const page = await context.newPage();
    for (let step = 1; step <= 5; step++) {
      await checkPage(
        page,
        step === 5 ? "onboarding-review" : `onboarding-${step}`,
        url(storeHost(sub), `/admin/onboarding?step=${step}`),
      );
    }
    await context.close();
  }

  // Storefront.
  {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await checkPage(page, "store-home", url(host, "/"));
    if (category) await checkPage(page, "store-category", url(host, `/category/${category.slug}`));
    if (product) await checkPage(page, "store-product", url(host, `/products/${product.slug}`));
    await context.close();
  }
} finally {
  await browser.close();
  if (tempStoreId) await db.store.delete({ where: { id: tempStoreId } }).catch(() => {});
  await disconnectAll();
}

console.log(
  `layout check: ${checked} page renders checked at ${VIEWPORTS.map((v) => v.width).join(" and ")} px`,
);
console.log(`screenshots: ${path.relative(repoRoot, OUT)}`);
if (offences.length) {
  const byPage = new Map<string, Offence[]>();
  for (const o of offences)
    byPage.set(`${o.page} @${o.width}`, [...(byPage.get(`${o.page} @${o.width}`) ?? []), o]);
  for (const [k, list] of byPage) {
    console.log(`\n✗ ${k}`);
    for (const o of list.slice(0, 15)) console.log(`   ${o.kind}: ${o.detail}`);
    if (list.length > 15) console.log(`   … and ${list.length - 15} more`);
  }
  console.log(`\nFAILED: ${offences.length} offences`);
  process.exitCode = 1;
} else {
  console.log("PASSED: no horizontal scroll, every tap target ≥ 44×44, inputs ≥ 16 px on phones");
}
