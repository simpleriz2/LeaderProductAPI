import {normalizeAndValidate,assertQrType} from '../content';
import type {Pool,PoolClient} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
export type CompanyActor={company:string;user:string;modules:readonly string[];permissions:Readonly<Record<string,readonly string[]>>};
export type QrContent={qrType:'PHONE'|'LINK'|'EMAIL'|'TEXT'|'WHATSAPP'|'TELEGRAM'|'CONTACT';qrData:string;description:string|null};
export type QrStatus='ACTIVE'|'PAUSED'|'DELETED';
export type CompanyQrDocument=QrContent&{id:string;status:QrStatus;revision:number};
export class QrRepositoryError extends Error{constructor(readonly status:number,message:string){super(message);}}
const id=(value:string)=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const uuid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function content(value:QrContent):QrContent{
 if(!value||!['PHONE','LINK','EMAIL','TEXT','WHATSAPP','TELEGRAM','CONTACT'].includes(value.qrType)||typeof value.qrData!=='string'||Buffer.byteLength(value.qrData)>131072||(value.description!==null&&(typeof value.description!=='string'||Buffer.byteLength(value.description)>8192)))throw new QrRepositoryError(400,'Invalid bounded QR content');
 if(value.qrData.includes('\u0000')||value.description?.includes('\u0000')||Buffer.from(value.qrData).toString('utf8')!==value.qrData||(value.description!==null&&Buffer.from(value.description).toString('utf8')!==value.description))throw new QrRepositoryError(400,'Invalid QR text');
 return{qrType:value.qrType,qrData:value.qrData,description:value.description};
}
function normalized(value:Omit<QrContent,'qrData'>&{qrData:unknown}):QrContent{try{assertQrType(value.qrType);return content({...value,qrData:normalizeAndValidate(value.qrType,value.qrData)});}catch{throw new QrRepositoryError(400,'Invalid QR payload');}}
const columns='id, qr_type, qr_data, description, status, revision';
function decode(row:any):CompanyQrDocument{
 if(!row||!uuid(row.id)||!['ACTIVE','PAUSED','DELETED'].includes(row.status))throw Error('Invalid stored QR document');
 const revision=Number(row.revision);if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid stored QR revision');
 return{...content({qrType:row.qr_type,qrData:row.qr_data,description:row.description}),id:row.id,status:row.status,revision};
}
/** Company composition supplies ONLY a live Central-introspected actor. This is not a JWT verifier. */
export function createCompanyQrRepository(pool:Pool,company:string){
 if(!id(company))throw Error('Invalid Company identity');
 async function authorized<T>(actor:CompanyActor,action:string,work:(client:PoolClient,owner:string)=>Promise<T>):Promise<T>{
  if(actor.company!==company||!id(actor.user)||!actor.modules.includes('qr')||!actor.permissions.qr?.includes(action))throw new QrRepositoryError(403,'QR action denied');
  const centralUser=actor.user;
  const client=await pool.connect();try{
   await client.query('BEGIN');
   try{
    const versions=await client.query("SELECT owner,version FROM lp2_company.schema_versions WHERE owner IN ('identity','qr')");
    if(versions.rowCount!==2||versions.rows.some(row=>row.version!==(row.owner==='qr'?2:1)))throw Error('Unsupported Company QR schema');
    const mapping=await client.query('SELECT local_user FROM lp2_company.subjects WHERE company=$1 AND central_user=$2 AND active=true FOR SHARE',[company,centralUser]);
    if(!mapping.rowCount)throw new QrRepositoryError(403,'Company subject mapping denied');
    const result=await work(client,mapping.rows[0].local_user);await client.query('COMMIT');return result;
   }catch(error){await client.query('ROLLBACK');throw error;}
  }finally{client.release();}
 }
 const validDocument=(documentId:string)=>{if(!uuid(documentId))throw new QrRepositoryError(400,'Invalid QR id');};
 const revision=(expected:number)=>{if(!Number.isSafeInteger(expected)||expected<1)throw new QrRepositoryError(400,'Invalid QR revision');};
 async function locked(client:PoolClient,owner:string,documentId:string){
  validDocument(documentId);const found=await client.query(`SELECT ${columns} FROM lp2_company.qr_documents WHERE company=$1 AND id=$2 AND owner=$3 FOR UPDATE`,[company,documentId,owner]);
  if(!found.rowCount)throw new QrRepositoryError(404,'QR not found');return decode(found.rows[0]);
 }
 return Object.freeze({
  async create(actor:CompanyActor,input:QrContent,operationId:string){
   if(!uuid(operationId))throw new QrRepositoryError(400,'QR operation id required');
   const snapshot=normalized(input);const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
   return authorized(actor,'create_qr',async(client,owner)=>{
   const lock=createHash('sha256').update(JSON.stringify([company,owner,operationId])).digest().readBigInt64BE().toString();
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[lock]);
   const receipt=await client.query('SELECT payload_hash,response FROM lp2_company.qr_create_receipts WHERE company=$1 AND owner=$2 AND operation_id=$3',[company,owner,operationId]);
   if(receipt.rowCount){if(receipt.rows[0].payload_hash!==hash)throw new QrRepositoryError(409,'QR operation payload conflict');return decode(receipt.rows[0].response);}
   const result=await client.query(`INSERT INTO lp2_company.qr_documents(company,id,owner,qr_type,qr_data,description,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE') RETURNING ${columns}`,[company,randomUUID(),owner,snapshot.qrType,snapshot.qrData,snapshot.description]);
   await client.query('INSERT INTO lp2_company.qr_create_receipts(company,owner,operation_id,payload_hash,document_id,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[company,owner,operationId,hash,result.rows[0].id,JSON.stringify(result.rows[0])]);return decode(result.rows[0]);
  });},
  async get(actor:CompanyActor,documentId:string){validDocument(documentId);return authorized(actor,'view_qr',async(client,owner)=>{
   const result=await client.query(`SELECT ${columns} FROM lp2_company.qr_documents WHERE company=$1 AND id=$2 AND owner=$3`,[company,documentId,owner]);if(!result.rowCount)throw new QrRepositoryError(404,'QR not found');return decode(result.rows[0]);
  });},
  async list(actor:CompanyActor,limit=100,after?:string){if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new QrRepositoryError(400,'Invalid QR page');if(after!==undefined)validDocument(after);return authorized(actor,'view_qr',async(client,owner)=>{
   const result=await client.query(`WITH page AS MATERIALIZED (
     SELECT ${columns} FROM lp2_company.qr_documents WHERE company=$1 AND owner=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4
   ), budget AS (
     SELECT *,SUM(octet_length(to_json(qr_data)::text)+COALESCE(octet_length(to_json(description)::text),4)+1024) OVER(ORDER BY id) AS bytes FROM page
   ) SELECT *, (SELECT id FROM page ORDER BY id DESC LIMIT 1) AS last_candidate FROM budget WHERE bytes<=1048576 ORDER BY id`,[company,owner,after??null,limit+1]);
   const rows=result.rows.slice(0,limit),last=rows[rows.length-1];return{items:rows.map(decode),nextAfter:last&&last.id!==last.last_candidate?last.id:null};
  });},
  async update(actor:CompanyActor,documentId:string,expected:number,input:Partial<Omit<QrContent,'qrData'>>&{qrData?:unknown}){revision(expected);const patch={...input};return authorized(actor,'update_qr',async(client,owner)=>{
   const previous=await locked(client,owner,documentId);if(previous.revision!==expected)throw new QrRepositoryError(409,'QR revision conflict');if(previous.status==='DELETED')throw new QrRepositoryError(409,'Restore QR before editing');
   const snapshot=normalized({...previous,...patch});
   const result=await client.query(`UPDATE lp2_company.qr_documents SET qr_type=$4,qr_data=$5,description=$6,revision=revision+1,updated_at=now() WHERE company=$1 AND id=$2 AND owner=$3 RETURNING ${columns}`,[company,documentId,owner,snapshot.qrType,snapshot.qrData,snapshot.description]);return decode(result.rows[0]);
  });},
  async restore(actor:CompanyActor,documentId:string,expected:number){revision(expected);return authorized(actor,'restore_qr',async(client,owner)=>{
   const previous=await locked(client,owner,documentId);if(previous.revision!==expected)throw new QrRepositoryError(409,'QR revision conflict');if(previous.status!=='DELETED')throw new QrRepositoryError(409,'QR is not deleted');
   const result=await client.query(`UPDATE lp2_company.qr_documents SET status='ACTIVE',revision=revision+1,updated_at=now() WHERE company=$1 AND id=$2 AND owner=$3 RETURNING ${columns}`,[company,documentId,owner]);return decode(result.rows[0]);
  });},
  async setStatus(actor:CompanyActor,documentId:string,expected:number,status:QrStatus){
   revision(expected);if(!['ACTIVE','PAUSED','DELETED'].includes(status))throw new QrRepositoryError(400,'Invalid QR status');
   // Restore is an independent confirmed action, never inferred from delete/update.
   return authorized(actor,status==='DELETED'?'delete_qr':'update_qr',async(client,owner)=>{
    const previous=await locked(client,owner,documentId);if(previous.revision!==expected)throw new QrRepositoryError(409,'QR revision conflict');
    if(previous.status==='DELETED'&&status!=='DELETED')throw new QrRepositoryError(409,'Use explicit QR restore');
    if(previous.status===status)return previous;
    const result=await client.query(`UPDATE lp2_company.qr_documents SET status=$4,revision=revision+1,updated_at=now() WHERE company=$1 AND id=$2 AND owner=$3 RETURNING ${columns}`,[company,documentId,owner,status]);return decode(result.rows[0]);
   });
  },
 });
}
