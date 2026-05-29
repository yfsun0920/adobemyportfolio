import https from "https";

const id = "SyRv7Nht_CC";
const embedUrl = `https://www-ccv.adobe.io/v1/player/ccv/${id}/embed?api_key=BehancePro2View`;
const html = await new Promise((res, rej) => {
  https.get(embedUrl, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://yifeisun.myportfolio.com/" } }, (r) => {
    let d = "";
    r.on("data", (c) => (d += c));
    r.on("end", () => res(d));
  }).on("error", rej);
});
const mp4s = [...html.matchAll(/https:\/\/cdn-prod-ccv\.adobe\.com\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi)].map((m) => m[0]);
mp4s.forEach((u) => console.log(u.match(/_(\d+)\.mp4/)?.[1] || "?", u.slice(0, 120)));
