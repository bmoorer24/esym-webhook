const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const defaultInst = () => ({
  price: null, ema9: null, ema21: null, ema50: null,
  bias: 'neutral', strength: 'normal', signal: 0,
  signalText: 'WAITING FOR DATA', signalClass: 'avoid',
  reason: 'No data received yet.', action: '',
  layer: 0, entry: null, tp: null, sl: null, be: null, rr: null,
  updatedAt: null
});

let signals = { ES: defaultInst(), YM: defaultInst() };
let zones   = {
  ES: { supplyHigh: null, supplyLow: null, demandHigh: null, demandLow: null },
  YM: { supplyHigh: null, supplyLow: null, demandHigh: null, demandLow: null }
};

const config = {
  ES: { tp_pts: 10, sl_pts: 3.5, be_pts: 5 },
  YM: { tp_pts: 10, sl_pts: 3.5, be_pts: 5 }
};

function calcLevels(inst, dir) {
  const s = signals[inst], c = config[inst];
  if (!s.price) return;
  if (dir === 'long') {
    s.entry = s.price;
    s.tp    = +(s.price + c.tp_pts).toFixed(2);
    s.sl    = +(s.price - c.sl_pts).toFixed(2);
    s.be    = +(s.price + c.be_pts).toFixed(2);
  } else {
    s.entry = s.price;
    s.tp    = +(s.price - c.tp_pts).toFixed(2);
    s.sl    = +(s.price + c.sl_pts).toFixed(2);
    s.be    = +(s.price - c.be_pts).toFixed(2);
  }
  s.rr = (c.tp_pts / c.sl_pts).toFixed(2);
}

function clearLevels(inst) {
  const s = signals[inst];
  s.entry = null; s.tp = null; s.sl = null; s.be = null; s.rr = null;
}

function processSignal(inst) {
  const s = signals[inst], z = zones[inst];

  if (s.ema9 && s.ema21 && s.ema50) {
    if (s.ema9 > s.ema21 && s.ema21 > s.ema50)      s.bias = 'bull';
    else if (s.ema9 < s.ema21 && s.ema21 < s.ema50) s.bias = 'bear';
    else                                              s.bias = 'mixed';
  }

  const atSupply = s.price && z.supplyHigh && z.supplyLow && s.price >= z.supplyLow && s.price <= z.supplyHigh;
  const atDemand = s.price && z.demandHigh && z.demandLow && s.price >= z.demandLow && s.price <= z.demandHigh;
  const pineSignal = s.signal || 0;

  if (pineSignal === 1 || (s.bias === 'bull' && atDemand)) {
    s.signalText = 'LONG — HIGH CONVICTION'; s.signalClass = 'long';
    s.action = '▲ ENTER LONG NOW'; s.layer = 1; calcLevels(inst, 'long');
  } else if (pineSignal === 2 || (s.bias === 'bear' && atSupply)) {
    s.signalText = 'SHORT — HIGH CONVICTION'; s.signalClass = 'short';
    s.action = '▼ ENTER SHORT NOW'; s.layer = 2; calcLevels(inst, 'short');
  } else if (pineSignal === 3 || (s.bias === 'bull' && s.strength === 'strong_bull' && !atSupply)) {
    s.signalText = 'TREND LONG'; s.signalClass = 'long';
    s.action = '▲ TREND CONTINUATION — LOOK TO ENTER'; s.layer = 3; calcLevels(inst, 'long');
  } else if (pineSignal === 4 || (s.bias === 'bear' && s.strength === 'strong_bear' && !atDemand)) {
    s.signalText = 'TREND SHORT'; s.signalClass = 'short';
    s.action = '▼ TREND CONTINUATION — LOOK TO ENTER'; s.layer = 4; calcLevels(inst, 'short');
  } else if (s.bias === 'bull' && atSupply) {
    s.signalText = 'AVOID — AT SUPPLY'; s.signalClass = 'avoid';
    s.action = '⚠ WAIT — BULL BUT AT SUPPLY'; s.layer = 0; clearLevels(inst);
  } else if (s.bias === 'bear' && atDemand) {
    s.signalText = 'AVOID — AT DEMAND'; s.signalClass = 'avoid';
    s.action = '⚠ WAIT — BEAR BUT AT DEMAND'; s.layer = 0; clearLevels(inst);
  } else if (s.bias === 'mixed') {
    s.signalText = 'NO TRADE'; s.signalClass = 'avoid';
    s.action = '⚠ STAND ASIDE — EMA MIXED'; s.layer = 0; clearLevels(inst);
  } else {
    s.signalText = 'WAIT'; s.signalClass = 'avoid';
    s.action = '⚠ CONDITIONS NOT MET'; s.layer = 0; clearLevels(inst);
  }

  s.updatedAt = new Date().toISOString();
}

app.post('/webhook', (req, res) => {
  const inst = (req.body.inst || '').toUpperCase();
  if (!signals[inst]) return res.status(400).json({ error: 'Invalid instrument.' });
  const s = signals[inst], b = req.body;
  if (b.price    !== undefined) s.price    = parseFloat(b.price);
  if (b.ema9     !== undefined) s.ema9     = parseFloat(b.ema9);
  if (b.ema21    !== undefined) s.ema21    = parseFloat(b.ema21);
  if (b.ema50    !== undefined) s.ema50    = parseFloat(b.ema50);
  if (b.bias     !== undefined) s.bias     = b.bias;
  if (b.strength !== undefined) s.strength = b.strength;
  if (b.signal   !== undefined) s.signal   = parseInt(b.signal);
  if (b.reason   !== undefined) s.reason   = b.reason;
  processSignal(inst);
  const est = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  console.log(`[${est} EST] ${inst} | Price: ${s.price} | Bias: ${s.bias} | Signal: ${s.signalText}`);
  res.json({ ok: true, inst, signal: s.signalText, layer: s.layer });
});

app.post('/zones', (req, res) => {
  const inst = (req.body.inst || '').toUpperCase();
  if (!zones[inst]) return res.status(400).json({ error: 'Invalid instrument.' });
  zones[inst] = {
    supplyHigh: parseFloat(req.body.supplyHigh) || null,
    supplyLow:  parseFloat(req.body.supplyLow)  || null,
    demandHigh: parseFloat(req.body.demandHigh) || null,
    demandLow:  parseFloat(req.body.demandLow)  || null
  };
  processSignal(inst);
  res.json({ ok: true, inst, zones: zones[inst], signal: signals[inst].signalText });
});

app.get('/state', (req, res) => res.json({ signals, zones }));
app.get('/', (req, res) => res.json({ status: 'ES/YM Signal Server v2 running', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ES/YM Signal Server v2 on port ${PORT}`));
