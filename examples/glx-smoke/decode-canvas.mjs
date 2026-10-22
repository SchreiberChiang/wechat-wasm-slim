// Local analysis of the bounded 1x1 PNG returned through the cloud relay. No networking or file writes.
import zlib from 'node:zlib';
export function decodeOnePixel(hex) {
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2}){45,1024}$/.test(hex)) throw Error('Invalid bounded PNG hex');
  const bytes=Buffer.from(hex,'hex');
  if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Invalid PNG signature');
  const chunks=[];let header,palette,alpha;
  for(let at=8;at+12<=bytes.length;){
    const size=bytes.readUInt32BE(at),end=at+12+size;
    if(end>bytes.length)throw Error('Invalid PNG chunk');
    const kind=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
    if(kind==='IHDR')header=data;
    if(kind==='IDAT')chunks.push(data);
    if(kind==='PLTE')palette=data;
    if(kind==='tRNS')alpha=data;
    at=end;if(kind==='IEND')break;
  }
  if(!header||header.length!==13||header.readUInt32BE(0)!==1||header.readUInt32BE(4)!==1||header[8]!==8||header[10]!==0||header[11]!==0||header[12]!==0)throw Error('Only noninterlaced 8-bit 1x1 PNG is supported');
  const channels=({0:1,2:3,3:1,4:2,6:4})[header[9]];
  if(!channels)throw Error('Unsupported PNG color type');
  const raw=zlib.inflateSync(Buffer.concat(chunks),{maxOutputLength:64});
  if(raw.length!==channels+1||raw[0]>4)throw Error('Unexpected PNG scanline');
  // First pixel of the first row: all PNG filter predictors are zero, independent of filter type.
  let rgb,a=255;
  if(header[9]===0||header[9]===4){rgb=[raw[1],raw[1],raw[1]];if(header[9]===4)a=raw[2];}
  else if(header[9]===3){const i=raw[1];if(!palette||palette.length<i*3+3)throw Error('Invalid palette');rgb=[...palette.subarray(i*3,i*3+3)];a=alpha&&alpha.length>i?alpha[i]:255;}
  else{rgb=[raw[1],raw[2],raw[3]];if(header[9]===6)a=raw[4];}
  if(alpha&&header[9]===0&&alpha.length===2&&alpha.readUInt16BE(0)===raw[1])a=0;
  if(alpha&&header[9]===2&&alpha.length===6&&rgb.every((v,i)=>v===alpha.readUInt16BE(i*2)))a=0;
  return {rgb,alpha:a,nonblack:rgb.some(v=>v!==0),nontransparent:a!==0,source:'host_canvas_export_1x1_not_display_compositor'};
}
