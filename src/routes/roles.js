// roles.js - Multi-tenant completo
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Roles default para nuevas empresas
const DEFAULT_ROLES = [
  {
    name: 'superadmin',
    description: 'Control total del sistema',
    color: '#dc2626',
    permissions: ['*']
  },
  {
    name: 'admin',
    description: 'Administrador general',
    color: '#2563eb',
    permissions: ['dashboard.*', 'users.read', 'users.write', 'roles.read', 'settings.read']
  },
  {
    name: 'usuario',
    description: 'Usuario estándar',
    color: '#16a34a',
    permissions: ['dashboard.read']
  }
];

// Crear roles default para una empresa
const createDefaultRoles = async (companyId) => {
  for (const role of DEFAULT_ROLES) {
    await db.query(
      'INSERT INTO roles (id, name, description, color, permissions, company_id, is_system) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), role.name, role.description, role.color, JSON.stringify(role.permissions), companyId, false]
    );
  }
};

// GET - Roles de la empresa del usuario
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM roles WHERE company_id = ? ORDER BY name',
      [req.user.company_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Un rol (validar que sea de su empresa)
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM roles WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST - Crear rol
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, color, permissions } = req.body;
    const id = uuidv4();

    await db.query(
      'INSERT INTO roles (id, name, description, color, permissions, company_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, description, color || '#3B82F6', JSON.stringify(permissions), req.user.company_id]
    );

    res.status(201).json({ id, name, description, color: color || '#3B82F6', permissions });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El nombre del rol ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT - Actualizar rol (sin restricciones, cada empresa controla los suyos)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, description, color, permissions } = req.body;

    // Verificar que el rol pertenece a su empresa
    const [role] = await db.query(
      'SELECT * FROM roles WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    
    if (role.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    await db.query(
      'UPDATE roles SET name = ?, description = ?, color = ?, permissions = ? WHERE id = ? AND company_id = ?',
      [name, description, color, JSON.stringify(permissions), req.params.id, req.user.company_id]
    );

    res.json({ id: req.params.id, name, description, color, permissions });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El nombre del rol ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST - Duplicar rol
router.post('/:id/duplicate', auth, async (req, res) => {
  try {
    const [role] = await db.query(
      'SELECT * FROM roles WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    if (role.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const id = uuidv4();
    const newName = `${role[0].name} (copia)`;

    await db.query(
      'INSERT INTO roles (id, name, description, color, permissions, company_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, newName, role[0].description, role[0].color, role[0].permissions, req.user.company_id]
    );

    res.status(201).json({ id, name: newName, description: role[0].description, color: role[0].color, permissions: JSON.parse(role[0].permissions) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Eliminar rol
router.delete('/:id', auth, async (req, res) => {
  try {
    // Verificar que pertenece a su empresa
    const [role] = await db.query(
      'SELECT * FROM roles WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    if (role.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    // Verificar usuarios asignados
    const [users] = await db.query('SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?', [req.params.id]);
    if (users[0].count > 0) {
      return res.status(400).json({ error: `No se puede eliminar: ${users[0].count} usuario(s) asignados` });
    }

    await db.query('DELETE FROM roles WHERE id = ? AND company_id = ?', [req.params.id, req.user.company_id]);
    res.json({ message: 'Rol eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ USER ROLES ============

router.get('/users/list', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.email, u.active, ur.role_id, r.name as role_name, r.color as role_color, ur.branch_id
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.company_id = ?
      ORDER BY u.name
    `, [req.user.company_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users/assign', auth, async (req, res) => {
  try {
    const { user_id, role_id, branch_id } = req.body;

    // Validar que el rol es de su empresa
    const [role] = await db.query('SELECT id FROM roles WHERE id = ? AND company_id = ?', [role_id, req.user.company_id]);
    if (role.length === 0) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    await db.query('DELETE FROM user_roles WHERE user_id = ?', [user_id]);
    await db.query(
      'INSERT INTO user_roles (id, user_id, role_id, branch_id) VALUES (UUID(), ?, ?, ?)',
      [user_id, role_id, branch_id]
    );

    res.json({ message: 'Rol asignado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/users/:user_id/role', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM user_roles WHERE user_id = ?', [req.params.user_id]);
    res.json({ message: 'Rol removido' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Exportar también la función para usarla en registro de empresas
module.exports = router;
module.exports.createDefaultRoles = createDefaultRoles;
