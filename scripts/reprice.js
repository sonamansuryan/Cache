require('dotenv').config({ quiet: true });
const { Product, sequelize } = require('../src/models');
const redis = require('../src/cache/redis');
const { invalidateProduct } = require('../src/cache');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const id = Number(arg('id'));
  const price = Number(arg('price'));

  if (!Number.isInteger(id) || id < 1 || !Number.isFinite(price) || price <= 0) {
    console.log('usage: node scripts/reprice.js --id <productId> --price <newPrice>');
    process.exitCode = 1;
  } else {
    const [updated] = await Product.update({ price }, { where: { id } });
    console.log(updated ? `product ${id}: price set to ${price.toFixed(2)}` : `product ${id} not found`);
    if (updated) {
      // The API caches responses in Redis: drop the ones that still show the old price.
      const product = await Product.findByPk(id, { attributes: ['id', 'category'] });
      await redis.connect();
      await invalidateProduct(product);
    }
  }

  await sequelize.close();
  if (redis.isOpen) await redis.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
