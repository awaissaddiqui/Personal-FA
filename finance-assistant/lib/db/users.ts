import { prisma } from "@/lib/db/prisma";

export async function ensureUser(id: string, email: string) {
  return prisma.user.upsert({
    where: { id },
    update: { email },
    create: { id, email },
  });
}
