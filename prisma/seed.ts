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
    const hashedPassword = await bcrypt.hash('password123', 10);
    const hashedPin = await bcrypt.hash('1234', 10);

    // Create admin user
    const admin = await prisma.user.upsert({
        where: { email: 'admin@killbill.app' },
        update: {
            isAdmin: true,
        },
        create: {
            name: 'Admin',
            email: 'admin@killbill.app',
            password: hashedPassword,
            pin: hashedPin,
            avatar: '👑',
            isAdmin: true,
        },
    });

    console.log(`✅ Created admin: ${admin.name} (${admin.email})`);

    console.log('\n📊 Seed Summary:');
    console.log(`   - Admin: ${admin.email}`);
    console.log('\n🔐 Credentials:');
    console.log('   Admin: admin@killbill.app / password123');
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
