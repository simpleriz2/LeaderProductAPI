import express from 'express';
import http from 'node:http';
import jwt from 'jsonwebtoken';
const fixtureSecret='lp2-qr-fixture-only-no-production';
process.env.ACCESS_TOKEN_SECRET=fixtureSecret;
process.env.DOMEN_URL='http://127.0.0.1:3000';
const rows=new Map<string,any>();const cached=new Map<string,unknown>();
const mockPrisma={user:{findUnique:jest.fn()},role:{findUnique:jest.fn()},rolePermissions:{findMany:jest.fn()},qRList:{findUnique:jest.fn(),findFirst:jest.fn()},qRAnalytic:{create:jest.fn()}};
const mockCacheGet=jest.fn(async(key:string)=>cached.get(key)||null),mockCacheSet=jest.fn(async(key:string,value:unknown)=>{cached.set(key,value);});
jest.mock('../src/prisma/client',()=>({__esModule:true,default:mockPrisma}));
jest.mock('../src/utils/cache',()=>({cacheGet:(...args:[string])=>mockCacheGet(...args),cacheSet:(...args:[string,unknown])=>mockCacheSet(...args),cacheDelPrefix:jest.fn(async()=>{})}));
jest.mock('../src/services/serviceAccess',()=>({resolveServiceAccessForUser:jest.fn(async()=>({isEmployee:true,visible:true,enabled:true}))}));
jest.mock('fast-geoip',()=>({lookup:jest.fn(async()=>null)}));
// Real Express router/JWT/permission middleware/PNG generator; fixture Prisma/cache/service grants only.
const qrRouter=require('../src/routes/qr').default;
let server:http.Server,origin:string;
const token=(id:number)=>jwt.sign({userId:id,role:'employee',permissions:[],profileStatus:'ACTIVE'},fixtureSecret,{expiresIn:'5m'});
const request=(path:string,id?:number)=>fetch(origin+path,{headers:id?{authorization:`Bearer ${token(id)}`}:{}});
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/qr',qrRouter);server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as any).port}`;});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{rows.clear();cached.clear();jest.clearAllMocks();
 mockPrisma.user.findUnique.mockImplementation(async({where,select}:any)=>![1,2].includes(where.id)?null:select.profileStatus?{profileStatus:'ACTIVE'}:{roleId:1,departmentRoles:[]});
 mockPrisma.role.findUnique.mockImplementation(async({where}:any)=>where.name?{parentRole:null}:{parentRoleId:null});mockPrisma.rolePermissions.findMany.mockResolvedValue([{permission:{name:'view_qr'}}]);
 mockPrisma.qRList.findUnique.mockImplementation(async({where}:any)=>rows.get(where.id)||null);mockPrisma.qRList.findFirst.mockImplementation(async({where}:any)=>{const row=rows.get(where.id);return row?.status===where.status?row:null;});mockPrisma.qRAnalytic.create.mockResolvedValue({id:1});
 rows.set('private-qr',{id:'private-qr',createdById:1,qrType:'TEXT',qrData:'Alice private text',description:'Private',status:'ACTIVE',createdAt:new Date('2026-01-01'),createdBy:{id:1,email:'alice@fixture.invalid'}});
});
test('warm QR detail cache cannot bypass current object ownership or absence',async()=>{
 const first=await request('/qr/private-qr',1);expect(first.status).toBe(200);const data=await first.json();expect(data.data.qrImage).toMatch(/^data:image\/png;base64,/);expect(cached.size).toBe(1);
 const other=await request('/qr/private-qr',2);expect(other.status).toBe(403);expect(JSON.stringify(await other.json())).not.toContain('Alice private text');
 rows.get('private-qr').createdById=2;const changed=await request('/qr/private-qr',1);expect(changed.status).toBe(403);
 rows.delete('private-qr');expect((await request('/qr/private-qr',1)).status).toBe(404);
});
test('same-owner cache hit still checks object and avoids repeating PNG generation',async()=>{
 await(await request('/qr/private-qr',1)).json();mockPrisma.qRList.findUnique.mockClear();mockCacheSet.mockClear();const again=await request('/qr/private-qr',1);expect(again.status).toBe(200);await again.json();expect(mockPrisma.qRList.findUnique).toHaveBeenCalledTimes(1);expect(mockCacheSet).not.toHaveBeenCalled();
});
test('public TEXT scan displays literal text and cannot execute stored HTML',async()=>{
 rows.get('private-qr').qrData='<img src=x onerror=alert(1)><script>alert(2)</script>&text';
 const response=await request('/qr/private-qr/scan');expect(response.status).toBe(200);const html=await response.text();expect(html).toContain('&lt;script&gt;');expect(html).toContain('&amp;text');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
test('oversized/ambiguous image parameters fail without caching while valid query still produces PNG',async()=>{
 for(const query of ['width=100000000','width=300&width=900','margin=99999','darkColor=not-hex','errorCorrection=bad']){const response=await request('/qr/private-qr?'+query,1);expect(response.status).toBe(400);await response.json();}expect(cached.size).toBe(0);
 const response=await request('/qr/private-qr?width=200&margin=0&simple=true',1);expect(response.status).toBe(200);const body=await response.json();expect(body.data.createdBy).toBeUndefined();const png=Buffer.from(body.data.qrImage.split(',')[1],'base64');expect(png.readUInt32BE(16)).toBe(200);
});
