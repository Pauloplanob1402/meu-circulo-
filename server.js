const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const SECRET = process.env.JWT_SECRET || 'meucirculo2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function hash(s) { return crypto.createHash('sha256').update(s+SECRET).digest('hex'); }

function makeToken(u) {
  const h=Buffer.from('{"alg":"HS256"}').toString('base64url');
  const b=Buffer.from(JSON.stringify({id:u.id,nome:u.nome,perfil:u.perfil})).toString('base64url');
  const s=crypto.createHmac('sha256',SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

function verifyToken(tk) {
  try {
    const [h,b,s]=tk.split('.');
    const check=crypto.createHmac('sha256',SECRET).update(`${h}.${b}`).digest('base64url');
    if(s!==check) return null;
    return JSON.parse(Buffer.from(b,'base64url').toString());
  } catch { return null; }
}

// ── REST ──
app.post('/api/cadastro',(req,res)=>{
  const {nome,email,senha,perfil}=req.body;
  if(!nome||!email||!senha) return res.status(400).json({erro:'Campos obrigatórios'});
  try {
    const u=db.criarUsuario(nome.trim(),email.trim().toLowerCase(),hash(senha),perfil);
    res.json({token:makeToken(u),usuario:{id:u.id,nome:u.nome,perfil:u.perfil}});
  } catch(e) {
    if(e.message.includes('UNIQUE')) return res.status(409).json({erro:'E-mail já cadastrado'});
    res.status(500).json({erro:'Erro interno'});
  }
});

app.post('/api/login',(req,res)=>{
  const {email,senha}=req.body;
  const u=db.getUsuario(email?.trim().toLowerCase());
  if(!u||u.senha!==hash(senha)) return res.status(401).json({erro:'E-mail ou senha incorretos'});
  res.json({token:makeToken(u),usuario:{id:u.id,nome:u.nome,perfil:u.perfil}});
});

app.get('/api/mesas',(req,res)=>res.json(db.getMesas()));

app.get('/api/mensagens/:tipo',(req,res)=>{
  const id=req.params.tipo==='geral'?null:parseInt(req.params.tipo);
  res.json(db.getMensagens(id));
});

// ── WebSocket ──
const clientes = new Map();

function broadcast(data,skip=null){
  const m=JSON.stringify(data);
  wss.clients.forEach(ws=>{if(ws!==skip&&ws.readyState===WebSocket.OPEN)ws.send(m);});
}

function broadcastMesa(mesaId,data){
  const m=JSON.stringify(data);
  clientes.forEach((info,ws)=>{
    if(ws.readyState===WebSocket.OPEN&&info.mesaId===mesaId)ws.send(m);
  });
}

function estado(){
  const online=[];
  clientes.forEach(i=>{if(i.usuario)online.push({id:i.usuario.id,nome:i.usuario.nome,perfil:i.usuario.perfil,mesaId:i.mesaId});});
  return {tipo:'estado',mesas:db.getMesas(),online};
}

wss.on('connection',ws=>{
  clientes.set(ws,{usuario:null,assentoId:null,mesaId:null});

  ws.on('message',raw=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    const info=clientes.get(ws);

    if(msg.tipo==='auth'){
      const p=verifyToken(msg.token);
      if(!p) return ws.send(JSON.stringify({tipo:'erro',msg:'Token inválido'}));
      const u=db.getUsuarioPorId(p.id);
      if(!u) return ws.send(JSON.stringify({tipo:'erro',msg:'Usuário não encontrado'}));
      clientes.set(ws,{...info,usuario:u});
      ws.send(JSON.stringify(estado()));
      broadcast({tipo:'entrou',usuario:{id:u.id,nome:u.nome,perfil:u.perfil}},ws);
    }

    else if(msg.tipo==='sentar'){
      if(!info.usuario) return;
      const assento=db.getAssento(msg.assentoId);
      if(!assento||assento.usuario_id) return ws.send(JSON.stringify({tipo:'erro',msg:'Assento ocupado'}));
      if(info.assentoId) db.levantarAssento(info.assentoId);
      db.sentarAssento(msg.assentoId,info.usuario.id);
      clientes.set(ws,{...info,assentoId:msg.assentoId,mesaId:assento.mesa_id});
      broadcast(estado());
    }

    else if(msg.tipo==='levantar'){
      if(!info.assentoId) return;
      db.levantarAssento(info.assentoId);
      clientes.set(ws,{...info,assentoId:null,mesaId:null});
      broadcast(estado());
    }

    else if(msg.tipo==='mensagem'){
      if(!info.usuario||!msg.conteudo?.trim()) return;
      const conteudo=msg.conteudo.trim().slice(0,500);
      const mesa_id=msg.mesa_id||null;
      const m=db.addMensagem(info.usuario.id,mesa_id,conteudo,msg.tipo_msg||'texto');
      const payload={tipo:'mensagem',mesa_id,conteudo,tipo_msg:m.tipo,
        autor:info.usuario.nome,autor_id:info.usuario.id,perfil:info.usuario.perfil,
        enviado_em:m.enviado_em};
      if(mesa_id){broadcastMesa(mesa_id,payload);ws.send(JSON.stringify(payload));}
      else broadcast(payload);
    }
  });

  ws.on('close',()=>{
    const info=clientes.get(ws);
    if(info?.assentoId) db.levantarAssento(info.assentoId);
    if(info?.usuario) broadcast({tipo:'saiu',usuario:info.usuario});
    clientes.delete(ws);
    broadcast(estado());
  });
});

server.listen(PORT,()=>console.log(`🟣 Meu Círculo em http://localhost:${PORT}`));
