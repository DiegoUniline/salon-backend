const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Dashboard principal
router.get('/', async (req, res) => {
  try {
    const { branch_id } = req.query;
    const today = new Date().toISOString().split('T')[0];

    // Ventas de hoy
    const [salesTotal] = await db.query(`
      SELECT COALESCE(SUM(total), 0) as total FROM sales 
      WHERE date = ? ${branch_id ? 'AND branch_id = ?' : ''}
    `, branch_id ? [today, branch_id] : [today]);

    const [appointmentsTotal] = await db.query(`
      SELECT COALESCE(SUM(total), 0) as total FROM appointments 
      WHERE date = ? AND status = 'completed' ${branch_id ? 'AND branch_id = ?' : ''}
    `, branch_id ? [today, branch_id] : [today]);

    // Citas de hoy
    const [appointmentsToday] = await db.query(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status IN ('scheduled', 'confirmed') THEN 1 ELSE 0 END) as pending
      FROM appointments 
      WHERE date = ? ${branch_id ? 'AND branch_id = ?' : ''}
    `, branch_id ? [today, branch_id] : [today]);

    // Timeline de citas
    const [timeline] = await db.query(`
      SELECT a.*, u.name as stylist_name, u.color as stylist_color 
      FROM appointments a 
      LEFT JOIN users u ON a.stylist_id = u.id 
      WHERE a.date = ? ${branch_id ? 'AND a.branch_id = ?' : ''}
      ORDER BY a.time
    `, branch_id ? [today, branch_id] : [today]);

    // Ingresos de la semana
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const [weeklyRevenue] = await db.query(`
      SELECT date, SUM(total) as total FROM (
        SELECT date, total FROM sales WHERE date BETWEEN ? AND ? ${branch_id ? 'AND branch_id = ?' : ''}
        UNION ALL
        SELECT date, total FROM appointments WHERE date BETWEEN ? AND ? AND status = 'completed' ${branch_id ? 'AND branch_id = ?' : ''}
      ) combined
      GROUP BY date
      ORDER BY date
    `, branch_id 
      ? [weekStartStr, today, branch_id, weekStartStr, today, branch_id] 
      : [weekStartStr, today, weekStartStr, today]
    );

    // Top servicios
    const [topServices] = await db.query(`
      SELECT s.name, COUNT(*) as count, SUM(aps.price) as revenue
      FROM appointment_services aps
      JOIN services s ON aps.service_id = s.id
      JOIN appointments a ON aps.appointment_id = a.id
      WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' ${branch_id ? 'AND a.branch_id = ?' : ''}
      GROUP BY s.id, s.name
      ORDER BY count DESC
      LIMIT 5
    `, branch_id ? [weekStartStr, today, branch_id] : [weekStartStr, today]);

    // Top productos
    const [topProducts] = await db.query(`
      SELECT name, SUM(quantity) as quantity, SUM(subtotal) as revenue
      FROM sale_items
      WHERE item_type = 'product'
      GROUP BY item_id, name
      ORDER BY quantity DESC
      LIMIT 5
    `);

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

// Reportes
router.get('/reports', async (req, res) => {
  try {
    const { branch_id, start_date, end_date, type } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Fechas requeridas' });
    }

    let data = {};

    switch (type) {
      case 'sales':
        const [sales] = await db.query(`
          SELECT date, SUM(total) as total FROM (
            SELECT date, total FROM sales WHERE date BETWEEN ? AND ? ${branch_id ? 'AND branch_id = ?' : ''}
            UNION ALL
            SELECT date, total FROM appointments WHERE date BETWEEN ? AND ? AND status = 'completed' ${branch_id ? 'AND branch_id = ?' : ''}
          ) combined
          GROUP BY date
          ORDER BY date
        `, branch_id 
          ? [start_date, end_date, branch_id, start_date, end_date, branch_id] 
          : [start_date, end_date, start_date, end_date]
        );
        data = { sales };
        break;

      case 'services':
        const [services] = await db.query(`
          SELECT s.name, s.category, COUNT(*) as count, SUM(aps.price) as revenue
          FROM appointment_services aps
          JOIN services s ON aps.service_id = s.id
          JOIN appointments a ON aps.appointment_id = a.id
          WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' ${branch_id ? 'AND a.branch_id = ?' : ''}
          GROUP BY s.id, s.name, s.category
          ORDER BY revenue DESC
        `, branch_id ? [start_date, end_date, branch_id] : [start_date, end_date]);
        data = { services };
        break;

      case 'products':
        const [products] = await db.query(`
          SELECT si.name, SUM(si.quantity) as quantity, SUM(si.subtotal) as revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.date BETWEEN ? AND ? AND si.item_type = 'product' ${branch_id ? 'AND s.branch_id = ?' : ''}
          GROUP BY si.item_id, si.name
          ORDER BY revenue DESC
        `, branch_id ? [start_date, end_date, branch_id] : [start_date, end_date]);
        data = { products };
        break;

      case 'stylists':
        const [stylists] = await db.query(`
          SELECT u.name, COUNT(a.id) as appointments, SUM(a.total) as revenue
          FROM appointments a
          JOIN users u ON a.stylist_id = u.id
          WHERE a.date BETWEEN ? AND ? AND a.status = 'completed' ${branch_id ? 'AND a.branch_id = ?' : ''}
          GROUP BY u.id, u.name
          ORDER BY revenue DESC
        `, branch_id ? [start_date, end_date, branch_id] : [start_date, end_date]);
        data = { stylists };
        break;

      case 'expenses':
        const [expenses] = await db.query(`
          SELECT category, SUM(amount) as total
          FROM expenses
          WHERE date BETWEEN ? AND ? ${branch_id ? 'AND branch_id = ?' : ''}
          GROUP BY category
          ORDER BY total DESC
        `, branch_id ? [start_date, end_date, branch_id] : [start_date, end_date]);
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
