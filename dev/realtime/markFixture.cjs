// Explicit fixture initialization only; refusing other role/host/port/database avoids accidental production use.
const u=new URL(process.env.DATABASE_URL||'http://invalid');
if(process.env.NODE_ENV!=='test'||u.protocol!=='postgresql:'||u.hostname!=='127.0.0.1'||u.port!=='54329'||u.username!=='lp2_fixture'||u.pathname!=='/lp2_realtime_fixture')throw Error('Isolated fixture database URL required');
require('../testSafety/postgresOnly.cjs');
const{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{try{await pool.query("COMMENT ON DATABASE lp2_realtime_fixture IS 'LP-MS-F isolated realtime fixture'");}finally{await pool.end();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
