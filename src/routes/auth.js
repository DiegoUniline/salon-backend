const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Roles por defecto para nuevas cuentas
const DEFAULT_ROLES = [
  {
    name: 'Administrador',
    description: 'Control total del sistema',
    color: '#dc2626',
    permissions: {
      dashboard: { view: true, create: true, edit: true, delete: true },
      appointments: { view: true, create: true, edit: true, delete: true },
      sales: { view: true, create: true, edit: true, delete: true },
      clients: { view: true, create: true, edit: true, delete: true },
      services: { view: true, create: true, edit: true, delete: true },
      products: { view: true, create: true, edit: true, delete: true },
      inventory: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true, delete: true },
      roles: { view: true, create: true, edit: true, delete: true },
      branches: { view: true, create: true, edit: true, delete: true },
      reports: { view: true, create: true, edit: true, delete: true },
      settings: { view: true, create: true, edit: true, delete: true },
      expenses: { view: true, create: true, edit: true, delete: true },
      purchases: { view: true, create: true, edit: true, delete: true },
      cashcuts: { view: true, create: true, edit: true, delete: true }
    }
  },
  {
    name: 'Gerente',
    description: 'Gestión general de sucursal',
    color: '#2563eb',
    permissions: {
      dashboard: { view: true, create: true, edit: true, delete: false },
      appointments: { view: true, create: true, edit: true, delete: true },
      sales: { view: true, create: true, edit: true, delete: false },
      clients: { view: true, create: true, edit: true, delete: false },
      services: { view: true, create: true, edit: true, delete: false },
      products: { view: true, create: true, edit: true, delete: false },
      inventory: { view: true, create: true, edit: true, delete: false },
      users: { view: true, create: false, edit: false, delete: false },
      roles: { view: true, create: false, edit: false, delete: false },
      reports: { view: true, create: true, edit: false, delete: false },
      expenses: { view: true, create: true, edit: true, delete: false },
      purchases: { view: true, create: true, edit: true, delete: false },
      cashcuts: { view: true, create: true, edit: false, delete: false }
    }
  },
  {
    name: 'Recepcionista',
    description: 'Atención y agenda',
    color: '#16a34a',
    permissions: {
      dashboard: { view: true, create: false, edit: false, delete: false },
      appointments: { view: true, create: true, edit: true, delete: false },
      sales: { view: true, create: true, edit: false, delete: false },
      clients: { view: true, create: true, edit: true, delete: false },
      services: { view: true, create: false, edit: false, delete: false },
      products: { view: true, create: false, edit: false, delete: false }
    }
  },
  {
    name: 'Estilista',
    description: 'Profesional de servicios',
    color: '#9333ea',
    permissions: {
      dashboard: { view: true, create: false, edit: false, delete: false },
      appointments: { view: true, create: false, edit: false, delete: false },
      clients: { view: true, create: false, edit: false, delete: false },
      services: { view: true, create: false, edit: false, delete: false }
    }
  }
];

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

    // Verificar suscripción activa
    const [subscription] = await db.query(
      `SELECT s.*, p.name as plan_name FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.account_id = ? AND s.status IN ('trial', 'active')`,
      [user.account_id]
    );

    if (subscription.length === 0) {
      return res.status(403).json({ error: 'Suscripción inactiva o expirada' });
    }

    // Verificar si el trial expiró
    if (subscription[0].status === 'trial' && new Date(subscription[0].trial_ends_at) < new Date()) {
      await db.query(
        "UPDATE subscriptions SET status = 'expired' WHERE id = ?",
        [subscription[0].id]
      );
      return res.status(403).json({ error: 'Tu periodo de prueba ha expirado. Actualiza tu plan para continuar.' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
      [user.id, token, expiresAt]
    );

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
        account_id: user.account_id,
        color: user.color,
        avatar_url: user.avatar_url,
        permissions
      },
      subscription: {
        plan: subscription[0].plan_name,
        status: subscription[0].status,
        trial_ends_at: subscription[0].trial_ends_at,
        ends_at: subscription[0].ends_at
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
      'SELECT id, name, email, role, branch_id, account_id, color, avatar_url FROM users WHERE id = ?',
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

    // Info de suscripción
    const subscription = {
      plan: req.user.plan_name,
      status: req.user.subscription_status,
      trial_ends_at: req.user.trial_ends_at,
      ends_at: req.user.ends_at,
      max_users: req.user.max_users,
      max_branches: req.user.max_branches,
      current_users: req.user.current_users,
      current_branches: req.user.current_branches
    };

    res.json({
      ...users[0],
      role: roles[0]?.role_name || users[0].role,
      permissions,
      subscription
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registro de nueva cuenta (signup)
router.post('/signup', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      account_name, 
      branch_name, 
      admin_name, 
      admin_email, 
      admin_password, 
      admin_phone,
      plan_id 
    } = req.body;

    // Validar que el email no exista
    const [existingUser] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [admin_email]
    );

    if (existingUser.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // 1. Crear cuenta
    const accountId = uuidv4();
    await connection.query(
      'INSERT INTO accounts (id, name, email, phone) VALUES (?, ?, ?, ?)',
      [accountId, account_name, admin_email, admin_phone]
    );

    // 2. Crear sucursal principal
    const branchId = uuidv4();
    await connection.query(
      'INSERT INTO branches (id, name, account_id) VALUES (?, ?, ?)',
      [branchId, branch_name || 'Sucursal Principal', accountId]
    );

    // 3. Crear roles por defecto
    const rolesCreated = [];
    for (const role of DEFAULT_ROLES) {
      const roleId = uuidv4();
      await connection.query(
        'INSERT INTO roles (id, name, description, color, permissions, account_id) VALUES (?, ?, ?, ?, ?, ?)',
        [roleId, role.name, role.description, role.color, JSON.stringify(role.permissions), accountId]
      );
      rolesCreated.push({ id: roleId, name: role.name });
    }

    // 4. Obtener el plan (default: plan-basic o el que envíen)
    const selectedPlanId = plan_id || 'plan-basic';
    const [plan] = await connection.query('SELECT * FROM plans WHERE id = ?', [selectedPlanId]);
    
    if (plan.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Plan no válido' });
    }

    // 5. Crear suscripción (trial 14 días)
    const subscriptionId = uuidv4();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await connection.query(
      `INSERT INTO subscriptions (id, account_id, plan_id, status, max_users, max_branches, current_users, current_branches, trial_ends_at, starts_at) 
       VALUES (?, ?, ?, 'trial', ?, ?, 1, 1, ?, CURDATE())`,
      [subscriptionId, accountId, selectedPlanId, plan[0].max_users, plan[0].max_branches, trialEndsAt]
    );

    // 6. Crear usuario administrador
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(admin_password, 10);

    await connection.query(
      `INSERT INTO users (id, name, email, phone, password_hash, role, branch_id, account_id, color) 
       VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, '#3B82F6')`,
      [userId, admin_name, admin_email, admin_phone, passwordHash, branchId, accountId]
    );

    // 7. Asignar rol Administrador
    const adminRole = rolesCreated.find(r => r.name === 'Administrador');
    await connection.query(
      'INSERT INTO user_roles (id, user_id, role_id, branch_id) VALUES (UUID(), ?, ?, ?)',
      [userId, adminRole.id, branchId]
    );

    // 8. Crear sesión
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await connection.query(
      'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)',
      [userId, token, expiresAt]
    );

    await connection.commit();

    res.status(201).json({
      message: 'Cuenta creada exitosamente',
      token,
      user: {
        id: userId,
        name: admin_name,
        email: admin_email,
        role: 'Administrador',
        branch_id: branchId,
        account_id: accountId,
        permissions: DEFAULT_ROLES[0].permissions
      },
      subscription: {
        plan: plan[0].name,
        status: 'trial',
        trial_ends_at: trialEndsAt
      }
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Registrar usuario (deprecado - usar /users para crear usuarios)
router.post('/register', auth, async (req, res) => {
  try {
    const { name, email, password, role, branch_id, color } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role, branch_id, account_id, color) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, passwordHash, role || 'stylist', branch_id || req.user.branch_id, req.user.account_id, color || '#3B82F6']
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
