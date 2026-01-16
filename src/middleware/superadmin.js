const db = require('../config/database');

const superadmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const [users] = await db.query(
      'SELECT is_superadmin FROM users WHERE id = ?',
      [req.user.user_id]
    );

    if (users.length === 0 || !users[0].is_superadmin) {
      return res.status(403).json({ error: 'Acceso denegado. Se requiere SuperAdmin.' });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = superadmin;
