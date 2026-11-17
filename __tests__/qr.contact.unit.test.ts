import {normalizeAndValidate} from '../src/services/qrService';
test('current form contact first/last names and address survive normalization',()=>{
 const value=normalizeAndValidate('CONTACT',{firstName:'Иван Сергеевич',lastName:'Петров',phone:'+79991234567',contactAddress:'Москва, улица; дом 1',org:'Company',url:'https://fixture.invalid',note:'line1\nline2'});
 expect(value).toContain('FN:Иван Сергеевич Петров');expect(value).toContain('N:Петров;Иван Сергеевич;;;');expect(value).toContain('ADR:;;Москва\\, улица\\; дом 1;;;;');expect(value).toContain('NOTE:line1\\nline2');
});
test('legacy name/address fields remain supported with delimiter/backslash escaping',()=>{
 const value=normalizeAndValidate('CONTACT',{name:'Legacy, Name; Value',address:'C:\\folder;value',title:'Role',birthday:'2000-01-01',fax:'+79991234567',photo:'https://fixture.invalid/photo'});
 expect(value).toContain('FN:Legacy\\, Name\\; Value');expect(value).toContain('ADR:;;C:\\\\folder\\;value;;;;');expect(value).toContain('TITLE:Role');expect(value).toContain('BDAY:2000-01-01');expect(value).toContain('FAX:+79991234567');
});
test('already stored VCard bytes are preserved; malformed contact object fields reject',()=>{
 const saved='BEGIN:VCARD\nVERSION:3.0\nFN:Stored\nEND:VCARD';expect(normalizeAndValidate('CONTACT',saved)).toBe(saved);expect(()=>normalizeAndValidate('CONTACT',{firstName:{bad:true}})).toThrow();expect(()=>normalizeAndValidate('CONTACT',[])).toThrow();
});
