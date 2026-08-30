// hashPass.cjs
const bcrypt = require('bcryptjs');

(async () => {
  const password = 'Kush#0513';
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
})();
