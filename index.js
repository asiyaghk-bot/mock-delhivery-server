const express = require('express');
const app = express();
app.use(express.json());

let shipmentCounter = 1000;
const shipments = {};
const loggedDoses = {};
const payments = {};

// ===================== DELHIVERY =====================

app.get('/c/api/pin-codes/json/', (req, res) => {
  const pin = req.query.filter_codes;
  if (!pin) return res.status(400).json({ error: 'filter_codes is required' });
  const serviceable = !pin.startsWith('0');
  if (!serviceable) return res.status(200).json({ delivery_codes: [], error: 'Pincode not serviceable' });
  return res.status(200).json({
    delivery_codes: [{ postal_code: { pin, city: 'Mumbai', state_code: 'MH', cod: 'Y', pre_paid: 'Y', is_oda: 'N' } }]
  });
});

app.post('/api/cmu/create.json', (req, res) => {
  const { shipments: incoming } = req.body || {};
  if (!incoming || !Array.isArray(incoming) || incoming.length === 0)
    return res.status(400).json({ success: false, error: 'Malformed request: shipments array required' });
  const shipment = incoming[0];
  if (shipment.name === 'TIMEOUT_TEST') return res.status(504).json({ success: false, error: 'Gateway timeout' });
  if (shipment.name === 'MALFORMED_TEST') return res.status(200).json({ ok: true, whatIsThis: 'unexpected_shape' });
  if (!shipment.pin) return res.status(400).json({ success: false, error: 'pin is required' });
  shipmentCounter++;
  const waybill = `MOCKWB${shipmentCounter}`;
  shipments[waybill] = { status: 'Manifested', created_at: new Date().toISOString(), pin: shipment.pin, product: shipment.products_desc || 'Pet supplies' };
  return res.status(200).json({ success: true, packages: [{ waybill, status: 'Success', serviceable: true }] });
});

app.get('/api/v1/packages/json/', (req, res) => {
  const wb = req.query.waybill;
  if (!wb || !shipments[wb]) return res.status(404).json({ error: 'No shipment found for this waybill' });
  return res.status(200).json({
    ShipmentData: [{ Shipment: { Status: { Status: shipments[wb].status, StatusDateTime: shipments[wb].created_at }, Destination: shipments[wb].pin } }]
  });
});

app.post('/api/cmu/urgent-create.json', (req, res) => {
  const { pin, item, reason } = req.body || {};
  if (!pin) return res.status(400).json({ success: false, error: 'pin is required' });
  const riderAvailable = !pin.startsWith('9');
  if (!riderAvailable) return res.status(200).json({ success: false, error: 'No rider available in this zone right now' });
  shipmentCounter++;
  const waybill = `URGENT${shipmentCounter}`;
  shipments[waybill] = { status: 'Out for urgent delivery', created_at: new Date().toISOString(), pin, product: item || 'Medicine refill' };
  return res.status(200).json({ success: true, waybill, eta_minutes: 45, reason: reason || 'unspecified' });
});

// ===================== PINE LABS (mock fallback) =====================

app.post('/v2/mandates/create', (req, res) => {
  const { owner_id, limit_per_txn } = req.body || {};
  if (!owner_id) return res.status(400).json({ success: false, error: 'owner_id required' });
  return res.status(200).json({ success: true, mandate_id: `MANDATE_${owner_id}`, limit_per_txn: limit_per_txn || 500, status: 'approved' });
});

app.post('/v2/payment-links/create', (req, res) => {
  const { amount, reason, payee } = req.body || {};
  if (!amount) return res.status(400).json({ success: false, error: 'amount required' });
  return res.status(200).json({ success: true, link_id: `LINK_${Date.now()}`, amount, reason, payee, status: 'pending_approval' });
});

app.post('/v2/payouts/conditional-release', (req, res) => {
  const { mandate_id, amount, caregiver_id, log_entry_id, pet_id, dose_id } = req.body || {};
  if (!mandate_id || !log_entry_id) return res.status(400).json({ success: false, error: 'mandate_id and log_entry_id required' });
  const key = `${pet_id}-${dose_id}`;
  if (!loggedDoses[key]) return res.status(409).json({ success: false, error: 'No verified log entry found for this dose — payment withheld' });
  if (amount > 500) return res.status(200).json({ success: false, requires_approval: true, error: 'Amount exceeds autonomous limit, owner approval needed' });
  const txnId = `TXN_${Date.now()}`;
  payments[txnId] = { caregiver_id, amount, log_entry_id, status: 'released' };
  return res.status(200).json({ success: true, transaction_id: txnId, amount, status: 'released' });
});

// ===================== DEDUPE / LOGGING =====================

app.post('/internal/log-dose', (req, res) => {
  const { pet_id, dose_id, caregiver_id, timestamp } = req.body || {};
  if (!pet_id || !dose_id || !caregiver_id) return res.status(400).json({ success: false, error: 'pet_id, dose_id, caregiver_id required' });
  const key = `${pet_id}-${dose_id}`;
  if (loggedDoses[key]) {
    return res.status(200).json({
      success: true, duplicate: true,
      message: `Already logged by ${loggedDoses[key].caregiver} at ${loggedDoses[key].time}`,
      original: loggedDoses[key]
    });
  }
  loggedDoses[key] = { caregiver: caregiver_id, time: timestamp || new Date().toISOString() };
  return res.status(200).json({ success: true, duplicate: false, logged: loggedDoses[key] });
});

// ===================== GNANI (mock fallback) =====================

app.post('/v1/voice/caller-history', (req, res) => {
  const { caller_number, task_type } = req.body || {};
  if (!caller_number) return res.status(400).json({ success: false, error: 'caller_number required' });
  const hasHistory = parseInt(caller_number.slice(-1)) % 2 === 0;
  return res.status(200).json({
    success: true, caller_number, task_type,
    prior_confirmations: hasHistory ? 5 : 0,
    trust_level: hasHistory ? 'established' : 'new'
  });
});

app.get('/', (req, res) => res.send('Baton mock server running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mock server on port ${PORT}`));
module.exports = app;