require('dotenv').config({ quiet: true });
const { sequelize } = require('../src/models');

const COUNT = Number(process.env.SEED_PRODUCTS) || 50000;
const CATEGORIES = ['toys', 'books', 'garden', 'kitchen', 'sports', 'electronics', 'clothing', 'beauty', 'automotive', 'pets', 'office', 'music'];
const ADJECTIVES = ['Compact', 'Deluxe', 'Classic', 'Eco', 'Smart', 'Pro', 'Mini', 'Ultra', 'Basic', 'Premium', 'Vintage', 'Modern'];
const NOUNS = ['Lamp', 'Bottle', 'Kit', 'Set', 'Case', 'Mat', 'Stand', 'Cable', 'Jar', 'Board', 'Bag', 'Tool'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const int = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const [[{ n }]] = await sequelize.query('SELECT COUNT(*) AS n FROM products');
  if (Number(n) > 0) {
    if (!process.argv.includes('--reset')) {
      console.error(`products already has ${n} rows. Run "node scripts/seed.js --reset" to empty it and reseed.`);
      process.exit(1);
    }
    await sequelize.query('TRUNCATE TABLE products');
  }

  const queryInterface = sequelize.getQueryInterface();
  let batch = [];
  for (let i = 1; i <= COUNT; i++) {
    const createdAt = new Date(Date.now() - int(0, 730) * DAY);
    batch.push({
      name: `${pick(ADJECTIVES)} ${pick(NOUNS)} ${i}`,
      category: pick(CATEGORIES),
      price: int(100, 50000) / 100,
      stock: int(0, 200),
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (batch.length === 2000) {
      await queryInterface.bulkInsert('products', batch);
      batch = [];
    }
  }
  if (batch.length) await queryInterface.bulkInsert('products', batch);

  console.log(`inserted ${COUNT} products`);
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
