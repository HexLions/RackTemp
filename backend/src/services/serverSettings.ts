import { prisma } from "../db";

export async function getServerSettings() {
  return prisma.serverSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export async function setHttpsEnabled(httpsEnabled: boolean) {
  await getServerSettings(); // ensure the row exists
  return prisma.serverSettings.update({ where: { id: 1 }, data: { httpsEnabled } });
}
