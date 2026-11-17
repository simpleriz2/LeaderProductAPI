export type QrImageOptions={width?:number;margin?:number;color?:{dark?:string;light?:string};errorCorrectionLevel?:'L'|'M'|'Q'|'H'};
export function validateQrImageOptions(options:QrImageOptions){
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Некорректные параметры изображения QR');
  const width=options.width??200,margin=options.margin,dark=options.color?.dark??'#000000',light=options.color?.light??'#ffffff',errorCorrectionLevel=options.errorCorrectionLevel??'M';
  if(!Number.isSafeInteger(width)||width<50||width>1000)throw Error('Ширина QR должна быть целой от 50 до 1000');
  if(margin!==undefined&&(!Number.isSafeInteger(margin)||margin<0||margin>32))throw Error('Отступ QR должен быть целым от 0 до 32');
  if(typeof dark!=='string'||typeof light!=='string'||!/^#[0-9a-f]{6}$/i.test(dark)||!/^#[0-9a-f]{6}$/i.test(light))throw Error('Некорректный цвет QR');
  if(!['L','M','Q','H'].includes(errorCorrectionLevel))throw Error('Некорректная коррекция ошибок QR');
  // Only supported, validated fields reach the renderer; no raw scale/version/renderer options spread.
  return{width,color:{dark:dark.toLowerCase(),light:light.toLowerCase()},errorCorrectionLevel,...(margin===undefined?{}:{margin})};
}
export function parseQrImageQuery(query:Record<string,unknown>){
  const integer=(name:string,fallback:number)=>{const value=query[name];if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d{1,4}$/.test(value))throw Error('Некорректный целочисленный параметр QR');return Number(value);};
  const hex=(name:string,fallback:string)=>{const value=query[name]??fallback;if(typeof value!=='string'||! /^[0-9a-f]{6}$/i.test(value))throw Error('Некорректный цвет QR');return`#${value.toLowerCase()}`;};
  if(query.simple!==undefined&&query.simple!==''&&query.simple!=='true'&&query.simple!=='false')throw Error('Некорректный параметр simple');
  const errorCorrectionLevel=query.errorCorrection??'M';if(typeof errorCorrectionLevel!=='string'||!['L','M','Q','H'].includes(errorCorrectionLevel))throw Error('Некорректная коррекция ошибок QR');
  const options=validateQrImageOptions({width:integer('width',300),margin:integer('margin',1),color:{dark:hex('darkColor','000000'),light:hex('lightColor','ffffff')},errorCorrectionLevel:errorCorrectionLevel as QrImageOptions['errorCorrectionLevel']});
  const simple=query.simple==='true';return{options,simple,cacheVariant:JSON.stringify([simple,options.width,options.margin,options.color.dark,options.color.light,options.errorCorrectionLevel])};
}
