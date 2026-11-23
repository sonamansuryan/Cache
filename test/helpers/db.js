// A separate MySQL connection for the tests, with the app's settings from .env.
// Before a test changes a product, it snapshots the row. The exact values are
// written back when the test ends, so runs are repeatable and the seeded data
// (also used by the benchmark) stays the same.
const { Sequelize } = require('sequelize');
const config = require('../../config/config.js')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });

// The columns that PATCH /api/products/:id and scripts/reprice.js can change.
// updated_at is read and written back as MySQL's own text. A JS Date would be
// shifted: Sequelize formats Date replacements in the machine's local time zone,
// but it reads DATETIME values as UTC.
async function snapshotProduct(id) {
  const sql = "SELECT id, price, stock, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at FROM products WHERE id = ?";
  const [rows] = await sequelize.query(sql, { replacements: [id] });
  if (rows.length === 0) throw new Error(`Product ${id} not found`);
  return rows[0];
}

async function restoreProduct(row) {
  await sequelize.query('UPDATE products SET price = ?, stock = ?, updated_at = ? WHERE id = ?', {
    replacements: [row.price, row.stock, row.updated_at, row.id],
  });
}

// Call before a test changes product `id`. Its values are put back after that
// test, whether it passes or fails.
async function restoreAfter(t, id) {
  const row = await snapshotProduct(id);
  t.after(() => restoreProduct(row));
  return row;
}

const close = () => sequelize.close();

module.exports = { snapshotProduct, restoreProduct, restoreAfter, close };
