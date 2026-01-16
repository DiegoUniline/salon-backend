const db = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const [sessions] = await db.query(
      `SELECT s.*, u.id as user_id, u.name, u.email, u.role, u.branch_id, u.account_id,
              sub.id as subscription_id, sub.status as subscription_status, 
              sub.max_users, sub.max_branches, sub.current_users, sub.current_branches,
              sub.trial_ends_at, sub.ends_at,
              p.name as plan_name
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       LEFT JOIN subscriptions sub ON u.account_id = sub.account_id AND sub.status IN ('trial', 'active')
       LEFT JOIN plans p ON sub.plan_id = p.id
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
