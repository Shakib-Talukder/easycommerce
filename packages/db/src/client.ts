import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

type Role = "app" | "admin";

// Reuse clients across Next.js hot reloads instead of leaking pools.
const globalForPrisma = globalThis as unknown as { __prisma?: Partial<Record<Role, PrismaClient>> };
const clients = (globalForPrisma.__prisma ??= {});

export function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getClient(role: Role, connectionString: () => string): PrismaClient {
  return (clients[role] ??= createClient(connectionString()));
}

export async function disconnectAll(): Promise<void> {
  await Promise.all(Object.values(clients).map((c) => c?.$disconnect()));
  for (const key of Object.keys(clients) as Role[]) delete clients[key];
}
