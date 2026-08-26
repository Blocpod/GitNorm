import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureSchema, getD1, getFilesBucket } from '@/lib/gitnorm';

export async function GET(_request: Request, context: {params:Promise<{id:string}>}) {
  await ensureSchema(); const {id}=await context.params; const user=await getChatGPTUser();
  const file=await getD1().prepare(`SELECT f.path,f.storage_key AS storageKey,f.mime_type AS mimeType,p.owner_id AS ownerId,p.visibility,v.number,(SELECT MAX(number) FROM versions WHERE project_id=p.id) AS latest FROM project_files f JOIN versions v ON v.id=f.version_id JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.deleted_at IS NULL`).bind(id).first<{path:string;storageKey:string;mimeType:string;ownerId:string;visibility:string;number:number;latest:number}>();
  if (!file || (file.ownerId!==user?.userId && !(file.visibility==='public'&&file.number===file.latest))) return new Response('Not found',{status:404});
  const object=await getFilesBucket().get(file.storageKey); if(!object) return new Response('Not found',{status:404});
  const safeInline=/^(text\/plain|application\/json|image\/(png|jpeg|gif|webp))/.test(file.mimeType); const type=safeInline?file.mimeType:'application/octet-stream';
  return new Response(object.body,{headers:{'Content-Type':type,'Content-Disposition':`${safeInline?'inline':'attachment'}; filename="${file.path.split('/').pop()?.replaceAll('"','')||'file'}"`,'X-Content-Type-Options':'nosniff','Cache-Control':file.visibility==='public'?'public, max-age=300':'private, no-store'}});
}
