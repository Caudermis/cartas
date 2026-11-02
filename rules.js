'use strict';
const crypto=require('crypto');
/* ================= REGLAS (reductor puro: se ejecuta dentro de un bloqueo de sala) =================
 AJUSTES: cambia aquí las dos reglas que quedaron abiertas.
 CLOSE_RULE 'lastTurn': al plantarse el primero, cada rival que siga jugando hace un último turno; 'allPlanted': solo cierra cuando todos estén plantados.
 ABILITY_QD: la carta 11/12 usada va al descarte y abre descarte rápido para todos (true) o no (false). QD_ON_REPLACE: la carta que sueltas de tu mano al sustituir abre descarte rápido solo para tus rivales.
 END_AT: la ronda en la que alguien empieza con este número de cartas es la última. Todos empiezan con 4 y solo el ganador de cada ronda suma una carta. */
const CFG={CLOSE_RULE:'lastTurn',ABILITY_QD:true,QD_ON_REPLACE:true,QD_MS:4000,END_AT:10};
const num=c=>(c>>2)+1,sui=c=>c&3,val=c=>{const n=num(c);return n==2?-1:n==10?0:n};
const SU=['Oros','Copas','Espadas','Bastos'],SC=['#c99100','#c0392b','#2c5aa0','#2e7d32'];
const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const nm=(S,id)=>(S.players.find(p=>p.id==id)||{}).name||'?';
const lg=(S,t)=>{S.log=(S.log||[]).concat(t).slice(-6)};
const ev=(S,t)=>{S.ev={n:Math.random(),t};lg(S,t)};
function recycle(S){if(S.deck.length)return true;if(S.disc.length<2)return false;const top=S.disc.pop();S.deck=shuf(S.disc);S.disc=[top];return true}
function deal(S,st){const d=shuf([...Array(48).keys()]);S.hands={};S.allow={};S.players.forEach(p=>{const n=S.size[p.id];S.hands[p.id]=d.splice(0,n);S.allow[p.id]=Math.floor(n/2)});
 Object.assign(S,{deck:d,disc:[],phase:'peek',peeks:{},ready:{},planted:{},last:null,dec:null,qd:null,held:null,p12:null,turn:null,sub:null,start:st,ti:S.players.findIndex(p=>p.id==st)});lg(S,'Ronda '+S.round+': empieza '+nm(S,st))}
function next(S){const n=S.players.length;for(let k=1;k<=n;k++){const i=(S.ti+k)%n,p=S.players[i];if(!S.planted[p.id]){S.ti=i;S.turn=p.id;S.sub='draw';S.held=null;return}}S.turn=null;S.sub='wait'}
function close(S){S.phase='reveal';S.turn=null;S.sub=null;const sc={};S.players.forEach(p=>sc[p.id]=S.hands[p.id].reduce((a,c)=>a+val(c),0));let w=S.players[0].id;S.players.forEach(p=>{if(sc[p.id]<sc[w])w=p.id});S.winner=w;(S.rounds=S.rounds||[]).push({r:S.round,n:Object.assign({},S.size),sc,w});lg(S,'Ronda '+S.round+' terminada: gana '+nm(S,w))}
function chk(S){const all=S.players.every(p=>S.planted[p.id]),ok=all||(CFG.CLOSE_RULE=='lastTurn'&&S.last&&S.last.left.length==0);
 if(ok){if(S.dec){S.turn=null;S.sub='wait';return}close(S)}else if(!S.turn||S.planted[S.turn]||S.sub=='wait')next(S)}
function endTurn(S){if(S.last)S.last.left=S.last.left.filter(x=>x!=S.turn);S.held=null;S.p12=null;S.turn=null;S.sub='wait';chk(S)}
const newSizes=S=>{S.size={};S.players.forEach(p=>S.size[p.id]=4);S.final=false;S.winner=null};
const openQD=(S,pid,n,ex)=>{S.qd={n,by:pid,ex:ex||null,until:Date.now()+CFG.QD_MS,done:false,tried:[]}};
const my=(S,pid)=>S.phase=='play'&&S.turn==pid;
const ACT={
join:(S,p,a)=>{if(S.players.some(x=>x.id==p))return;if(S.phase!='lobby')return'La partida ya ha empezado o terminó';if(S.players.length>=4)return'La sala está llena (4/4)';S.players.push({id:p,name:a.name})},
start:(S,p)=>{if(S.host!=p||S.phase!='lobby')return'Solo el anfitrión puede iniciar';if(S.players.length<2)return'Hacen falta al menos 2 jugadores';S.round=1;S.rounds=[];newSizes(S);deal(S,S.players[Math.floor(Math.random()*S.players.length)].id)},
peek:(S,p,a,out)=>{if(S.phase!='peek')return'No es la fase de mirar';if(S.hands[p][a.i]===undefined)return'Carta no válida';if((S.peeks[p]||0)>=S.allow[p])return'Ya has mirado todas las cartas permitidas ('+S.allow[p]+')';S.peeks[p]=(S.peeks[p]||0)+1;out.card=S.hands[p][a.i]},
ready:(S,p)=>{if(S.phase!='peek')return;S.ready[p]=true;if(S.players.every(x=>S.ready[x.id])){S.phase='play';S.turn=S.start;S.sub='draw';lg(S,'Empieza '+nm(S,S.start))}},
draw:(S,p)=>{if(!my(S,p)||S.sub!='draw')return'No puedes robar ahora';if(!recycle(S)){lg(S,'No quedan cartas para robar: '+nm(S,p)+' pasa');endTurn(S);return}S.held=S.deck.pop();S.sub='drawn'},
replace:(S,p,a)=>{if(!my(S,p)||S.sub!='drawn')return'Acción no válida';const h=S.hands[p];if(h[a.i]===undefined)return'Carta no válida';const old=h[a.i];h[a.i]=S.held;S.disc.push(old);if(CFG.QD_ON_REPLACE)openQD(S,p,num(old),p);lg(S,nm(S,p)+' sustituyó una carta');endTurn(S)},
discard:(S,p)=>{if(!my(S,p)||S.sub!='drawn')return'Acción no válida';const c=S.held;S.disc.push(c);openQD(S,p,num(c));lg(S,nm(S,p)+' descartó un '+num(c));endTurn(S)},
use11:(S,p)=>{if(!my(S,p)||S.sub!='drawn'||num(S.held)!=11)return'Solo un 11 recién robado tiene habilidad';S.disc.push(S.held);if(CFG.ABILITY_QD)openQD(S,p,11);S.held=null;S.sub='a11';lg(S,nm(S,p)+' usa el 11: mira una carta propia')},
look11:(S,p,a,out)=>{if(!my(S,p)||S.sub!='a11')return'Acción no válida';if(S.hands[p][a.i]===undefined)return'Carta no válida';out.card=S.hands[p][a.i];endTurn(S)},
use12:(S,p)=>{if(!my(S,p)||S.sub!='drawn'||num(S.held)!=12)return'Solo un 12 recién robado tiene habilidad';S.disc.push(S.held);if(CFG.ABILITY_QD)openQD(S,p,12);S.held=null;S.sub='a12a';lg(S,nm(S,p)+' usa el 12')},
pick12:(S,p,a,out)=>{if(!my(S,p)||S.sub!='a12a')return'Acción no válida';if(a.rp==p||!S.hands[a.rp]||S.hands[a.rp][a.ri]===undefined)return'Elige una carta de un rival';S.p12={rp:a.rp,ri:a.ri,c:S.hands[a.rp][a.ri]};S.sub='a12b';out.card=S.p12.c},
swap12:(S,p,a,out)=>{if(!my(S,p)||S.sub!='a12b')return'Acción no válida';const q=S.p12,h=S.hands[p];if(h[a.i]===undefined)return'Carta no válida';if(S.hands[q.rp][q.ri]!==q.c){S.sub='a12a';S.p12=null;out.msg='Esa carta ya no está, elige otra';return}
 const t=h[a.i];h[a.i]=q.c;S.hands[q.rp][q.ri]=t;lg(S,nm(S,p)+' intercambió una carta con '+nm(S,q.rp));if(S.planted[q.rp])S.dec=q.rp;endTurn(S)},
quick:(S,p,a)=>{const q=S.qd;if(S.phase!='play'||!q||q.done||Date.now()>q.until)return'La ventana de descarte rápido está cerrada';if(q.ex==p)return'No puedes descartar rápido una carta que acabas de soltar de tu mano';if(S.turn==p&&S.sub=='drawn')return'Decide primero qué haces con la carta robada';if(q.tried.includes(p))return'Ya has intentado este descarte';const h=S.hands[p],c=h[a.i];if(c===undefined)return'Carta no válida';q.tried.push(p);
 if(num(c)==q.n){h.splice(a.i,1);S.disc.push(c);q.done=true;ev(S,nm(S,p)+' hizo descarte rápido de un '+q.n)}else{if(recycle(S))h.push(S.deck.pop());ev(S,'Intento incorrecto de '+nm(S,p)+': recibe una carta de penalización')}},
plant:(S,p)=>{if(S.phase!='play'||S.planted[p])return;if(S.turn==p&&S.sub!='draw')return'Termina tu jugada antes de plantarte';S.planted[p]=true;if(!S.last)S.last={by:p,left:S.players.filter(x=>x.id!=p&&!S.planted[x.id]).map(x=>x.id)};else S.last.left=S.last.left.filter(x=>x!=p);lg(S,nm(S,p)+' se planta');chk(S)},
unplant:(S,p)=>{if(S.phase!='play'||!S.planted[p])return;delete S.planted[p];if(S.dec==p)S.dec=null;if(!Object.keys(S.planted).length)S.last=null;else if(S.last&&!S.last.left.includes(p))S.last.left.push(p);lg(S,nm(S,p)+' vuelve a jugar');chk(S)},
keep:(S,p)=>{if(S.dec!=p)return;S.dec=null;chk(S)},
nextround:(S,p)=>{if(S.host!=p||S.phase!='reveal')return'Solo el anfitrión';if(S.final){S.phase='over';return}S.size[S.winner]++;S.round++;if(Math.max(...Object.values(S.size))>=CFG.END_AT)S.final=true;deal(S,S.winner)},
newgame:(S,p)=>{if(S.host!=p||S.phase!='over')return'Solo el anfitrión';S.round=1;S.rounds=[];newSizes(S);deal(S,S.players[Math.floor(Math.random()*S.players.length)].id)},
lobby:(S,p)=>{if(S.host!=p||S.phase!='over')return'Solo el anfitrión';Object.assign(S,{phase:'lobby',round:0,rounds:[],turn:null,qd:null})}};

// Vista filtrada: cada jugador solo recibe lo que tiene derecho a saber.
// Las cartas de las manos viajan como null (también las propias) hasta el final de la ronda; las que se miran
// legítimamente llegan solo en la respuesta de esa acción. El mazo nunca se envía.
function view(S,pid,on){
 const open=S.phase=='reveal'||S.phase=='over',v={now:Date.now(),me:pid,code:S.code,host:S.host,phase:S.phase,round:S.round,size:S.size||{},final:!!S.final,seq:S.seq,
  players:S.players.map(p=>({id:p.id,name:p.name,on:!!(on&&on[p.id])})),turn:S.turn,sub:S.sub,planted:S.planted||{},last:S.last||null,dec:S.dec||null,
  peeks:S.peeks||{},ready:S.ready||{},allow:S.allow||{},rounds:S.rounds||[],winner:S.winner,log:S.log||[],ev:S.ev||null,start:S.start,
  deckN:S.deck?S.deck.length:0,discN:S.disc?S.disc.length:0,discTop:S.disc&&S.disc.length?S.disc[S.disc.length-1]:null,qd:S.qd||null,chat:(S.chat||[]).slice(-80),hands:{}};
 for(const p of S.players){const h=(S.hands&&S.hands[p.id])||[];v.hands[p.id]=open?h.slice():h.map(()=>null)}
 if(S.turn==pid&&S.phase=='play'){v.held=S.held==null?null:S.held;if(S.p12)v.p12={rp:S.p12.rp,ri:S.p12.ri,c:S.p12.c}}
 return v}
module.exports={ACT,CFG,view,num,val,deal};
