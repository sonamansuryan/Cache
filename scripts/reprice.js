require('dotenv').config({ quiet: true });
const { setTimeout: sleep } = require('node:timers/promises');
const { Product, sequelize } = require('../src/models');
const redis = require('../src/cache/redis');
const { invalidateProduct } = require('../src/cache');

// How long to wait for Redis before giving up on invalidating the cache.
const REDIS_CONNECT_WAIT_MS = 2000;

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
      // If Redis can't be reached in time, invalidateProduct() warns, and the entries expire on their own.
      const product = await Product.findByPk(id, { attributes: ['id', 'category'] });
      await Promise.race([redis.connect().catch(() => {}), sleep(REDIS_CONNECT_WAIT_MS, undefined, { ref: false })]);
      await invalidateProduct(product);
      redis.destroy(); // also stops any reconnect attempts, so the script can exit
    }
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
