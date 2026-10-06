const CACHE="criptopro-v4";
const SHELL=["/","/index.html","/dashboard.html","/manifest.webmanifest"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener("push",event=>{
  let data={title:"CriptoPro",body:"Novo alerta do robô.",url:"/dashboard.html",tag:"criptopro-alert"};
  try { if(event.data) data={...data,...event.data.json()}; } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title,{
      body:data.body,
      icon:data.icon || "/favicon.ico",
      badge:data.badge || "/favicon.ico",
      tag:data.tag || "criptopro-alert",
      data:{url:data.url || "/dashboard.html"}
    })
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url || "/dashboard.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if("focus" in client){ client.navigate(url); return client.focus(); }
    }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;

  // HTML sempre tenta a versão atual do servidor primeiro.
  // Isso evita que o dashboard fique preso em uma versão antiga
  // do cache após novos deploys.
  const isPage =
    event.request.mode === "navigate" ||
    event.request.destination === "document";

  event.respondWith(
    fetch(event.request, { cache: "no-store" }).then(response=>{
      const copy=response.clone();
      if(!isPage){
        caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>caches.match(event.request))
  );
});
