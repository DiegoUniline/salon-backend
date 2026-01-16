const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Dashboard principal (por sucursal)
router.get('/', auth, async (req, res) => {
  try {
    const branch_id = req.user.branch_id;
    const today = new Date().toISOString().split('T')[0];

    const [salesTotal] = await db.query(`
      SELECT COALESCE(SUM(total), 0) as total FROM sales 
      WHERE date = ? AND branch_id = ?
    `, [today, branch_id]);

    const [appointmentsTotal] = await db.query(`
      SELECT COALESCE(SUM(total), 0) as total FROM appointments 
      WHERE date = ? AND status = 'completed' AND branch_id = ?
    `, [today, branch_id]);

    const [appointmentsToday] = await db.query(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status IN ('scheduled', 'confirmed') THEN 1 ELSE 0 END) as pending
      FROM appointments 
      WHERE date = ? AND branch_id = ?
    `, [today, branch_id]);

    const [timeline] = await db.query(`
      SELECT a.*, u.name as stylist_name, u.color as stylist_color 
      FROM appointments a 
      LEFT JOIN users u ON a.stylist_id = u.id 
      WHERE a.date = ? AND a.branch_id = ?
      ORDER BY a.time
    `, [today, branch_id]);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const [weeklyRevenue] = await db.query(`
      SELECT date, SUM(total) as total FROM (
        SELECT date, total FROM sales WHERE date BETWEEN ? AND ? AND branch_id = ?
        UNION ALL
        SELECT date, total FROM appointments WHERE date BETWEEN ? AND ? AND status = 'completed' AND branch_id = ?
      ) combined
      GROUP BY date
      ORDER BY date
    `, [weekStartStr, today, branch_id, weekStartStr, today, branch_id]);

    const [topServices] = await db.query(`
      SELECT s.name, COUNT(*) as count, SUM(aps.price) as revenue
      FROM appointment_services aps
      JOIN services s ON aps.service_id = s.id
      JOIN appointments a ON aps.appointment_id = a.id
      WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' AND a.branch_id = ?
      GROUP BY s.id, s.name
      ORDER BY count DESC
      LIMIT 5
    `, [weekStartStr, today, branch_id]);

    const [topProducts] = await db.query(`
      SELECT si.name, SUM(si.quantity) as quantity, SUM(si.subtotal) as revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.date BETWEEN ? AND ? AND si.item_type = 'product' AND s.branch_id = ?
      GROUP BY si.item_id, si.name
      ORDER BY quantity DESC
      LIMIT 5
    `, [weekStartStr, today, branch_id]);

    res.json({
      today: {
        sales: parseFloat(salesTotal[0].total) + parseFloat(appointmentsTotal[0].total),
        appointments: {
          total: appointmentsToday[0].total,
          completed: appointmentsToday[0].completed,
          pending: appointmentsToday[0].pending
        }
      },
      timeline,
      weeklyRevenue,
      topServices,
      topProducts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reportes (por sucursal)
router.get('/reports', auth, async (req, res) => {
  try {
    const branch_id = req.user.branch_id;
    const { start_date, end_date, type } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Fechas requeridas' });
    }

    let data = {};

    switch (type) {
      case 'sales':
        const [sales] = await db.query(`
          SELECT date, SUM(total) as total FROM (
            SELECT date, total FROM sales WHERE date BETWEEN ? AND ? AND branch_id = ?
            UNION ALL
            SELECT date, total FROM appointments WHERE date BETWEEN ? AND ? AND status = 'completed' AND branch_id = ?
          ) combined
          GROUP BY date
          ORDER BY date
        `, [start_date, end_date, branch_id, start_date, end_date, branch_id]);
        data = { sales };
        break;

      case 'services':
        const [services] = await db.query(`
          SELECT s.name, s.category, COUNT(*) as count, SUM(aps.price) as revenue
          FROM appointment_services aps
          JOIN services s ON aps.service_id = s.id
          JOIN appointments a ON aps.appointment_id = a.id
          WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' AND a.branch_id = ?
          GROUP BY s.id, s.name, s.category
          ORDER BY revenue DESC
        `, [start_date, end_date, branch_id]);
        data = { services };
        break;

      case 'products':
        const [products] = await db.query(`
          SELECT si.name, SUM(si.quantity) as quantity, SUM(si.subtotal) as revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.date BETWEEN ? AND ? AND si.item_type = 'product' AND s.branch_id = ?
          GROUP BY si.item_id, si.name
          ORDER BY revenue DESC
        `, [start_date, end_date, branch_id]);
        data = { products };
        break;

      case 'stylists':
        const [stylists] = await db.query(`
          SELECT u.name, COUNT(a.id) as appointments, SUM(a.total) as revenue
          FROM appointments a
          JOIN users u ON a.stylist_id = u.id
          WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' AND a.branch_id = ?
          GROUP BY u.id, u.name
          ORDER BY revenue DESC
        `, [start_date, end_date, branch_id]);
        data = { stylists };
        break;

      case 'expenses':
        const [expenses] = await db.query(`
          SELECT category, SUM(amount) as total
          FROM expenses
          WHERE date BETWEEN ? AND ? AND branch_id = ?
          GROUP BY category
          ORDER BY total DESC
        `, [start_date, end_date, branch_id]);
        data = { expenses };
        break;

      default:
        return res.status(400).json({ error: 'Tipo de reporte no válido' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
