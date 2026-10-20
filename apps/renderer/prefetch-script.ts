/**
 * index.html 头部内联的 DSL 预取脚本（vite.config.ts 的 dslPrefetch 注入）。
 *
 * 必须与 src/runtime/api.ts 的 dslRequest 拼出同一个地址、带同一个请求头（访客 id、渠道码、登录态），
 * 访客 id 的生成格式也要与 getOrCreateGuestId 一致——对不上的话预取就白发了一次请求。
 * 单独成文件是为了让测试能在 jsdom 里真跑这段脚本，与 dslRequest 的结果逐字对比。
 * 语法保持 ES5：它在框架代码加载之前执行，不经过任何编译。
 */
export function dslPrefetchScript(apiBase: string): string {
  return `(function(){try{var q=new URLSearchParams(location.search);if(q.get('preview'))return;var id=q.get('id')||location.pathname.split('/act/')[1];var dsl=q.get('dsl');if(!id&&!dsl)return;var url,headers={};if(dsl){url=dsl}else{var gid=null,token=null;try{gid=localStorage.getItem('nca:guest-id');if(!gid){gid='guest_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem('nca:guest-id',gid)}token=localStorage.getItem('nca:rt-token')}catch(e){return}var u=new URL(${JSON.stringify(apiBase)}+'/runtime/activities/'+id+'/dsl');u.searchParams.set('gid',gid);if(q.get('ch'))u.searchParams.set('ch',q.get('ch'));url=u.toString();if(token)headers.Authorization='Bearer '+token}var p=fetch(url,{headers:headers}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json().then(function(d){return{data:d,version:r.headers.get('X-NCA-Version')}})});p.catch(function(){});window.__NCA_DSL_PREFETCH__={url:url,promise:p}}catch(e){}})();`;
}
