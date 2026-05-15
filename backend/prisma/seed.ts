import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL ?? '';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: 'admin@inventory.local' },
  });

  if (existing) {
    console.log('Admin user already exists — skipping seed');
    return;
  }

  const hashed = await bcrypt.hash('Admin@123456', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Administrador',
      email: 'admin@inventory.local',
      password: hashed,
      role: UserRole.admin,
    },
  });

  console.log(`Admin created: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
