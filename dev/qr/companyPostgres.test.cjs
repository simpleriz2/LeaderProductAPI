const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const{randomUUID}=require('node:crypto');
const url=new URL(process.env.LP2_COMPANY_TEST_DATABASE_URL||'http://invalid');
if(process.env.NODE_ENV!=='test'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='54329'||url.username!=='lp2_fixture'||url.pathname!=='/lp2_realtime_fixture')throw Error('Explicit owned fixture DB required');
require('../testSafety/postgresOnly.cjs');
const{Pool}=require('pg');const{createCompanyQrRepository}=require('../../src/modules/qr/company/repository.ts');
test('actual Company PostgreSQL identity mapping/QR ACL, durable data, revisions and independent restore rights',async t=>{
 const pool=new Pool({connectionString:url.toString(),max:2});const company='qr-'+randomUUID(),other='qr-'+randomUUID();
 let migrated=false;
 t.after(async()=>{try{if(!migrated)return;await pool.query('DELETE FROM lp2_company.qr_create_receipts WHERE company=ANY($1)',[[company,other]]);await pool.query('DELETE FROM lp2_company.qr_documents WHERE company=ANY($1)',[[company,other]]);await pool.query('DELETE FROM lp2_company.subjects WHERE company=ANY($1)',[[company,other]]);}finally{await pool.end();}});
 const marker=await pool.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.equal(marker.rows[0]?.marker,'LP-MS-F isolated realtime fixture');
 const migration=fs.readFileSync(path.resolve(__dirname,'../../src/modules/qr/company/schema.sql'),'utf8');await pool.query(migration);await pool.query(fs.readFileSync(path.resolve(__dirname,'../../src/modules/qr/company/002_create_receipts.sql'),'utf8'));migrated=true;await pool.query(migration);
 const rights=['view_qr','create_qr','update_qr','delete_qr','restore_qr'];const alice={company,user:'central-alice',modules:['qr'],permissions:{qr:rights}},carol={...alice,user:'central-carol'},bob={...alice,company:other,user:'central-bob'};
 const local=randomUUID();for(const actor of [alice,carol,bob])await pool.query('INSERT INTO lp2_company.subjects(company,central_user,local_user) VALUES($1,$2,$3)',[actor.company,actor.user,actor===bob?local:actor===alice?local:randomUUID()]);
 const repo=createCompanyQrRepository(pool,company),beta=createCompanyQrRepository(pool,other),input={qrType:'TEXT',qrData:'Неотправленный <текст>',description:'Название'};
 const operationId=randomUUID();const replies=await Promise.all([repo.create(alice,input,operationId),repo.create(alice,input,operationId)]);assert.deepEqual(replies[0],replies[1]);await assert.rejects(repo.create(alice,{...input,description:'changed'},operationId),e=>e.status===409);const created=replies[0];assert.equal(created.revision,1);assert.deepEqual(await repo.list(carol),[]);
 await assert.rejects(repo.get(carol,created.id),e=>e.status===404);await assert.rejects(beta.get(bob,created.id),e=>e.status===404);await assert.rejects(repo.get(bob,created.id),e=>e.status===403);
 await assert.rejects(repo.create({...alice,user:'unmapped'},input,randomUUID()),e=>e.status===403);
 const reopened=new Pool({connectionString:url.toString(),max:1});try{assert.deepEqual(await createCompanyQrRepository(reopened,company).get(alice,created.id),created);}finally{await reopened.end();}
 const edits=await Promise.allSettled([repo.update(alice,created.id,1,{...input,description:null}),repo.update(alice,created.id,1,{...input,description:'concurrent'})]);assert.equal(edits.filter(e=>e.status==='fulfilled').length,1);assert.equal(edits.find(e=>e.status==='rejected').reason.status,409);
 const current=await repo.get(alice,created.id);assert.equal(current.revision,2);assert.deepEqual(await repo.create(alice,input,operationId),created);assert.equal((await repo.list(alice)).length,1);const deleted=await repo.setStatus(alice,created.id,2,'DELETED');
 const onlyDelete={...alice,permissions:{qr:['delete_qr']}};await assert.rejects(repo.restore(onlyDelete,created.id,3),e=>e.status===403);await assert.rejects(repo.setStatus(alice,created.id,3,'ACTIVE'),e=>e.status===409);
 const restored=await repo.restore({...alice,permissions:{qr:['restore_qr']}},created.id,deleted.revision);assert.equal(restored.status,'ACTIVE');assert.equal(restored.revision,4);
 await pool.query('UPDATE lp2_company.subjects SET active=false WHERE company=$1 AND central_user=$2',[company,alice.user]);await assert.rejects(repo.get(alice,created.id),e=>e.status===403);
 await pool.query('UPDATE lp2_company.subjects SET active=true WHERE company=$1 AND central_user=$2',[company,alice.user]);assert.equal((await repo.get(alice,created.id)).revision,4);
 await assert.rejects(repo.update({...alice,permissions:{qr:[]}},created.id,4,input),e=>e.status===403);assert.equal((await repo.get(alice,created.id)).revision,4);
});
