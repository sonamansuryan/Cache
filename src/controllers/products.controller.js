const service = require('../services/products.service');
const validate = require('../validators/products.validator');

async function list(req, res) {
  res.json(await service.listProducts(validate.listQuery(req.query)));
}

async function get(req, res) {
  res.json(await service.getProduct(validate.id(req.params.id)));
}

async function update(req, res) {
  res.json(await service.updateProduct(validate.id(req.params.id), validate.updateBody(req.body)));
}

module.exports = { list, get, update };
