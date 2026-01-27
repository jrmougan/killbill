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

    // Create a couple for the test users
    const couple = await prisma.couple.upsert({
        where: { code: 'TEST-COUPLE-001' },
        update: {},
        create: {
            name: 'Pareja de Prueba',
            code: 'TEST-COUPLE-001',
        },
    });

    console.log(`✅ Created couple: ${couple.name} (${couple.code})`);

    // Hash password for test users
    const hashedPassword = await bcrypt.hash('password123', 10);
    const hashedPin = await bcrypt.hash('1234', 10);

    // Create test user 1
    const user1 = await prisma.user.upsert({
        where: { email: 'alice@test.com' },
        update: {},
        create: {
            name: 'Alice García',
            email: 'alice@test.com',
            password: hashedPassword,
            pin: hashedPin,
            avatar: '👩',
            coupleId: couple.id,
        },
    });

    console.log(`✅ Created user: ${user1.name} (${user1.email})`);

    // Create test user 2
    const user2 = await prisma.user.upsert({
        where: { email: 'bob@test.com' },
        update: {},
        create: {
            name: 'Bob Martínez',
            email: 'bob@test.com',
            password: hashedPassword,
            pin: hashedPin,
            avatar: '👨',
            coupleId: couple.id,
        },
    });

    console.log(`✅ Created user: ${user2.name} (${user2.email})`);

    console.log('\n📊 Seed Summary:');
    console.log(`   - Couple: ${couple.name}`);
    console.log(`   - Users: ${user1.name}, ${user2.name}`);
    console.log('\n🔐 Test Credentials:');
    console.log('   Email: alice@test.com / bob@test.com');
    console.log('   Password: password123');
    console.log('   PIN: 1234');
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
