const { Router } = require('express');
const products = require('../controllers/products.controller');

const router = Router();

router.get('/products', products.list);
router.get('/products/:id', products.get);
router.patch('/products/:id', products.update);

module.exports = router;
