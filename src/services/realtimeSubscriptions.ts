import type { Socket } from 'socket.io';
type Policy = { room(userId:number, room:unknown):Promise<boolean>; presence(userId:number, ids:readonly number[]):Promise<number[]> };
export function registerAuthorizedSubscriptions(socket: Socket, userId: number, policy: Policy) {
  const answer=(ack:unknown,value:unknown)=>{try{if(typeof ack==='function')ack(value);}catch{/* Closed transport acknowledgement. */}};
  let active=0;
  const queue:Array<()=>Promise<void>>=[];
  const pump=()=>{while(active<4&&queue.length){const work=queue.shift()!;active++;void work().finally(()=>{active--;pump();});}};
  const guarded=(work:()=>Promise<void>,ack?:unknown)=>{
    const reply=(value:unknown)=>answer(ack,value);
    if(active+queue.length>=128){reply({ok:false,code:'BUSY'});return;}
    queue.push(async()=>{try{await work();}catch{reply({ok:false,code:'UNAVAILABLE'});}});pump();
  };
  const live=()=>socket.connected && (!socket.data.user?.exp || Date.now()<socket.data.user.exp*1000);
  socket.on('join',(room:unknown,ack?:unknown)=>{
    if(typeof room!=='string'||room.length>128||!/^(user|department|appeal):[1-9][0-9]*$/.test(room)){answer(ack,{ok:false,code:'FORBIDDEN'});return;}
    void guarded(async()=>{
    if(!live())return;
    const allowed=await policy.room(userId,room);
    if(!live()||!allowed||socket.rooms.size>=128){answer(ack,{ok:false,code:'FORBIDDEN'});return;}
    await socket.join(room as string);answer(ack,{ok:true});
  },ack);});
  socket.on('leave',(room:unknown)=>{if(typeof room==='string'&&room.length<=128&&/^(user|department|appeal):[1-9][0-9]*$/.test(room))void socket.leave(room);});
  socket.on('presence:subscribe',(payload:unknown,ack?:unknown)=>{
    const raw=Array.isArray(payload)?payload:(payload as any)?.userIds;
    if(!Array.isArray(raw)||raw.length>100){answer(ack,{ok:false,code:'INVALID_SUBSCRIPTION'});return;}
    void guarded(async()=>{
    if(!live())return;
    const ids=[...new Set(raw.filter(id=>Number.isSafeInteger(id)&&id>0))] as number[];
    const allowed=await policy.presence(userId,ids);
    if(!live())return;
    for(const id of allowed){if(!ids.includes(id)||socket.rooms.size>=128)continue;await socket.join(`presence:${id}`);}
    answer(ack,{ok:true});
  },ack);});
}
