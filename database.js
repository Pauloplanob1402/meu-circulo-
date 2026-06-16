const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'circulo.db');
let db = null;

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      perfil TEXT DEFAULT 'builder',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT DEFAULT '',
      capacidade INTEGER DEFAULT 4,
      icone TEXT DEFAULT '💻'
    );
    CREATE TABLE IF NOT EXISTS assentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mesa_id INTEGER NOT NULL,
      usuario_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      mesa_id INTEGER,
      conteudo TEXT NOT NULL,
      tipo TEXT DEFAULT 'texto',
      enviado_em DATETIME DEFAULT (datetime('now'))
    );
  `);

  const count = query('SELECT COUNT(*) as total FROM mesas');
  if (!count[0] || count[0].total === 0) {
    const mesas = [
      { nome: 'Mesa do Canto',   descricao: 'Só observando por enquanto',          cap: 4, icone: '👀' },
      { nome: 'Buildando Algo',  descricao: 'Mostre o que você está construindo',   cap: 6, icone: '🛠️' },
      { nome: 'Preciso de Ajuda',descricao: 'Travou? A galera resolve junto',       cap: 4, icone: '🤝' },
      { nome: 'Papo Livre',      descricao: 'Sem pauta, só conversa',               cap: 6, icone: '💬' },
    ];
    mesas.forEach(m => {
      run('INSERT INTO mesas (nome,descricao,capacidade,icone) VALUES (?,?,?,?)', [m.nome,m.descricao,m.cap,m.icone]);
      const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
      for (let i = 0; i < m.cap; i++) run('INSERT INTO assentos (mesa_id) VALUES (?)', [id]);
    });
  }

  save();
  return db;
}

function save() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function query(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
  const res = db.exec('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: res[0]?.values[0][0] };
}

module.exports = { init, query, queryOne, run };
