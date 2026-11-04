require('dotenv').config({ quiet: true });
const { Product, sequelize } = require('../src/models');

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
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
