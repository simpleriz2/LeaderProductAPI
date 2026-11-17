import QRCode from 'qrcode';
import {generateQRCode} from '../src/services/qrService';
import {parseQrImageQuery} from '../src/modules/qr/imageOptions';
afterEach(()=>jest.restoreAllMocks());
test.each([{width:0},{width:1001},{width:1e9},{width:NaN},{width:300.5},{margin:-1},{margin:33},{margin:Infinity},{color:{dark:'javascript:bad'}},{color:{light:'red'}},{errorCorrectionLevel:'bad'}])('invalid renderer options %j fail before allocation',async options=>{
 const renderer=jest.spyOn(QRCode,'toDataURL').mockResolvedValue('fixture-image' as never);jest.spyOn(console,'error').mockImplementation(()=>{});await expect(generateQRCode('fixture',options as any)).rejects.toThrow();expect(renderer).not.toHaveBeenCalled();
});
test.each([{width:'100000000'},{width:'300.5'},{width:['300']},{width:'0'},{margin:'33'},{darkColor:'fff'},{lightColor:'#ffffff'},{errorCorrection:'bad'},{simple:['true']}])('invalid query %j is rejected',query=>expect(()=>parseQrImageQuery(query)).toThrow());
test('query defaults/canonical variants and actual bounded PNG remain usable',async()=>{
 const first=parseQrImageQuery({}),same=parseQrImageQuery({width:'0300',margin:'01',darkColor:'000000',lightColor:'FFFFFF',errorCorrection:'M',simple:'false'});expect(first).toEqual(same);
 const image=await generateQRCode('http://127.0.0.1:3000/qr/fixture/scan',first.options);const bytes=Buffer.from(image.split(',')[1],'base64');expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(bytes.readUInt32BE(16)).toBe(300);expect(bytes.readUInt32BE(20)).toBe(300);
});
