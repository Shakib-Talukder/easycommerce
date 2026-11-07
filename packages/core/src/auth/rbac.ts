import type { Role } from "./jwt";

/** OWNER can do everything; STAFF everything except these. */
const OWNER_ONLY = new Set(["settings:manage", "staff:manage"] as const);

export type Permission = "settings:manage" | "staff:manage" | "dashboard:view";

export function can(role: Role, permission: Permission): boolean {
  if (role === "OWNER") return true;
  return !OWNER_ONLY.has(permission as "settings:manage" | "staff:manage");
}
