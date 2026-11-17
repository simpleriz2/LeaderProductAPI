// This test profile permits ONLY the owned loopback PostgreSQL port. No HTTP/1C/Redis/S3 traffic.
const net=require('node:net');const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const first=args[0];const options=typeof first==='object'?first:{port:first,host:args[1]};if(options?.host!=='127.0.0.1'||Number(options.port)!==54329)throw Error('Non-fixture network is disabled');return Reflect.apply(original,this,args);};
for(const protocol of ['node:http','node:https']){const module=require(protocol);module.request=module.get=()=>{throw Error('HTTP network is disabled in PostgreSQL policy tests');};}
globalThis.fetch=async()=>{throw Error('Fetch is disabled in PostgreSQL policy tests');};
