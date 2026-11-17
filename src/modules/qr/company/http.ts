import type {IncomingMessage,ServerResponse} from 'node:http';
import {normalizeAndValidate,assertQrType} from '../content';
import {createCompanyQrRepository,QrRepositoryError,type CompanyActor,type QrContent,type QrStatus} from './repository';
export type CompanyOnlineIdentity=CompanyActor&{active:boolean;audience:string;api:string;releaseId:string};
type Ports={company:string;authorizeOnline(req:IncomingMessage):Promise<CompanyOnlineIdentity>;supportedApis():ReadonlySet<string>};
const reply=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new QrRepositoryError(400,'Invalid QR command');return value as Record<string,unknown>;
}
async function body(req:IncomingMessage):Promise<unknown>{
 if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new QrRepositoryError(415,'JSON required');
 const buffers:Buffer[]=[];let size=0;for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>256*1024)throw new QrRepositoryError(413,'QR command too large');buffers.push(bytes);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(buffers)));}catch{throw new QrRepositoryError(400,'Invalid JSON');}
}
function qrType(value:unknown){try{if(typeof value!=='string')throw Error('type');assertQrType(value);return value;}catch{throw new QrRepositoryError(400,'Invalid QR type');}}
function qrContent(input:Record<string,unknown>):QrContent{
 try{const type=qrType(input.qrType);return{qrType:type,qrData:normalizeAndValidate(type,input.qrData),description:input.description===undefined?null:input.description as string|null};}catch{throw new QrRepositoryError(400,'Invalid QR payload');}
}
/** Mount in ONE Company API. The callback performs live Central introspection on EVERY request. */
export function createCompanyQrHttpHandler(repository:ReturnType<typeof createCompanyQrRepository>,ports:Ports){
 if(!ports.authorizeOnline||!ports.supportedApis)throw Error('Company live authorization ports required');
 return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
  if(!/^\/qr(?:\/|\?|$)/.test(req.url||''))return false;
  try{
   let actor:CompanyOnlineIdentity;try{actor=await ports.authorizeOnline(req);}catch{reply(res,503,{error:'Central unavailable'});return true;}
   if(!actor?.active||actor.company!==ports.company||actor.audience!==`company:${ports.company}`){reply(res,401,{error:'Unauthorized'});return true;}
   if(!ports.supportedApis().has(actor.api)){reply(res,409,{error:'API contract retired; update required'});return true;}
   const url=new URL(req.url!,'http://127.0.0.1'),parts=url.pathname.split('/').filter(Boolean);const documentId=parts[1];
   if(req.method==='GET'&&parts.length===1){
    if([...url.searchParams.keys()].some(key=>!['limit','after'].includes(key))||[...new Set(url.searchParams.keys())].some(key=>url.searchParams.getAll(key).length>1))throw new QrRepositoryError(400,'Invalid QR page');
    const raw=url.searchParams.get('limit');if(raw!==null&&!/^[1-9][0-9]{0,2}$/.test(raw))throw new QrRepositoryError(400,'Invalid QR page');
    const limit=raw===null?100:Number(raw),page=await repository.list(actor,limit,url.searchParams.get('after')??undefined);reply(res,200,page);return true;
   }
   if(req.method==='GET'&&parts.length===2&&!url.search){reply(res,200,{document:await repository.get(actor,documentId)});return true;}
   if(req.method==='POST'&&parts.length===1&&!url.search){const input=object(await body(req),['operationId','qrType','qrData','description']);reply(res,201,{document:await repository.create(actor,qrContent(input),input.operationId as string)});return true;}
   if(req.method==='PUT'&&parts.length===2&&!url.search){
    const input=object(await body(req),['expectedRevision','qrType','qrData','description']);const patch:Partial<Omit<QrContent,'qrData'>>&{qrData?:unknown}={};
    if(Object.prototype.hasOwnProperty.call(input,'qrType')){patch.qrType=qrType(input.qrType);}
    // Current stored type is applied to this raw payload inside the domain transaction if type is omitted.
    if(Object.prototype.hasOwnProperty.call(input,'qrData')){if(typeof input.qrData!=='string'&&(!input.qrData||typeof input.qrData!=='object'||Array.isArray(input.qrData)))throw new QrRepositoryError(400,'Invalid partial QR data');patch.qrData=input.qrData;}
    if(Object.prototype.hasOwnProperty.call(input,'description'))patch.description=input.description as string|null;
    if(!Object.keys(patch).length)throw new QrRepositoryError(400,'Empty QR patch');
    reply(res,200,{document:await repository.update(actor,documentId,input.expectedRevision as number,patch)});return true;
   }
   if(!url.search&&((req.method==='DELETE'&&parts.length===2)||(req.method==='PUT'&&parts.length===3&&['status','restore'].includes(parts[2])))){
    const input=object(await body(req),parts[2]==='status'?['expectedRevision','status']:['expectedRevision']);const expected=input.expectedRevision as number;
    const document=parts[2]==='restore'?await repository.restore(actor,documentId,expected):await repository.setStatus(actor,documentId,expected,req.method==='DELETE'?'DELETED':input.status as QrStatus);reply(res,200,{document});return true;
   }
   reply(res,404,{error:'QR route not found'});
  }catch(error){reply(res,error instanceof QrRepositoryError?error.status:500,{error:error instanceof QrRepositoryError?error.message:'QR operation failed'});}
  return true;
 };
}
