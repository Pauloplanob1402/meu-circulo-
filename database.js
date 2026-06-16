// Banco em memória simples — funciona em qualquer servidor sem instalação
let dados = {
  usuarios: [],
  mesas: [
    { id:1, nome:'Mesa do Canto',    descricao:'Só observando por enquanto',        capacidade:4, icone:'👀' },
    { id:2, nome:'Buildando Algo',   descricao:'Mostre o que você está construindo', capacidade:6, icone:'🛠️' },
    { id:3, nome:'Preciso de Ajuda', descricao:'Travou? A galera resolve junto',     capacidade:4, icone:'🤝' },
    { id:4, nome:'Papo Livre',       descricao:'Sem pauta, só conversa',             capacidade:6, icone:'💬' },
  ],
  assentos: [],
  mensagens: [],
  nextId: { usuario:1, assento:1, mensagem:1 }
};

// Criar assentos para cada mesa
dados.mesas.forEach(m => {
  for(let i=0;i<m.capacidade;i++){
    dados.assentos.push({ id: dados.nextId.assento++, mesa_id: m.id, usuario_id: null });
  }
});

const db = {
  getUsuario(email) { return dados.usuarios.find(u=>u.email===email)||null; },
  getUsuarioPorId(id) { return dados.usuarios.find(u=>u.id===id)||null; },
  criarUsuario(nome,email,senha,perfil) {
    if(dados.usuarios.find(u=>u.email===email)) throw new Error('UNIQUE');
    const u={id:dados.nextId.usuario++,nome,email,senha,perfil:perfil||'builder'};
    dados.usuarios.push(u);
    return u;
  },
  getMesas() {
    return dados.mesas.map(m=>({
      ...m,
      assentos: dados.assentos.filter(a=>a.mesa_id===m.id).map(a=>({
        ...a,
        nome: a.usuario_id ? (dados.usuarios.find(u=>u.id===a.usuario_id)||{}).nome : null
      }))
    }));
  },
  getAssento(id) { return dados.assentos.find(a=>a.id===id)||null; },
  sentarAssento(assentoId, usuarioId) {
    const a=dados.assentos.find(a=>a.id===assentoId);
    if(a) a.usuario_id=usuarioId;
  },
  levantarAssento(assentoId) {
    const a=dados.assentos.find(a=>a.id===assentoId);
    if(a) a.usuario_id=null;
  },
  addMensagem(usuario_id,mesa_id,conteudo,tipo) {
    const m={id:dados.nextId.mensagem++,usuario_id,mesa_id:mesa_id||null,conteudo,tipo:tipo||'texto',enviado_em:new Date().toISOString()};
    dados.mensagens.push(m);
    if(dados.mensagens.length>500) dados.mensagens=dados.mensagens.slice(-500);
    return m;
  },
  getMensagens(mesa_id) {
    const msgs = mesa_id===null
      ? dados.mensagens.filter(m=>m.mesa_id===null)
      : dados.mensagens.filter(m=>m.mesa_id===mesa_id);
    return msgs.slice(-50).map(m=>({
      ...m,
      autor: (dados.usuarios.find(u=>u.id===m.usuario_id)||{nome:'?'}).nome,
      autor_perfil: (dados.usuarios.find(u=>u.id===m.usuario_id)||{perfil:''}).perfil
    }));
  }
};

module.exports = db;
