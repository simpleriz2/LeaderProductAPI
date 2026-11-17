import prisma from '../prisma/client';
import type { Prisma } from '@prisma/client';
import { computeUserPermissions, getRoleHierarchyByName } from '../middleware/auth';
import { resolveServiceAccessForUser } from './serviceAccess';
import { helpActor, visibleHelpWhere } from '../modules/help/help.service';
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const actorSelect = { id:true,isActive:true,deletedAt:true,profileStatus:true,currentProfileType:true,
  role:{select:{name:true}}, employeeProfile:{select:{departmentId:true,status:true}},
  departmentRoles:{select:{departmentId:true,role:{select:{name:true}}}},
} as const;
async function actorFor(userId: number) {
  if(!validId(userId)) return null;
  const actor = await prisma.user.findUnique({where:{id:userId},select:actorSelect});
  if(!actor || !actor.isActive || actor.deletedAt || actor.profileStatus==='BLOCKED' || actor.employeeProfile?.status==='BLOCKED')return null;
  return actor;
}
async function accessFor(actor: NonNullable<Awaited<ReturnType<typeof actorFor>>>) {
  const roles=await getRoleHierarchyByName(actor.role.name);
  const admin=roles.has('admin')||roles.has('administrator');
  const permissions=admin?new Set<string>():await computeUserPermissions(actor.id);
  return {admin,permissions};
}
/** Legacy Company database only. This is NOT a SaaS tenant model or Central introspection replacement. */
export async function authorizeLegacyRoom(userId: number, room: unknown): Promise<boolean> {
  if(typeof room !== 'string' || room.length>128)return false;
  const match=/^(user|department|appeal):([1-9][0-9]*)$/.exec(room);
  if(!match || !validId(Number(match[2])))return false;
  const actor=await actorFor(userId);if(!actor)return false;
  const id=Number(match[2]);if(match[1]==='user')return id===userId;
  const access=await accessFor(actor);
  if(!access.admin&&!access.permissions.has('view_appeal'))return false;
  const service=await resolveServiceAccessForUser(userId,'appeals');
  if(!service?.isEmployee||!service.visible||!service.enabled)return false;
  if(match[1]==='department')return access.admin || actor.employeeProfile?.departmentId===id || actor.departmentRoles.some(r=>r.departmentId===id);
  const appeal=await prisma.appeal.findUnique({where:{id},select:{createdById:true,toDepartmentId:true,assignees:{select:{userId:true}}}});
  if(!appeal)return false;
  // Matches existing GET /appeals/:id: creator, assignee, target department member/manager, admin.
  return access.admin || appeal.createdById===userId || appeal.assignees.some(a=>a.userId===userId)
    || actor.employeeProfile?.departmentId===appeal.toDepartmentId
    || actor.departmentRoles.some(r=>r.departmentId===appeal.toDepartmentId&&r.role.name==='department_manager');
}
/** Presence follows explicit administrative, department or visible-Help object relationships. */
export async function authorizedPresenceUsers(userId: number, values: readonly number[]): Promise<number[]> {
  const ids=[...new Set(values.filter(validId))].slice(0,100);if(!ids.length)return [];
  const actor=await actorFor(userId);if(!actor)return [];
  const targets=await prisma.user.findMany({where:{id:{in:ids},isActive:true,deletedAt:null,profileStatus:{not:'BLOCKED'}},select:{id:true,employeeProfile:{select:{departmentId:true,status:true}}}});
  const access=await accessFor(actor);
  if(access.admin||access.permissions.has('manage_users')||access.permissions.has('manage_roles'))return targets.map(t=>t.id);
  const departments=new Set(actor.departmentRoles.map(r=>r.departmentId));if(actor.employeeProfile?.departmentId)departments.add(actor.employeeProfile.departmentId);
  const allowed=new Set(targets.filter(t=>t.id===userId || (actor.currentProfileType==='EMPLOYEE'&&t.employeeProfile?.departmentId&&departments.has(t.employeeProfile.departmentId)&&t.employeeProfile.status!=='BLOCKED')).map(t=>t.id));
  // Help applies its existing service/actor visibility rules, including authorized manager queue.
  try {
    const help=await helpActor(userId);
    const visible = visibleHelpWhere(help,help.canManage);
    const users = await prisma.user.findMany({where:{id:{in:targets.map(t=>t.id)},OR:[
      {helpOwnedTickets:{some:visible}}, {helpMemberships:{some:{ticket:visible}}}, {helpMessages:{some:{ticket:visible}}},
    ]},select:{id:true}});
    users.forEach(user=>allowed.add(user.id));
  } catch(error: any) { if(![403,404].includes(error?.status))throw error; }
  if(access.permissions.has('view_appeal')) {
    const service=await resolveServiceAccessForUser(userId,'appeals');
    if(service?.isEmployee&&service.visible&&service.enabled) {
      const visible: Prisma.AppealWhereInput = {OR:[{createdById:userId},{assignees:{some:{userId}}},
        ...(actor.employeeProfile?.departmentId?[{toDepartmentId:actor.employeeProfile.departmentId}]:[]),
        {toDepartmentId:{in:actor.departmentRoles.filter(r=>r.role.name==='department_manager').map(r=>r.departmentId)}},
      ]};
      const users=await prisma.user.findMany({where:{id:{in:targets.map(t=>t.id)},OR:[{appealsCreated:{some:visible}},{appealAssignees:{some:{appeal:visible}}}]},select:{id:true}});
      users.forEach(user=>allowed.add(user.id));
    }
  }
  return targets.filter(t=>allowed.has(t.id)).map(t=>t.id);
}
