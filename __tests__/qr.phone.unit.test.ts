import {normalizeAndValidate} from '../src/services/qrService';
describe.each(['PHONE','WHATSAPP'] as const)('%s phone preservation',type=>{
 test('keeps all fifteen digits instead of silently changing destination',()=>{
  expect(normalizeAndValidate(type,'+123456789012345')).toBe('+123456789012345');
  expect(normalizeAndValidate(type,'+7 (999) 123-45-67')).toBe('+79991234567');
 });
 test('rejects overlong/malformed destination instead of truncating or deleting significant characters',()=>{
  for(const raw of ['+1234567890123456','12+345678','+79991234567ext123'])expect(()=>normalizeAndValidate(type,raw)).toThrow();
 });
});
