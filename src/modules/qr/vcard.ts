export type QrContactFields=Partial<Record<'name'|'firstName'|'lastName'|'firstname'|'lastname'|'phone'|'email'|'org'|'title'|'address'|'contactAddress'|'url'|'note'|'birthday'|'fax'|'photo',string>>;
/** vCard3 structured text escaping. Existing stored VCard strings bypass generation unchanged. */
export function generateQrVCard(input:unknown):string{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Неверный объект контакта');
  const contact=input as Record<string,unknown>;
  const field=(...keys:string[])=>{for(const key of keys){const value=contact[key];if(value===undefined||value===null||value==='')continue;if(typeof value!=='string')throw Error('Поле контакта должно быть строкой');return value;}return'';};
  const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const first=field('firstName','firstname'),last=field('lastName','lastname'),name=field('name')||[first,last].filter(Boolean).join(' ');
  const lines=['BEGIN:VCARD','VERSION:3.0',`FN:${escape(name)}`,`N:${escape(last)};${escape(first||(!last?name:''))};;;`];
  const append=(key:string,value:string)=>{if(value)lines.push(`${key}:${escape(value)}`);};
  append('TEL',field('phone'));append('EMAIL',field('email'));append('ORG',field('org'));append('TITLE',field('title'));
  const address=field('contactAddress','address');if(address)lines.push(`ADR:;;${escape(address)};;;;`);
  append('URL',field('url'));append('NOTE',field('note'));append('BDAY',field('birthday'));append('FAX',field('fax'));append('PHOTO',field('photo'));
  lines.push('END:VCARD');return lines.join('\r\n')+'\r\n';
}
