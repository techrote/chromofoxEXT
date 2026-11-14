const defaults={owner:"techrote",filters:"Running | is:in_progress\nQueued | is:queued\nFailed | conclusion:failure\nAll runs | "};
const owner=document.querySelector("#owner"), filters=document.querySelector("#filters"), saved=document.querySelector("#saved");
browser.storage.local.get(defaults).then(s=>{owner.value=s.owner;filters.value=s.filters});
document.querySelector("#options").addEventListener("submit",async e=>{
 e.preventDefault();const value=owner.value.trim();
 if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value)||value.includes("--")){saved.textContent="Invalid GitHub owner";return}
 const lines=filters.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 if(!lines.length||lines.some(v=>!v.includes("|")||!v.split("|")[0].trim())){saved.textContent="Add presets as Label | query";return}
 await browser.storage.local.set({owner:value,filters:lines.join("\n")});
 saved.textContent="Saved";
});
