// pot-turn ── TURN 資格情報を発行する Cloudflare Worker
//
// **これは運営が動かす唯一のコード**。ここが止まると TURN が取れなくなり、全員が直結
// （STUN のみ）にフォールバックする＝相手に IP アドレスが見えるようになり、ロビーの
// メッシュも張りにくくなって部屋の取りこぼしが増える。**しかもエラーは表に出ない。**
//
// ## 法的 posture 上の位置づけ（CLAUDE.md 参照・重要）
// このWorkerは **「合鍵を渡すだけ」＝資格情報の発行機であって、通信の経路ではない**。
// 音声・シグナリング・在室のいずれもここを通らない（TURN サーバ自体は Cloudflare のもの）。
// だから運営は「他人の通信を媒介する」側に回らず、電気通信事業者にならない。
// **運営が書くコードは、この形（認証・調整だけで、通信そのものを運ばない）に留めること。**
// 通信内容や在室を自前で受け取る・保存する・中継するようにした瞬間、この分析は崩れる。
//
// ## デプロイ
//   Cloudflare Workers に配置。シークレットは環境変数で渡す（コードには書かない）。
//     TURN_KEY_ID         … Cloudflare Realtime の TURN キーID
//     TURN_KEY_API_TOKEN  … 同 APIトークン
//   ★S3 で追加した任意の設定（未設定なら従来どおりの挙動）:
//     TURN_MAX_PER_MIN    … 1クライアント（IP+Origin）の 1 分あたり上限。既定 30
//     TURN_ACCESS_SECRET  … 設定したときだけ「X-Pot-Turn-Token」ヘッダを要求する（下記）
//   公開URL: https://pot-turn.itsuma-kuramoto.workers.dev/
//   本体からは index.html の TURN_WORKER_URL が指している。
//
// ## 判断の記録
// - **`ttl: 14400`（4時間）** … 2026-08-01 に 86400（24時間）から 1800（30分）へ短縮したが、
//   2026-08-13 にそれが通話を切っている疑いが出たため 4時間へ戻した。
//   **短縮時の見落とし**：アプリの `refreshIce` が効くのは*これから作る*接続だけ。
//   既に確立している接続は「作ったときの資格情報」で TURN の割り当てを延長し続けるので、
//   期限が来ると延長を拒否され、割り当てごと消える。**relay-only なので逃げ道が無く通話が落ちる**
//   （しかも入退室では直らない＝リロードだけが直る。2026-08-13 に実際に起きた症状と一致）。
//   → **一本の接続の寿命は ttl でほぼ決まる**。通話の上限だと思って値を選ぶこと。
//   4時間なら実用上の通話は収まり、漏れたときの利用権は24時間より一桁小さい。
//   ※ **24時間耐久のような使い方は、この数字では届かない**（上限は Cloudflare の 86400）。
//     必要になったら「期限前に黙って繋ぎ直す」実装で解く。数字を上げる方向に解は無い。
//   ※ **「30分で落ちる」の実証はまだ済んでいない**（2026-08-13 時点）。50分の通話で確かめること。
//     もし 14400 にしても同じ頃に落ちるなら、原因は資格情報の期限ではない。
//   **これより短くするなら、アプリの `ICE_REFRESH_MS` と `ICE_TTL_MS` も見直すこと。**
// - **Origin の許可リスト** … 完全一致（前方一致にしないこと）。`Vary: Origin` は必須
//   （CDN が origin ごとに応答を分けないと、他人向けの応答が混ざる）。
//   `!ok` の 403 は**上流を叩く前**に置く＝弾く相手のぶんの資格情報を発行しない。
//   移設中は新旧＋org の github.io を並べておく（旧サイトを誘導ページにしたら外せる）。
// - **レート制限（S3・2026-10-31 導入）** … 無料プランの日次 10 万リクエストを使い切られると、
//   その日は資格情報が配れず全員が直結（IP が見える）に落ちる。以前は「意図して入れていない」
//   （下記 2026-10-12 の検討記録）だったが、アプリ通常の取り直し（10 分に 1 回・通話開始時数回）を
//   大きく上回る 1 分 30 回/IP を上限として入れる。二段構成:
//     ① wrangler の Rate Limiting binding（`env.turnLimiter`）が設定されていればそれを使う
//       （wrangler.toml の [[unsafe.bindings]] type="ratelimit"・呼び方は limit({ key })。設定方法はこの下の B 案参照）
//     ② 未設定なら isolates 内のメモリすべり窓（近似：isolate が増えるほど緩和側にずれる）
//   超過は 429 + Retry-After:30。アプリ側は 429 を「上流が一時的に拒否」として従来の
//   502 と同じフォールバック（直結 STUN）で扱う＝通話は落ちない。
//   ※ 多数の IP を使い分けられると防ぎきれない（2026-10-12 の記録と同じ留保）。監視はやめない。
//   旧記録（2026-10-12、導入前の検討）：叩き続けて使い切られると課金ではなく「止まる」リスク。
//   検討案：A＝独自ドメインへ移して WAF のレート制限／B＝Wrangler の Rate Limiting binding
//   （画面から設定不可・デプロイ手順が変わる）／C＝アプリの取り直し間隔（10 分）を延ばす。
//   得られるのは4時間の利用権（2026-08-13 に30分から延長）。**その代わりの前提条件が
//   「Cloudflare ダッシュボードで TURN 利用量を監視すること（アラートか月イチの目視）」。
//   これを怠ると保留の根拠が消える。窓が8倍になったぶん、この監視の重みも増した。**
//   **2026-10-12 追記（Workers 無料プランの上限を使い切られる場合）**：無料プランは 1 日 10 万リクエストまで。
//   叩き続けて使い切られると、その日は資格情報が配れず全員が直結（IP が見える）に落ちる＝課金ではなく「止まる」リスク。
//   検討した案：A＝Worker を potalk.app の独自ドメインに移して WAF のレート制限ルール（画面だけ）／B＝Wrangler で
//   Rate Limiting binding（画面からは設定不可・デプロイ手順が変わる）／C＝アプリの取り直し間隔（10 分）を延ばす。
//   いずれも多数の IP を使い分けられると防ぎきれない。①は B の実装、②は当面の暫定版。
// **認証の土台（S3・2026-10-31）**：`TURN_ACCESS_SECRET` を設定したときだけ `X-Pot-Turn-Token`
//   ヘッダの一致を要求し、違えば 401。既定（未設定）は従来どおりヘッダなしで通す。
//   注意：静的な index.html はソースが丸見えなので**恒久の秘密にはできない**（2026-06-11 の
//   「公開ファイルに秘密を書かない」教訓）。この土台は (a) 管理下のクライアントだけで試す
//   移行スイッチ、(b) 将来「Worker が発行する短命の使い捨てトークン」へ作り替えるための
//   枠、として置く。アプリ側がトークンを送るようにするのは index.html 側の次の変更。
//   比較は通常の !==（Worker に定数時間比較の要件はないが、秘密は推測されにくい長さを選ぶ）。
// - `Cache-Control: no-store` … 短命の資格情報をブラウザにキャッシュさせない。
// - 上流の応答は `iceServers` だけ取り出して返す（余計なフィールドを漏らさない）。
//   エラーも上流の文面を返さず 'turn unavailable' に丸める。

// ---- S3 ②: binding 未設定時のメモリすべり窓（isolate 単位の近似。0 にしてはならない:
//      上流 fetch の前に置く＝弾いたぶんは Cloudflare を叩かない）----
const WINDOW_MS = 60_000
const MAX_DEFAULT = 30
const hits = new Map()
function rateLimited(key, maxPerMin) {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter(t => now - t < WINDOW_MS)
  arr.push(now)
  hits.set(key, arr)
  if (hits.size > 5000) { // 窓外レコードの掃除（叩かれ続けてもメモリは増え続けない）
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= WINDOW_MS) hits.delete(k)
  }
  return arr.length > maxPerMin
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowed = ['https://potalk.app', 'https://beta.potalk.app', 'https://po-talk.github.io', 'https://qramo.github.io', 'http://localhost:8000']
    const ok = allowed.includes(origin)
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pot-Turn-Token',
      'Vary': 'Origin',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'GET')
      return new Response(null, { status: 405, headers: cors })
    // ブラウザは cross-origin fetch で必ず Origin を送るので、正規アプリはここを通る。
    // curl は偽装できるため完封ではない＝一段目のフィルタ（二段目は下の新・レート制限）
    if (!ok) return new Response(null, { status: 403, headers: cors })
    // ---- S3 認証の土台: 未設定なら素通り（従来互換）----
    if (env.TURN_ACCESS_SECRET && request.headers.get('X-Pot-Turn-Token') !== env.TURN_ACCESS_SECRET)
      return new Response(JSON.stringify({ error: 'missing token' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    // ---- S3 レート制限: 上流を叩く前に弾く ----
    const clientKey = origin + '|' + (request.headers.get('CF-Connecting-IP') || 'unknown')
    try {
      if (env.turnLimiter) {
        const lim = await env.turnLimiter.limit({ key: clientKey })
        if (!lim.success) return new Response(JSON.stringify({ error: 'rate limited' }),
          { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '30' } })
      } else {
        const max = Number(env.TURN_MAX_PER_MIN) > 0 ? Number(env.TURN_MAX_PER_MIN) : MAX_DEFAULT
        if (rateLimited(clientKey, max)) return new Response(JSON.stringify({ error: 'rate limited' }),
          { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '30' } })
      }
    } catch { /* リミタ側が壊れても配信は止めない（fail-open・監視は続けないと危ない） */ }
    try {
      const r = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        { method: 'POST',
          headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 14400 }) }   // ＝一本の接続の寿命。上の「判断の記録」参照
      )
      if (!r.ok) throw 0
      const data = await r.json()
      if (!data.iceServers || !Array.isArray(data.iceServers) || data.iceServers.length === 0) throw 0
      return new Response(JSON.stringify({ iceServers: data.iceServers }),
        { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    } catch {
      return new Response(JSON.stringify({ error: 'turn unavailable' }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
  }
}
