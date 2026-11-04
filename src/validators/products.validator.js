const { ValidationError } = require('../utils/errors');

const SORTS = ['newest', 'price_asc', 'price_desc'];
const MAX_PRICE = 99999999.99;

function listQuery(query) {
  const errors = [];
  let { category, sort = 'newest', page = '1', limit = '20' } = query;

  if (category !== undefined) {
    category = String(category).trim().toLowerCase();
    if (!category || category.length > 40) errors.push('category must be 1-40 characters');
  }
  if (!SORTS.includes(sort)) errors.push(`sort must be one of: ${SORTS.join(', ')}`);

  page = Number(page);
  if (!Number.isInteger(page) || page < 1) errors.push('page must be a positive integer');

  limit = Number(limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.push('limit must be an integer between 1 and 100');

  if (errors.length) throw new ValidationError('Invalid query parameters', errors);
  return { category, sort, page, limit };
}

function id(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ValidationError('id must be a positive integer');
  return value;
}

function updateBody(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('JSON body required');
  const errors = [];
  const fields = {};

  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) errors.push('price must be a positive number');
    else fields.price = Math.round(price * 100) / 100;
  }
  if (body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) errors.push('stock must be a non-negative integer');
    else fields.stock = stock;
  }
  if (!errors.length && Object.keys(fields).length === 0) errors.push('provide at least one of: price, stock');

  if (errors.length) throw new ValidationError('Invalid body', errors);
  return fields;
}

module.exports = { listQuery, id, updateBody };
