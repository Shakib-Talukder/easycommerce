/** Social links and SEO limits (no dependencies, safe for client components). */

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "youtube", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Hosts each platform's links may use (exact host, or a subdomain of it such as www./m.). */
export const SOCIAL_HOSTS: Record<SocialPlatform, readonly string[]> = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
};

export const SOCIAL_ERROR: Record<SocialPlatform, string> = {
  facebook: "FACEBOOK_URL",
  instagram: "INSTAGRAM_URL",
  youtube: "YOUTUBE_URL",
  tiktok: "TIKTOK_URL",
};

/** True for an https URL on one of the platform's hosts, with a page path (not just the home page). */
export function isPlatformUrl(platform: SocialPlatform, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (url.port === "" || url.port === "443") &&
    SOCIAL_HOSTS[platform].some((h) => host === h || host.endsWith(`.${h}`)) &&
    url.pathname.replace(/\/+$/, "").length > 0 &&
    value.length <= 300
  );
}

export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;
