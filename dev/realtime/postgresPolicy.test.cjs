const{test}=require('node:test');const assert=require('node:assert/strict');const{randomUUID}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'http://invalid');
if(process.env.NODE_ENV!=='test'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='54329'||url.username!=='lp2_fixture'||url.pathname!=='/lp2_realtime_fixture')throw Error('Explicit isolated fixture DATABASE_URL required');
require('../testSafety/postgresOnly.cjs');
const{prisma,pool}=require('../../src/prisma/client.ts');const{authorizeLegacyRoom,authorizedPresenceUsers}=require('../../src/services/realtimeAuthorization.ts');
test('real PostgreSQL current grants and appeal/presence objects enforce subscription policy',async t=>{
  try {
    const marker=await pool.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    assert.equal(marker.rows[0]?.marker,'LP-MS-F isolated realtime fixture','Fixture marker required before mutations');
  } catch(error) {await prisma.$disconnect();await pool.end();throw error;}
  const prefix=`lp2-${randomUUID()}`;let users=[],roles=[],departments=[],permission,service,appeal;
  t.after(async()=>{
    try {
    if(appeal){await prisma.appealAssignee.deleteMany({where:{appealId:appeal.id}});await prisma.appeal.delete({where:{id:appeal.id}});}
    await prisma.serviceUserAccess.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});
    await prisma.departmentRole.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});
    await prisma.employeeProfile.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});await prisma.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
    if(permission){await prisma.rolePermissions.deleteMany({where:{permissionId:permission.id}});await prisma.permission.delete({where:{id:permission.id}});}
    await prisma.role.deleteMany({where:{id:{in:roles.map(r=>r.id)}}});await prisma.department.deleteMany({where:{id:{in:departments.map(d=>d.id)}}});if(service)await prisma.service.delete({where:{id:service.id}});
    } finally {await prisma.$disconnect();await pool.end();}
  });
  // Seed only this new fixture database. No app server or integration worker is started.
  await prisma.$transaction(async tx=>{
    const employee=await tx.role.create({data:{name:`${prefix}-employee`}}),manager=await tx.role.create({data:{name:'department_manager',parentRoleId:employee.id}}),admin=await tx.role.create({data:{name:'admin'}});roles=[employee,manager,admin];
    permission=await tx.permission.create({data:{name:'view_appeal'}});await tx.rolePermissions.create({data:{roleId:employee.id,permissionId:permission.id}});
    for(const name of ['A','B','C'])departments.push(await tx.department.create({data:{name:`${prefix}-${name}`}}));
    for(const [index,department]of [0,1,2,0].entries())users.push(await tx.user.create({data:{email:`${prefix}-${index}@fixture.invalid`,roleId:employee.id,isActive:true,profileStatus:'ACTIVE',currentProfileType:'EMPLOYEE',employeeProfile:{create:{departmentId:departments[department].id,status:'ACTIVE'}}}}));
    service=await tx.service.create({data:{key:'appeals',name:'Fixture Appeals',defaultVisible:true,defaultEnabled:true}});
    appeal=await tx.appeal.create({data:{number:1,createdById:users[0].id,fromDepartmentId:departments[0].id,toDepartmentId:departments[1].id,title:'Fixture only',assignees:{create:{userId:users[1].id}}}});
  });
  const[creator,assignee,outsider,coworker]=users;
  assert.equal(await authorizeLegacyRoom(creator.id,`appeal:${appeal.id}`),true);assert.equal(await authorizeLegacyRoom(assignee.id,`appeal:${appeal.id}`),true);assert.equal(await authorizeLegacyRoom(outsider.id,`appeal:${appeal.id}`),false);
  assert.equal(await authorizeLegacyRoom(creator.id,`user:${outsider.id}`),false);assert.equal(await authorizeLegacyRoom(creator.id,`department:${departments[2].id}`),false);
  assert.deepEqual(new Set(await authorizedPresenceUsers(creator.id,users.map(u=>u.id))),new Set([creator.id,assignee.id,coworker.id]));
  await prisma.rolePermissions.deleteMany({where:{roleId:roles[0].id}});assert.equal(await authorizeLegacyRoom(creator.id,`appeal:${appeal.id}`),false);
  await prisma.rolePermissions.create({data:{roleId:roles[0].id,permissionId:permission.id}});
  const denied=await prisma.serviceUserAccess.create({data:{serviceId:service.id,userId:creator.id,enabled:false}});assert.equal(await authorizeLegacyRoom(creator.id,`appeal:${appeal.id}`),false);await prisma.serviceUserAccess.delete({where:{id:denied.id}});
  await prisma.departmentRole.create({data:{userId:creator.id,departmentId:departments[2].id,roleId:roles[1].id}});assert.equal(await authorizeLegacyRoom(creator.id,`department:${departments[2].id}`),true);
  await prisma.user.update({where:{id:creator.id},data:{profileStatus:'BLOCKED'}});assert.equal(await authorizeLegacyRoom(creator.id,`user:${creator.id}`),false);
});
