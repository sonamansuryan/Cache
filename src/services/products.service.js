const { Product } = require('../models');
const { NotFoundError } = require('../utils/errors');

const ORDER = {
  newest: [['createdAt', 'DESC'], ['id', 'DESC']],
  price_asc: [['price', 'ASC'], ['id', 'ASC']],
  price_desc: [['price', 'DESC'], ['id', 'DESC']],
};

async function listProducts({ category, sort, page, limit }) {
  const where = category ? { category } : {};

  const { rows, count } = await Product.findAndCountAll({
    where,
    order: ORDER[sort],
    limit,
    offset: (page - 1) * limit,
  });

  return { items: rows, page, limit, total: count };
}

async function getProduct(id) {
  const product = await Product.findByPk(id);
  if (!product) throw new NotFoundError(`Product ${id} not found`);
  return product;
}

async function updateProduct(id, fields) {
  const product = await getProduct(id);
  await product.update(fields);
  return product;
}

module.exports = { listProducts, getProduct, updateProduct };
