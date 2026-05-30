/* Limo's World service worker — installable + full offline support.
   On the first (online) visit it downloads every flag and map shape so the
   whole app works with no connection afterwards. */
const CACHE = "limos-world-v6";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png"
];

// Every country code — used to pre-cache all flags and shapes for offline use.
const CODES = [
  "af","al","dz","ad","ao","ag","ar","am","au","at","az","bs","bh","bd","bb","by",
  "be","bz","bj","bt","bo","ba","bw","br","bn","bg","bf","bi","cv","kh","cm","ca",
  "cf","td","cl","cn","co","km","cg","cd","cr","ci","hr","cu","cy","cz","dk","dj",
  "dm","do","ec","eg","sv","gq","er","ee","sz","et","fj","fi","fr","ga","gm","ge",
  "de","gh","gr","gd","gt","gn","gw","gy","ht","hn","hu","is","in","id","ir","iq",
  "ie","il","it","jm","jp","jo","kz","ke","ki","kw","kg","la","lv","lb","ls","lr",
  "ly","li","lt","lu","mg","mw","my","mv","ml","mt","mh","mr","mu","mx","fm","md",
  "mc","mn","me","ma","mz","mm","na","nr","np","nl","nz","ni","ne","ng","kp","mk",
  "no","om","pk","pw","ps","pa","pg","py","pe","ph","pl","pt","qa","ro","ru","rw",
  "kn","lc","vc","ws","sm","st","sa","sn","rs","sc","sl","sg","sk","si","sb","so",
  "za","kr","ss","es","lk","sd","sr","se","ch","sy","tj","tz","th","tl","tg","to",
  "tt","tn","tr","tm","tv","ug","ua","ae","gb","us","uy","uz","vu","va","ve","vn",
  "ye","zm","zw"
];

const flagUrl  = (c) => "https://flagcdn.com/w320/" + c + ".png";
const shapeUrl = (c) => "https://cdn.jsdelivr.net/gh/djaiss/mapsicon@master/all/" + c + "/512.png";

function mediaUrls() {
  const list = [];
  CODES.forEach((c) => { list.push(flagUrl(c)); list.push(shapeUrl(c)); });
  return list;
}

// Cache one cross-origin image (opaque responses are fine for <img>).
function cacheMedia(cache, url) {
  return fetch(url, { mode: "no-cors", cache: "no-cache" })
    .then((res) => cache.put(url, res))
    .catch(() => {}); // ignore individual failures so one bad image won't break install
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL);
      // Pre-download all flags and shapes (allSettled = tolerate any misses).
      await Promise.allSettled(mediaUrls().map((u) => cacheMedia(cache, u)));
      // Tell any open page that the offline bundle is ready.
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: "offline-ready" }));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  const isMedia = url.hostname.includes("flagcdn.com") || url.hostname.includes("jsdelivr.net");
  if (isMedia) {
    // Cache-first; if missing and online, fetch + store; if offline, give back whatever we have.
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req, { mode: "no-cors" }).then((res) => {
            cache.put(req, res.clone());
            return res;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  // App shell / same-origin: cache-first, fall back to network, then the cached page.
  event.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
