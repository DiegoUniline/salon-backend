const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await db.query(
      'SELECT * FROM users WHERE email = ? AND active = 1',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash || '');
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
      [user.id, token, expiresAt]
    );

    // Obtener rol y permisos del usuario
    const [roles] = await db.query(
      `SELECT r.name as role_name, r.permissions FROM user_roles ur 
       JOIN roles r ON ur.role_id = r.id 
       WHERE ur.user_id = ? AND ur.active = 1`,
      [user.id]
    );

    let permissions = {};
    if (roles[0]?.permissions) {
      permissions = typeof roles[0].permissions === 'string' 
        ? JSON.parse(roles[0].permissions) 
        : roles[0].permissions;
    }

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: roles[0]?.role_name || user.role,
        branch_id: user.branch_id,
        color: user.color,
        avatar_url: user.avatar_url,
        permissions
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', auth, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    await db.query('DELETE FROM sessions WHERE token = ?', [token]);
    res.json({ message: 'Sesión cerrada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verificar sesión
router.get('/me', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, role, branch_id, color, avatar_url FROM users WHERE id = ?',
      [req.user.user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const [roles] = await db.query(
      `SELECT r.name as role_name, r.permissions FROM user_roles ur 
       JOIN roles r ON ur.role_id = r.id 
       WHERE ur.user_id = ? AND ur.active = 1`,
      [req.user.user_id]
    );

    let permissions = {};
    if (roles[0]?.permissions) {
      permissions = typeof roles[0].permissions === 'string' 
        ? JSON.parse(roles[0].permissions) 
        : roles[0].permissions;
    }

    res.json({
      ...users[0],
      role: roles[0]?.role_name || users[0].role,
      permissions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar usuario
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, branch_id, color } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, branch_id, color) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, passwordHash, role || 'stylist', branch_id, color || '#3B82F6']
    );

    res.status(201).json({ id, name, email, role: role || 'stylist' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El email ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
