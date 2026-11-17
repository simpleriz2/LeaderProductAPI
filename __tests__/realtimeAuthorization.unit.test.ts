const mockPrisma = {user:{findUnique:jest.fn(),findMany:jest.fn()},appeal:{findUnique:jest.fn()}};
const mockPermissions=jest.fn();const mockHierarchy=jest.fn();const mockService=jest.fn();const mockHelp=jest.fn();
jest.mock('../src/prisma/client',()=>({__esModule:true,default:mockPrisma}));
jest.mock('../src/middleware/auth',()=>({computeUserPermissions:(...a:unknown[])=>mockPermissions(...a),getRoleHierarchyByName:(...a:unknown[])=>mockHierarchy(...a)}));
jest.mock('../src/services/serviceAccess',()=>({resolveServiceAccessForUser:(...a:unknown[])=>mockService(...a)}));
jest.mock('../src/modules/help/help.service',()=>({helpActor:(...a:unknown[])=>mockHelp(...a),visibleHelpWhere:()=>({members:{some:{userId:1}}})}));
import {authorizeLegacyRoom,authorizedPresenceUsers} from '../src/services/realtimeAuthorization';
const actor={id:1,isActive:true,deletedAt:null,profileStatus:'APPROVED',currentProfileType:'EMPLOYEE',role:{name:'employee'},employeeProfile:{departmentId:2,status:'APPROVED'},departmentRoles:[{departmentId:3,role:{name:'department_manager'}}]};
beforeEach(()=>{jest.resetAllMocks();mockPrisma.user.findUnique.mockResolvedValue(actor);mockHierarchy.mockResolvedValue(new Set(['employee']));mockPermissions.mockResolvedValue(new Set(['view_appeal']));mockService.mockResolvedValue({isEmployee:true,visible:true,enabled:true});mockHelp.mockRejectedValue({status:403});mockPrisma.user.findMany.mockResolvedValue([]);});
test.each(['help:user:1','presence:2','user:2','department:999','appeal:1.5','appeal:-1','random','appeal:9007199254740993'])('refuses arbitrary/foreign room %s',async room=>{expect(await authorizeLegacyRoom(1,room)).toBe(false);});
test('only own user room, actual department membership and authorized appeal objects pass',async()=>{
  expect(await authorizeLegacyRoom(1,'user:1')).toBe(true);expect(await authorizeLegacyRoom(1,'department:2')).toBe(true);expect(await authorizeLegacyRoom(1,'department:3')).toBe(true);
  mockPrisma.appeal.findUnique.mockResolvedValue({createdById:9,toDepartmentId:7,assignees:[]});expect(await authorizeLegacyRoom(1,'appeal:5')).toBe(false);
  mockPrisma.appeal.findUnique.mockResolvedValue({createdById:1,toDepartmentId:7,assignees:[]});expect(await authorizeLegacyRoom(1,'appeal:5')).toBe(true);
  mockPrisma.appeal.findUnique.mockResolvedValue({createdById:9,toDepartmentId:7,assignees:[{userId:1}]});expect(await authorizeLegacyRoom(1,'appeal:5')).toBe(true);
  expect(mockHierarchy).toHaveBeenCalledWith('employee');
});
test('rechecks current account/permissions/service every subscription; no positive cache',async()=>{
  expect(await authorizeLegacyRoom(1,'department:2')).toBe(true);mockPermissions.mockResolvedValue(new Set());expect(await authorizeLegacyRoom(1,'department:2')).toBe(false);
  mockPermissions.mockResolvedValue(new Set(['view_appeal']));mockService.mockResolvedValue({isEmployee:true,visible:true,enabled:false});expect(await authorizeLegacyRoom(1,'department:2')).toBe(false);
  mockPrisma.user.findUnique.mockResolvedValue({...actor,isActive:false});expect(await authorizeLegacyRoom(1,'user:1')).toBe(false);
});
test('presence filters unrelated objects, keeps own/department and delegates visible Help relationships',async()=>{
  const targets=[{id:1,employeeProfile:actor.employeeProfile},{id:4,employeeProfile:{departmentId:2,status:'APPROVED'}},{id:8,employeeProfile:{departmentId:9,status:'APPROVED'}}];
  mockPermissions.mockResolvedValue(new Set());mockPrisma.user.findMany.mockResolvedValue(targets);
  expect(await authorizedPresenceUsers(1,[1,4,8])).toEqual([1,4]);
  mockHelp.mockResolvedValue({userId:1,canManage:false});mockPrisma.user.findMany.mockResolvedValueOnce(targets).mockResolvedValueOnce([{id:8}]);
  expect(await authorizedPresenceUsers(1,[1,4,8])).toEqual([1,4,8]);
});
test('database failures deny through rejection rather than using cached grants',async()=>{
  mockPrisma.user.findUnique.mockRejectedValue(Error('Database unavailable'));await expect(authorizeLegacyRoom(1,'user:1')).rejects.toThrow('Database unavailable');
});
