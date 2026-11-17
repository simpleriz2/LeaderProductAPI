const{test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
if(!process.env.LP2_APP_ROOT)throw Error('Explicit local APP fork LP2_APP_ROOT required');
const{normalizeAndValidate}=require('../../src/services/qrService.ts');const{parseQrContactVCard}=require(path.join(process.env.LP2_APP_ROOT,'src/entities/qr/vcard.ts'));
test('actual API contact normalization round-trips current native/Web form fields through actual APP parser',()=>{
 const form={firstName:'Иван Сергеевич',lastName:'Петров; Старший',phone:'+79991234567',email:'fixture@example.invalid',org:'Org, Unit',url:'https://fixture.invalid:443/contact',contactAddress:'Москва, улица; дом 1',note:'first\nsecond\\path'};
 const card=normalizeAndValidate('CONTACT',form),parsed=parseQrContactVCard(card);
 assert.deepEqual(parsed,{firstname:form.firstName,lastname:form.lastName,phone:form.phone,email:form.email,org:form.org,website:form.url,contactAddress:form.contactAddress,note:form.note});
 const next=normalizeAndValidate('CONTACT',{firstName:parsed.firstname,lastName:parsed.lastname,phone:parsed.phone,email:parsed.email,org:parsed.org,url:parsed.website,contactAddress:parsed.contactAddress,note:parsed.note});assert.equal(next,card);
});
test('old stored VCard remains byte-identical on API passthrough and readable in the new client',()=>{
 const old='BEGIN:VCARD\nVERSION:3.0\nFN:Legacy Full Name\nADR:Legacy street\nTEL:+79991234567\nEND:VCARD';assert.equal(normalizeAndValidate('CONTACT',old),old);assert.deepEqual(parseQrContactVCard(old),{firstname:'Legacy Full Name',contactAddress:'Legacy street',phone:'+79991234567'});
});
