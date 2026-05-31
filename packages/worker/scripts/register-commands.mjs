// Register guild slash commands for ChipPot. Reads DISCORD_BOT_TOKEN + DISCORD_APPLICATION_ID
// from packages/worker/.dev.vars (gitignored) and DISCORD_GUILD_ID from env or .dev.vars.
//   node scripts/register-commands.mjs           (uses .dev.vars)
//   DISCORD_GUILD_ID=123 node scripts/register-commands.mjs
//
// Keep these payloads in sync with PAY_COMMAND / INITIATE_COMMAND in src/adapters/discord/commands.ts
// (duplicated here because this .mjs can't import the TS module without a build step).
import { readFileSync } from "node:fs";

function loadDotVars(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

const vars = { ...loadDotVars(new URL("../.dev.vars", import.meta.url).pathname), ...process.env };
const TOKEN = vars.DISCORD_BOT_TOKEN;
const APP_ID = vars.DISCORD_APPLICATION_ID;
const GUILD_ID = vars.DISCORD_GUILD_ID;
if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error("Need DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID");
  process.exit(1);
}

const commands = [
  {
    name: "繳費", type: 1,
    description: "登記本期繳費（一次涵蓋你所有訂閱，可選渠道／截圖／備註）",
    options: [
      { type: 3, name: "渠道", description: "繳費渠道", autocomplete: true, required: false },
      { type: 11, name: "截圖", description: "繳費截圖（PNG / JPG / WebP）", required: false },
      { type: 3, name: "備註", description: "備註（自由文字，僅供審核參考）", required: false },
    ],
  },
  {
    name: "發起繳費", type: 1,
    description: "（管理員）確認本期各方案金額並發出開繳通知",
    default_member_permissions: "32",
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
