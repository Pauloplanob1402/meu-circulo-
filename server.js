const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { init, query, queryOne, run } = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SECRET = process.env.JWT_SECRET || 'meucirculo2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──
function hash(s) { return crypto.createHash('sha256').update(s + SECRET).digest('hex'); }

function token(u) {
  const h = Buffer.from('{"alg":"HS256"}').toString('base64url');
  const b = Buffer.from(JSON.stringify({ id: u.id, nome: u.nome, perfil: u.perfil })).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

function verifyToken(tk) {
  try {
    const [h, b, s] = tk.split('.');
    const check = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
    if (s !== check) return null;
    return JSON.parse(Buffer.from(b, 'base64url').toString());
  } catch { return null; }
}

// ── REST ──
app.post('/api/cadastro', (req, res) => {
  const { nome, email, senha, perfil } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Campos obrigatórios' });
  try {
    const r = run('INSERT INTO usuarios (nome,email,senha,perfil) VALUES (?,?,?,?)',
      [nome.trim(), email.trim().toLowerCase(), hash(senha), perfil || 'builder']);
    const u = queryOne('SELECT id,nome,email,perfil FROM usuarios WHERE id=?', [r.lastInsertRowid]);
    res.json({ token: token(u), usuario: u });
  } catch(e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ erro: 'E-mail já cadastrado' });
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;
  const u = queryOne('SELECT * FROM usuarios WHERE email=?', [email?.trim().toLowerCase()]);
  if (!u || u.senha !== hash(senha)) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  const { senha: _, ...dados } = u;
  res.json({ token: token(dados), usuario: dados });
});

app.get('/api/mesas', (req, res) => {
  const mesas = query('SELECT * FROM mesas ORDER BY id');
  res.json(mesas.map(m => ({
    ...m,
    assentos: query(`SELECT a.id, u.id as usuario_id, u.nome, u.perfil
      FROM assentos a LEFT JOIN usuarios u ON a.usuario_id=u.id WHERE a.mesa_id=?`, [m.id])
  })));
});

app.get('/api/mensagens/:tipo', (req, res) => {
  const id = req.params.tipo === 'geral' ? null : parseInt(req.params.tipo);
  const msgs = query(`SELECT m.*,u.nome as autor,u.perfil as autor_perfil
    FROM mensagens m JOIN usuarios u ON m.usuario_id=u.id
    WHERE ${id === null ? 'm.mesa_id IS NULL' : 'm.mesa_id=?'}
    ORDER BY m.id DESC LIMIT 50`, id !== null ? [id] : []);
  res.json(msgs.reverse());
});

// ── WebSocket ──
const clientes = new Map();

function broadcast(data, skip = null) {
  const m = JSON.stringify(data);
  wss.clients.forEach(ws => { if (ws !== skip && ws.readyState === WebSocket.OPEN) ws.send(m); });
}

function broadcastMesa(mesaId, data) {
  const m = JSON.stringify(data);
  clientes.forEach((info, ws) => {
    if (ws.readyState === WebSocket.OPEN && info.mesaId === mesaId) ws.send(m);
  });
}

function estado() {
  const mesas = query('SELECT * FROM mesas ORDER BY id');
  const online = [];
  clientes.forEach(i => { if (i.usuario) online.push({ id: i.usuario.id, nome: i.usuario.nome, perfil: i.usuario.perfil, mesaId: i.mesaId }); });
  return {
    tipo: 'estado',
    online,
    mesas: mesas.map(m => ({
      ...m,
      assentos: query(`SELECT a.id,u.id as usuario_id,u.nome,u.perfil
        FROM assentos a LEFT JOIN usuarios u ON a.usuario_id=u.id WHERE a.mesa_id=?`, [m.id])
    }))
  };
}

wss.on('connection', ws => {
  clientes.set(ws, { usuario: null, assentoId: null, mesaId: null });

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const info = clientes.get(ws);

    if (msg.tipo === 'auth') {
      const p = verifyToken(msg.token);
      if (!p) return ws.send(JSON.stringify({ tipo: 'erro', msg: 'Token inválido' }));
      const u = queryOne('SELECT id,nome,perfil FROM usuarios WHERE id=?', [p.id]);
      if (!u) return;
      clientes.set(ws, { ...info, usuario: u });
      ws.send(JSON.stringify(estado()));
      broadcast({ tipo: 'entrou', usuario: u }, ws);
    }

    else if (msg.tipo === 'sentar') {
      if (!info.usuario) return;
      const assento = queryOne('SELECT * FROM assentos WHERE id=? AND usuario_id IS NULL', [msg.assentoId]);
      if (!assento) return ws.send(JSON.stringify({ tipo: 'erro', msg: 'Assento ocupado' }));
      if (info.assentoId) run('UPDATE assentos SET usuario_id=NULL WHERE id=?', [info.assentoId]);
      run('UPDATE assentos SET usuario_id=? WHERE id=?', [info.usuario.id, msg.assentoId]);
      clientes.set(ws, { ...info, assentoId: msg.assentoId, mesaId: assento.mesa_id });
      broadcast(estado());
    }

    else if (msg.tipo === 'levantar') {
      if (!info.assentoId) return;
      run('UPDATE assentos SET usuario_id=NULL WHERE id=?', [info.assentoId]);
      clientes.set(ws, { ...info, assentoId: null, mesaId: null });
      broadcast(estado());
    }

    else if (msg.tipo === 'mensagem') {
      if (!info.usuario || !msg.conteudo?.trim()) return;
      const conteudo = msg.conteudo.trim().slice(0, 500);
      const mesa_id = msg.mesa_id || null;
      run('INSERT INTO mensagens (usuario_id,mesa_id,conteudo,tipo) VALUES (?,?,?,?)',
        [info.usuario.id, mesa_id, conteudo, msg.tipo_msg || 'texto']);
      const payload = { tipo: 'mensagem', mesa_id, conteudo, tipo_msg: msg.tipo_msg || 'texto',
        autor: info.usuario.nome, autor_id: info.usuario.id, perfil: info.usuario.perfil,
        enviado_em: new Date().toISOString() };
      if (mesa_id) { broadcastMesa(mesa_id, payload); ws.send(JSON.stringify(payload)); }
      else broadcast(payload);
    }
  });

  ws.on('close', () => {
    const info = clientes.get(ws);
    if (info?.assentoId) run('UPDATE assentos SET usuario_id=NULL WHERE id=?', [info.assentoId]);
    if (info?.usuario) broadcast({ tipo: 'saiu', usuario: info.usuario });
    clientes.delete(ws);
    broadcast(estado());
  });
});

// ── Start ──
init().then(() => {
  server.listen(PORT, () => console.log(`🟣 Meu Círculo rodando em http://localhost:${PORT}`));
}).catch(e => { console.error('Erro ao iniciar banco:', e); process.exit(1); });
