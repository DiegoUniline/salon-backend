const db = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const [sessions] = await db.query(
      `SELECT s.*, u.id as user_id, u.name, u.email, u.role, u.branch_id 
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.token = ? AND s.expires_at > NOW()`,
      [token]
    );

    if (sessions.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    req.user = sessions[0];
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = auth;
