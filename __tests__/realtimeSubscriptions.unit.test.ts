import {registerAuthorizedSubscriptions} from '../src/services/realtimeSubscriptions';
function fixture(){const events=new Map<string,Function>();const rooms=new Set(['socket-id']);const socket={connected:true,data:{user:{exp:Math.floor(Date.now()/1000)+60}},rooms,on:(name:string,fn:Function)=>events.set(name,fn),join:jest.fn(async(room:string)=>{rooms.add(room);}),leave:jest.fn()};const policy={room:jest.fn(async()=>true),presence:jest.fn(async(_:number,ids:readonly number[])=>[...ids])};registerAuthorizedSubscriptions(socket as any,1,policy);return {socket,policy,events};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('denied/failed subscriptions never join and return safe acknowledgements',async()=>{
  const f=fixture();const ack=jest.fn();f.policy.room.mockResolvedValue(false);f.events.get('join')!('appeal:9',ack);await flush();expect(f.socket.join).not.toHaveBeenCalled();expect(ack).toHaveBeenCalledWith({ok:false,code:'FORBIDDEN'});
  f.policy.room.mockRejectedValue(Error('private database details'));f.events.get('join')!('appeal:9',ack);await flush();expect(ack).toHaveBeenCalledWith({ok:false,code:'UNAVAILABLE'});expect(f.socket.join).not.toHaveBeenCalled();
});
test('late authorization after disconnect/expiry cannot join',async()=>{
  const f=fixture();f.socket.connected=false;f.events.get('join')!('appeal:2');await flush();expect(f.socket.join).not.toHaveBeenCalled();
  f.socket.connected=true;f.socket.data.user.exp=1;f.events.get('presence:subscribe')!({userIds:[2]});await flush();expect(f.socket.join).not.toHaveBeenCalled();
});
test('presence rejects oversized payload and only joins authorized requested ids',async()=>{
  const f=fixture();f.policy.presence.mockResolvedValue([2,999]);f.events.get('presence:subscribe')!({userIds:[2,3]});await flush();expect(f.socket.join).toHaveBeenCalledTimes(1);expect(f.socket.join).toHaveBeenCalledWith('presence:2');
  f.events.get('presence:subscribe')!({userIds:Array(101).fill(2)});await flush();expect(f.policy.presence).toHaveBeenCalledTimes(1);
});
test('limits concurrent authorization work and total rooms',async()=>{
  const f=fixture();const ack=jest.fn();const releases:Array<()=>void>=[];f.policy.room.mockImplementation(()=>new Promise(resolve=>{releases.push(()=>resolve(true));}));
  for(let i=0;i<129;i++)f.events.get('join')!(`appeal:${i+1}`,ack);expect(f.policy.room).toHaveBeenCalledTimes(4);expect(ack).toHaveBeenCalledWith({ok:false,code:'BUSY'});
  while(releases.length){releases.splice(0).forEach(release=>release());await flush();}
  const capped=fixture();for(let i=0;i<128;i++)capped.socket.rooms.add(`appeal:${i+1}`);capped.events.get('join')!('appeal:999',ack);await flush();expect(capped.socket.join).not.toHaveBeenCalled();
});
