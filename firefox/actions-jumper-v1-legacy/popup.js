const defaults={owner:"techrote",filters:"Running | is:in_progress\nQueued | is:queued\nFailed | conclusion:failure\nAll runs | "};
const repo=document.querySelector("#repo"), suggestions=document.querySelector("#suggestions"), filter=document.querySelector("#filter"),status=document.querySelector("#status");
let owner="techrote", names=[], selected=-1, timer, seq=0;
function validName(v){return /^[a-z0-9_.-]+$/i.test(v)&&v!=="."&&v!==".."&&v.length<=100}
function message(s,error=false){status.textContent=s;status.classList.toggle("error",error)}
function render(query=""){
 const list=names.filter(n=>n.toLowerCase().includes(query.toLowerCase())).slice(0,9);
 suggestions.replaceChildren(); selected=-1;
 for(const name of list){const li=document.createElement("li");li.textContent=name;li.setAttribute("role","option");li.setAttribute("aria-selected","false");li.addEventListener("mousedown",e=>{e.preventDefault();repo.value=name;hide()});suggestions.append(li)}
 suggestions.hidden=!list.length;repo.setAttribute("aria-expanded",String(!!list.length));
}
function hide(){suggestions.hidden=true;repo.setAttribute("aria-expanded","false");selected=-1}
function focusSelection(i){const items=[...suggestions.children];if(!items.length)return;selected=(i+items.length)%items.length;items.forEach((n,j)=>n.setAttribute("aria-selected",String(j===selected)));items[selected].scrollIntoView({block:"nearest"})}
async function loadNames(){
 const request=++seq;const cacheKey="repos:"+owner.toLowerCase();let fromCache=false;
 const stored=await browser.storage.local.get(cacheKey),cached=stored[cacheKey];
 if(cached?.items?.length){names=cached.items;fromCache=true;render(repo.value)}
 if(cached&&Date.now()-cached.when<10*60*1000){message(`${names.length} repositories cached`);return}
 try{
  let all=[];for(let page=1;page<=10;page++){
   const response=await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=full_name`,{headers:{"Accept":"application/vnd.github+json"}});
   if(!response.ok){throw Error(response.status===403?"API rate limit or access denied":`GitHub API HTTP ${response.status}`)}
   const payload=await response.json();if(request!==seq)return;
   all.push(...payload.map(r=>r.name));if(payload.length<100)break;
  }
  if(request!==seq)return;names=[...new Set(all)].sort((a,b)=>a.localeCompare(b));await browser.storage.local.set({[cacheKey]:{items:names,when:Date.now()}});
  render(repo.value);message(`${names.length} public repositories available${names.length>=1000?" (first 1000)":""}`);
 }catch(e){if(request!==seq)return;message(fromCache?`Using cached suggestions (${e.message})`:`Autocomplete unavailable: ${e.message}`,true)}
}
function openActions(){
 const value=repo.value.trim();if(!validName(value)){message("Enter a valid repository name.",true);return}
 const query=filter.value;const url=`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(value)}/actions${query?"?query="+encodeURIComponent(query):""}`;
 browser.tabs.create({url}).then(()=>window.close()).catch(e=>message(e.message,true));
}
document.querySelector("#jumpForm").addEventListener("submit",e=>{e.preventDefault();if(!suggestions.hidden&&selected>=0){repo.value=suggestions.children[selected].textContent;hide()}openActions()});
repo.addEventListener("input",()=>{render(repo.value);clearTimeout(timer);timer=setTimeout(()=>{if(!names.length)loadNames()},250)});
repo.addEventListener("keydown",e=>{
 if(e.key==="ArrowDown"&&!suggestions.hidden){e.preventDefault();focusSelection(selected+1)}
 else if(e.key==="ArrowUp"&&!suggestions.hidden){e.preventDefault();focusSelection(selected-1)}
 else if(e.key==="Escape"){hide()}
});
repo.addEventListener("blur",()=>setTimeout(hide,140));
document.querySelector("#settings").addEventListener("click",()=>browser.runtime.openOptionsPage());
(async()=>{
 const s=await browser.storage.local.get(defaults);owner=s.owner||defaults.owner;document.querySelector("#ownerLabel").textContent=owner;
 for(const line of s.filters.split(/\r?\n/).filter(Boolean)){const p=line.indexOf("|");if(p<0)continue;const o=document.createElement("option");o.textContent=line.slice(0,p).trim();o.value=line.slice(p+1).trim();filter.append(o)}
 if(!filter.options.length){const o=document.createElement("option");o.textContent="Running";o.value="is:in_progress";filter.append(o)}
 repo.focus();await loadNames();
})();
