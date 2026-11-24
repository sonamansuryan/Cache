// Redis keys for cached responses. Values come from the validators, so equivalent
// requests (e.g. ?category=Toys and ?category=toys) map to the same key.
const PREFIX = 'catalog';

// Categories made only of a–z and 0–9 get their own invalidation scope. Anything else
// shares the unfiltered scope: MySQL matches categories ignoring accents (`töys` returns
// `toys` products), so those lists must be invalidated by every change.
const PLAIN_CATEGORY = /^[a-z0-9]+$/;

const productKey = (id) => `${PREFIX}:product:${id}`;

function listScope(category) {
  return category !== undefined && PLAIN_CATEGORY.test(category) ? `cat:${category}` : 'all';
}

const listVersionKey = (scope) => `${PREFIX}:list-version:${scope}`;

function listKey({ category, sort, page, limit }, version) {
  const scope = listScope(category);
  const key = `${PREFIX}:list:${scope}:v${version}:${sort}:${page}:${limit}`;
  return scope === 'all' && category !== undefined ? `${key}:${encodeURIComponent(category)}` : key;
}

module.exports = { productKey, listScope, listKey, listVersionKey };
