function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Runtime tenant role (RLS enforced). */
export const appDatabaseUrl = () => required("APP_DATABASE_URL");
/** Platform admin role (BYPASSRLS). */
export const adminDatabaseUrl = () => required("ADMIN_DATABASE_URL");
