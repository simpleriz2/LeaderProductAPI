const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const {Server}=require('socket.io');const WebSocket=require('ws');
const {registerAuthorizedSubscriptions}=require('../../src/services/realtimeSubscriptions.ts');
test('actual loopback Socket.IO transport refuses foreign rooms and filters presence',async t=>{
  const server=http.createServer();const io=new Server(server);let ws;let connected;
  io.on('connection',socket=>{connected=socket;socket.data.user={userId:1,exp:Math.floor(Date.now()/1000)+60};registerAuthorizedSubscriptions(socket,1,{room:async(_,room)=>room==='user:1'||room==='appeal:5',presence:async(_,ids)=>ids.filter(id=>id===2)});});
  t.after(async()=>{ws?.terminate();await new Promise(resolve=>io.close(resolve));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let serial=0;const waiting=new Map();
  await new Promise((resolve,reject)=>{
    ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);ws.on('error',reject);
    ws.on('message',data=>{const packet=String(data);if(packet.startsWith('0'))ws.send('40');else if(packet.startsWith('40'))resolve();else if(packet==='2')ws.send('3');else if(packet.startsWith('43')){const match=/^43(\d+)(.*)$/.exec(packet);const callback=waiting.get(Number(match[1]));waiting.delete(Number(match[1]));callback?.(JSON.parse(match[2])[0]);}});
  });
  async function ack(event,payload){const id=serial++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket acknowledgement timeout')),2000);waiting.set(id,value=>{clearTimeout(timer);resolve(value);});ws.send(`42${id}${JSON.stringify([event,payload])}`);});}
  assert.deepEqual(await ack('join','user:999'),{ok:false,code:'FORBIDDEN'});
  assert.deepEqual(await ack('join','help:user:1'),{ok:false,code:'FORBIDDEN'});
  assert.deepEqual(await ack('join','department:999'),{ok:false,code:'FORBIDDEN'});
  assert.deepEqual(await ack('join','appeal:5'),{ok:true});assert.equal(connected.rooms.has('appeal:5'),true);assert.equal(connected.rooms.has('user:999'),false);
  assert.deepEqual(await ack('presence:subscribe',{userIds:[2,3]}),{ok:true});assert.equal(connected.rooms.has('presence:2'),true);assert.equal(connected.rooms.has('presence:3'),false);
});
