// Creates the platform owner account. Run once per environment:
//   OWNER_EMAIL=you@example.com OWNER_PASSWORD=... npm run seed -w apps/api
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const email = process.env.OWNER_EMAIL?.toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (8+ characters).');
  }
  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Platform owner', role: Role.OWNER, passwordHash },
    update: { passwordHash, role: Role.OWNER, active: true },
  });
  await prisma.$disconnect();
  console.log(`Owner account ready: ${email}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
