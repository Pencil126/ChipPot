# ChipPot — Discord-first 繳費流程改版 設計 spec

> 2026-05-31。對既有 ChipPot 系統的行為改版。背景：主要收款的管理員手上已有每個人的
> 付款通知，**不需要截圖**；希望繳費操作**全部留在 Discord**，預設不再丟上傳網頁連結。

## 目標 / 不做的事

- 繳費預設走 **Discord 內**：常駐「繳費」按鈕 → 選渠道 → 送出；不再預設給網頁連結。
- 截圖**可選**；新增「渠道」選擇；`截圖 / 備註 / 渠道` 三者**至少一項**。
  - 此規則對 **`/繳費`(B) 與網頁(C)** 生效（三者皆為可選欄位）。
  - **按鈕(A)** 的渠道 select 為必選，故恆滿足；不會產生三者全空的 paid（審查點 1）。
- **多訂閱加總**：一個人多個方案 → 顯示總額、一次送出標記其所有當期 payment 已繳。
- 「開繳通知」改名「**發起繳費**」，可由管理員**手動觸發**（Discord 指令 + 後台按鈕），
  觸發前先確認/可改當月各方案金額；手動發起後當月 cron 不重發。
- 保留「審核」這關（送出=已繳，管理員確認收款後驗證）。
- **不做**：移除網頁上傳頁（仍保留，供管理員手動產生連結時使用，並補上渠道選項）。

## 名詞

- **方案現價** `plans.monthly_amount`：方案目前的月費。改價只影響「未來新建的 payment」。
- **當期金額** `payments.amount`：每筆 payment 自己記的金額，建立/發起繳費調整/單筆覆寫時定下，
  之後不受改價影響。**對帳看板一律以此為準。**
- **申報渠道** `payments.declared_channel_tag_id`（新欄位）：使用者選的渠道（聲明）。
- **認定渠道** `payments.verified_channel_tag_id`：管理員審核時認定（對帳依據）；驗證時自動帶入申報渠道、可改。

## 資料模型變更

1. **新增 migration**（payments）：
   - `declared_channel_tag_id INTEGER REFERENCES channel_tags(id)`（使用者申報渠道）。
1b. **settings 新增** `admin_discord_ids: string[]`（`WorkspaceSettings` + `parseSettings`，
   預設 `[]`）：可發起繳費的管理員 discord_id 白名單（審查點 5）。
2. **移除** `idx_payments_screenshot_key`（唯一索引）：多訂閱一次繳費共用同一張截圖時，
   同一 `screenshot_key` 會出現在該使用者本期的多筆 payment。安全性仍靠隨機 key + token 原子性。
3. 其餘 schema 不變。

> **Retention 必須改成引用計數（審查點 3 — 最重要的雷）**：一張圖被 N 筆 payment 共用，逐筆
> retention 刪圖會讓還沒過期的其他筆變成指向已刪 R2 物件的死連結。新規則：對每筆過期 payment，
> **先**清掉**自己這筆**的 `screenshot_key`（set NULL + `proof_deleted_at`），**再**查
> `SELECT COUNT(*) FROM payments WHERE screenshot_key = K`；**只有當計數為 0（最後一個引用）才
> 真正 `BUCKET.delete(K)`**，否則保留 R2 物件。audit 照舊。共用同一張的多筆通常同時 paid、同時
> 過期，但引用計數能正確處理部分過期（例如其中一筆被退回重繳換了 key）。

## 核心：一次繳清使用者本期所有訂閱

新增核心函式（channel-agnostic）`settleUserPeriod(env, input)`：
- 輸入：`workspaceId, userId, period, declaredChannelTagId?, paymentNote?, proof?{key 已存好}`、`source`。
- 行為：對該 user 在該 period 的**所有 active 訂閱**，`ensurePeriodPayment` 後，把**狀態為
  pending/rejected 的 payment** 全部更新為 `paid`：set `has_proof`、`screenshot_key`(若有)、
  `declared_channel_tag_id`、`payment_note`(COALESCE)、`source`、`submitted_at`、`paid_at`。
- 回傳：`{ paidCount, totalAmount, alreadyPaidCount }`。
- 截圖：若有 proof，先 R2 put（一張），同一 key 設到所有更新的 payment（移除唯一索引後可行）。
- token 路徑（網頁）：在同一 D1 batch 內原子地claim token（沿用 submitProofWithToken 的雙閘思路，
  以 paid_at 為關聯標記），確保 token 一次性。Discord 按鈕/slash 不需 token（互動本身已驗身分）。

「本期應繳總額」= 該 user 所有 active 訂閱在該 period 的 `payments.amount` 加總
（pending + 本次要繳的）。**個人總額只在使用者觸發時私下(ephemeral)顯示，不公開。**

## 收費入口

### A. 常駐「繳費」按鈕（主力）
1. 使用者按按鈕（custom_id `chippot:pay:<ws>:<v>`）。
2. Bot 算出該 user 本期 **pending** 的訂閱，分流：
   - **0 筆 pending（已全部繳清）→ ephemeral 明說：「✅ 你本期已登記繳費，無需重複操作。」** 結束。
     （審查點 2：避免使用者誤以為沒繳成功而重複操作或重複付款。）
   - 0 筆 active 訂閱 → ephemeral：「你目前沒有有效訂閱。」
   - 否則 → ephemeral：列出 pending 各方案金額 + **總額**；附**渠道下拉**
     (string select，`min_values=1, max_values=1`，選項=active channel_tags) + 提示「想附截圖/備註？改用 `/繳費`」。
3. 使用者選渠道（**必選**）→ select 互動送出 → `settleUserPeriod(declaredChannelTagId=選的渠道, source='user_slash')`。
   （`source` 沿用既有 enum；按鈕與 `/繳費` 都屬 Discord 使用者互動，皆記 `user_slash`，避免改 CHECK 需重建表。）
4. ephemeral 更新：「✅ 已登記 NT$<總額>（<渠道>），共 N 筆。管理員確認收款後完成。」
5. **渠道 select 為必選 → 按鈕路徑一定有渠道**，「至少一項」恆成立（審查點 1）。
   建議管理員保留一個「其他/未指定」channel_tag，給不確定渠道的人選。

### B. `/繳費` 指令
- 參數：`渠道`(string, autocomplete=channel_tags) + `截圖`(attachment, 可選) + `備註`(string, 可選)。
- 規則：`截圖 / 備註 / 渠道` **至少一項**，否則 ephemeral 提示。
- 一律 deferred ephemeral；背景：（有截圖則下載+驗證+R2）→ `settleUserPeriod(...)` 一次涵蓋所有訂閱 → followup。

### C. 網頁上傳頁（非預設，僅管理員手動連結）
- 維持 token-gated；表單加上**渠道下拉**；`截圖 / 備註 / 渠道` 至少一項。
- 送出 → token 路徑的 `settleUserPeriod`（原子 claim token）。

## 「發起繳費」（原開繳）— 手動觸發 + 金額確認

### 觸發點（兩者都做）
- **Discord**：`/發起繳費`（限管理員）。**管理員判斷（審查點 5 — 改用白名單，不用 MANAGE_GUILD）**：
  新增 `workspace.settings.admin_discord_ids`（字串陣列，與後台 Access 的 `ACCESS_ALLOWED_EMAILS`
  概念對齊，本期＝你 + 網管的 discord_id）。handler **以 interaction member 的 discord_id 是否在此
  白名單為準**（MANAGE_GUILD 可能被其他幹部/社長持有，太寬）。指令仍可設
  `default_member_permissions=MANAGE_GUILD` 當 UI 過濾，但**授權判斷一律走白名單**。
  → 開 **modal**，每個 active 方案一個文字欄位帶出現價（≤5 方案）。管理員改完送出。
- **後台**：設定頁按鈕「立即發起本期開繳通知」→ 彈窗列各方案金額(可改) → 確認。

### 確認後動作（共用核心 `initiateBillingOpened(env, period, amounts, opts, actor)`）
> **審查點 4 — 解耦「臨時調當月」vs「永久改定價」**：modal/彈窗加一個 toggle
> **「同時更新方案定價」(預設開)**，並附說明「此金額將成為各方案的新定價」。
> - 開（預設）：寫回 `plans.monthly_amount`（在 Discord 發起＝順手改定價，下期沿用）。
> - 關：**只改本期 payment 金額，不動 `plans.monthly_amount`**（這個月特例，下期仍用原定價）。

1. **（toggle 開時）更新方案現價**：把確認的金額寫回 `plans.monthly_amount`。
2. **建/改本期 payment**：對各 active 訂閱 `ensurePeriodPayment`；把該期**仍 pending** 的
   payment.amount 更新為新金額（paid/verified 不動 → 凍結歷史）。**此步永遠執行**（與 toggle 無關）。
3. **發開繳通知**：`claimNotification(billing_opened, period)` 成功才發 → 公開訊息 tag 各方案身分組
   + 各方案金額 + 繳費按鈕。（已 claim 過則不重發。）
4. 寫 audit（`billing.initiate`、`amount.override` per plan）。

### Cron 與手動去重
- cron 的開繳通知一樣走 `claimNotification(billing_opened, period)`。
- **若當月已手動發起（slot 已被 claim）→ cron 跳過開繳通知**（不重發、不洗版）。
- cron 仍照常：建當期 payment（冪等）、逾期提醒、retention。

## 對帳看板（確認既有行為，不變）
- 所有金額 `SUM(payments.amount)`，反映**當期實際金額**，不受日後改價影響；歷史凍結。
- 加上「申報渠道」欄位顯示；審核（驗證）時 `verified_channel_tag_id` 預設帶入 `declared_channel_tag_id`，可改。

## 影響的檔案（概要）
- `migrations/0004_declared_channel_drop_unique.sql`（新欄位 + drop 唯一索引）。
- `core/storage.ts`：`settleUserPeriod`（取代/擴充 submitProof/recordProof/recordDeclared 的單筆邏輯為「一次繳清」）。
- `core/billing.ts`：`initiateBillingOpened`（更新現價 + 改 pending 金額 + 觸發通知）。
- `core/scheduled.ts`：cron 開繳改呼叫共用觸發 + 去重已自動生效。
- `adapters/discord/handler.ts`：按鈕→渠道 select 流程；`/繳費` 加渠道參數 + 一次繳清；`/發起繳費` modal。
- `adapters/discord/commands.ts`：`/繳費` 加 `渠道` option；新增 `/發起繳費` 指令；select menu 元件。
- `routes/upload.ts` + `packages/web`：加渠道選項、改用 settleUserPeriod、至少一項。
- `routes/admin.ts`：`POST /admin/billing/initiate`（金額確認後觸發）；驗證帶入申報渠道；reconcile 加 declared 顯示。
- `packages/admin`：設定頁「發起繳費」彈窗；審核彈窗顯示申報渠道、驗證預設帶入。

## 測試重點
- 多訂閱：一次繳清 → 兩筆都 paid、共用截圖 key、總額正確、已繳的不再重複。
- 渠道：申報渠道寫入；驗證預設帶入 declared、可改。
- 至少一項規則（slash/web）：三皆空 → 擋。
- 發起繳費：改金額 → plans 現價更新 + 該期 pending 金額更新 + paid 不變 + 通知發送 + 去重。
- cron 去重：手動發起後 cron 不重發開繳。
- 對帳：看板金額 = payments.amount，不受改價影響。

## 待確認 / 已決定
- (決定) 個人總額僅 ephemeral 私下顯示；公開訊息只列各方案金額。
- (決定) 多訂閱共用截圖 → 移除 screenshot_key 唯一索引。
- (決定) `/發起繳費` 用 Discord modal 改金額。
- (決定) 發起繳費確認金額同時更新方案現價。
- (確認) 對帳看板以 payments.amount（當期實際）為準，不受改價影響。
- (決定) 按鈕與 `/繳費` 的 `source` 都記 `user_slash`（沿用既有 enum，不重建表）。

### 審查回饋處理（2026-05-31，owner review）
1. ✅ 按鈕渠道 select 必選（min_values=1）→「至少一項」恆成立；規則正式只對 B/C。
2. ✅ 已繳清 ephemeral 明說「你本期已登記繳費，無需重複操作」。
3. ✅ Retention 改**引用計數**：計數為 0 才刪 R2 物件，避免死連結。
4. ✅ 發起繳費加 toggle「同時更新方案定價」(預設開)，可只調當月不動定價。
5. ✅ `/發起繳費` 授權改 `settings.admin_discord_ids` 白名單（不只靠 MANAGE_GUILD）。
6. ✅ 確認：手動發起已 ensurePeriodPayment，cron 再跑為冪等 no-op，無重複建 payment。
