// Vercel serverless function: receives site data from adminpanel.html, checks the
// admin password, and saves site-data.js to your GitHub repo. Vercel then
// redeploys automatically (about a minute).
// Environment variables (Vercel > Settings > Environment Variables):
//   ADMIN_PASSWORD  - the password you type in the admin panel
//   GITHUB_TOKEN    - fine-grained token: this repo only, Contents = Read and write
//   GITHUB_REPO     - e.g. yourname/themisfitjunkies
//   GITHUB_BRANCH   - optional, defaults to main
//   GITHUB_PATH     - optional, defaults to site-data.js (path inside the repo)
const crypto = require("crypto");

function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "POST only" });
  try {
    const env = process.env;
    if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || ""))
      return res.status(500).json({ ok: false, message: "Server is not set up yet (check the environment variables)." });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!same(body.password || "", env.ADMIN_PASSWORD)) {
      await sleep(800);
      return res.status(401).json({ ok: false, message: "Wrong password." });
    }
    // Accept only valid data, never raw code: parse it and re-write it ourselves.
    const text = String(body.content || "");
    if (text.length > 200000) return res.status(400).json({ ok: false, message: "Data too large." });
    const data = JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
    if (!data.event || !data.spotlight || !Array.isArray(data.servers) || !Array.isArray(data.staff))
      return res.status(400).json({ ok: false, message: "Data is missing a section." });
    const out = "window.SITE = " + JSON.stringify(data, null, 2) + ";\n";

    const branch = env.GITHUB_BRANCH || "main";
    const path = (env.GITHUB_PATH || "site-data.js").replace(/^\/+/, "");
    const url = "https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
    const headers = {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "User-Agent": "misfit-junkies-admin",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    let sha;
    const cur = await fetch(url + "?ref=" + encodeURIComponent(branch), { headers });
    if (cur.status === 200) sha = (await cur.json()).sha;
    else if (cur.status !== 404) {
      const e = await cur.json().catch(() => ({}));
      return res.status(502).json({ ok: false, message: "GitHub said: " + (e.message || cur.status) });
    }
    const put = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update site data from admin panel",
        content: Buffer.from(out, "utf8").toString("base64"),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.ok) return res.status(200).json({ ok: true });
    const e = await put.json().catch(() => ({}));
    return res.status(502).json({ ok: false, message: "GitHub said: " + (e.message || put.status) });
  } catch (e) {
    return res.status(400).json({ ok: false, message: "Could not read the data sent." });
  }
};
