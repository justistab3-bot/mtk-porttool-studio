/**
 * 抓取并提取微信文章正文（一次性工具，用于阅读参考资料）。
 * 微信页面由 JS 渲染，这里用正则从原始 HTML 中取出 rich_media 区块。
 */
const URL = process.argv[2];
const OUT = process.argv[3];

const ua =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const res = await fetch(URL, { headers: { "user-agent": ua } });
const html = await res.text();
console.log(`status=${res.status} bytes=${html.length}`);

const pick = (re) => {
  const m = re.exec(html);
  return m ? m[1] : "";
};

const title = pick(/<h1[^>]*class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/);
const author = pick(/id="js_name"[^>]*>([\s\S]*?)<\/a>/);
const contentRe =
  /<div[^>]*class="rich_media_content[^"]*"[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/;
let body = pick(contentRe);
if (!body) {
  // 回退：取 js_content 起始到 section 结束
  const idx = html.indexOf('id="js_content"');
  if (idx > 0) body = html.slice(idx, idx + 400000);
}

const text = body
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<br\s*\/?>/g, "\n")
  .replace(/<\/(p|section|div|h[1-6]|li|blockquote|pre)>/g, "\n")
  .replace(/<img[^>]*>/g, "[图片]")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const out = `标题：${title.replace(/<[^>]+>/g, "")}\n来源：${author}\n\n${text}\n`;
console.log(`title=${title.replace(/<[^>]+>/g, "")}`);
console.log(`text length=${text.length}`);
if (OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, out, "utf8");
  console.log(`written to ${OUT}`);
} else {
  console.log(out.slice(0, 6000));
}
