const sanitize = require('mongo-sanitize');

module.exports = (req, res, next) => {
  // sanitize body
  if (req.body) {
    req.body = sanitize(req.body);
  }

  // sanitize URL params
  if (req.params) {
    req.params = sanitize(req.params);
  }

  // sanitize query (IMPORTANT FIX for Express 5)
  if (req.query) {
    const cleanQuery = sanitize(req.query);

    // ⚠️ Don't do: req.query = cleanQuery (this causes your error)
    Object.assign(req.query, cleanQuery);
  }

  next();
};