import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import bcrypt from 'bcryptjs';

// Parse DATABASE_URL to get connection details
function parseDbUrl(url: string) {
    const regex = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    const match = url.match(regex);
    if (!match) throw new Error('Invalid DATABASE_URL format');
    return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4]),
        database: match[5],
    };
}

const dbConfig = parseDbUrl(process.env.DATABASE_URL!);

const adapter = new PrismaMariaDb({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    port: dbConfig.port,
    connectionLimit: 10
});

const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding database...');

    // Hash password
    // Admin credentials are overridable via env so non-local environments don't
    // ship the well-known dev defaults. Defaults are kept for local DX.
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@killbill.app';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'password123';
    const adminPin = process.env.SEED_ADMIN_PIN ?? '1234';
    const usingDefaultPassword = !process.env.SEED_ADMIN_PASSWORD;

    if (usingDefaultPassword) {
        console.warn(
            '⚠️  Seeding admin with the DEFAULT dev password. Set SEED_ADMIN_PASSWORD ' +
            '(and optionally SEED_ADMIN_EMAIL / SEED_ADMIN_PIN) before seeding any ' +
            'shared or production environment.'
        );
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const hashedPin = await bcrypt.hash(adminPin, 10);

    // Create admin user
    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
            isAdmin: true,
        },
        create: {
            name: 'Admin',
            email: adminEmail,
            password: hashedPassword,
            pin: hashedPin,
            avatar: '👑',
            isAdmin: true,
        },
    });

    console.log(`✅ Created admin: ${admin.name} (${admin.email})`);

    console.log('\n📊 Seed Summary:');
    console.log(`   - Admin: ${admin.email}`);
    if (usingDefaultPassword) {
        // Only echo the password when it's the public dev default; never print a
        // custom/secret one to logs.
        console.log('\n🔐 Credentials (dev default):');
        console.log(`   Admin: ${adminEmail} / password123`);
    }
}

main()
    .then(async () => {
        await prisma.$disconnect();
        console.log('\n✨ Seeding completed successfully!');
    })
    .catch(async (e) => {
        console.error('❌ Seeding failed:', e);
        await prisma.$disconnect();
        process.exit(1);
    });
