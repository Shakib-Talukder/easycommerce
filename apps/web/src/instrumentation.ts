/**
 * Runs once when the Next.js server starts. Refuses to boot with a configuration
 * that would silently break OTP delivery in production (e.g. console SMS).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertSmsConfig } = await import("@repo/core/sms");
  assertSmsConfig();
}
