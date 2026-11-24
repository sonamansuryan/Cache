const service = require('../services/products.service');
const validate = require('../validators/products.validator');
const cache = require('../cache');

// The read endpoints send JSON text from the cache, or from MySQL on a miss.
// It is the same text res.json() would produce.
async function list(req, res) {
  const query = validate.listQuery(req.query);
  res.type('json').send(await cache.listResponse(query, () => service.listProducts(query)));
}

async function get(req, res) {
  const id = validate.id(req.params.id);
  res.type('json').send(await cache.productResponse(id, () => service.getProduct(id)));
}

async function update(req, res) {
  res.json(await service.updateProduct(validate.id(req.params.id), validate.updateBody(req.body)));
}

module.exports = { list, get, update };
