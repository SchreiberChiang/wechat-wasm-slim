// Local argv transport only. Does not parse JSON or perform any task action.
const PREFIX='wxslim-json64:';
const LIMIT=16384;
const ERROR='LOCAL_PAYLOAD_WIRE_INVALID';
function need(value){if(!value)throw Object.assign(Error(ERROR),{code:ERROR});}

export function decodePayloadArgument(value){
  if(value===undefined)return undefined;
  need(typeof value==='string');
  if(!value.startsWith(PREFIX))return value;
  const encoded=value.slice(PREFIX.length);
  need(encoded.length<=Math.ceil(LIMIT/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded));
  const bytes=Buffer.from(encoded,'base64');
  need(bytes.length<=LIMIT&&bytes.toString('base64')===encoded);
  const text=bytes.toString('utf8');
  need(Buffer.from(text,'utf8').equals(bytes));
  return text;
}
