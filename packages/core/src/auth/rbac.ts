import type { Role } from "./jwt";

export type Permission =
  | "settings:manage"
  | "staff:manage"
  | "dashboard:view"
  /** Create/edit/soft-delete categories and products (OWNER and STAFF). */
  | "catalog:manage"
  /** Permanently delete from the trash (OWNER only). */
  | "catalog:delete";

/** OWNER can do everything; STAFF everything except these. */
const OWNER_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  "settings:manage",
  "staff:manage",
  "catalog:delete",
]);

export function can(role: Role, permission: Permission): boolean {
  if (role === "OWNER") return true;
  return !OWNER_ONLY.has(permission);
}
