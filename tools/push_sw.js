// ぽっと通話 — 通知の実験用 Service Worker（tools/ 専用・アプリ本体とは無関係）
//
// ★スコープは tools/ に限定される（push_test.html から相対パスで登録するため）。
//   **絶対にルートに置かないこと**：このアプリはビルド無しで「main に push したら即公開」なので、
//   ルートに SW を置いてキャッシュを持つと利用者が古い index.html に固定され、更新が届かなくなる。
//
// この SW は**キャッシュを一切持たない**（fetch ハンドラを書かない）。通知の実験だけに使う。

// 予約された通知。ページから postMessage で受け取り、待ってから出す。
// ★要点：`event.waitUntil()` で待つ。これをしないと、ブラウザは仕事が終わったと判断して
//   SW を止めてしまい、setTimeout が発火しない。どこまで待てるかが実験の本題。
self.addEventListener('message', event => {
  const d = event.data || {}
  if (d.type !== 'notify') return
  const delay = Math.max(0, Number(d.delay) || 0)
  const asked = Date.now()
  event.waitUntil(new Promise(resolve => {
    setTimeout(async () => {
      const late = Math.round((Date.now() - asked - delay) / 1000)
      const waited = Math.round((Date.now() - asked) / 1000)
      await self.registration.showNotification('ぽっと通話（実験）', {
        // 本文に「予定」と「実際」を書く＝通知そのものが実験結果になる（ログが失われても分かる）
        body: `予定 ${Math.round(delay / 1000)} 秒 → 実際 ${waited} 秒（ずれ ${late >= 0 ? '+' : ''}${late} 秒）`,
        tag: 'pot-test-' + asked,     // tag を変える＝まとめられずに個別に出る
        icon: '../images/icon-512.png',
        badge: '../images/icon-512.png',
        data: { asked, delay, waited },
      })
      // 開いているページがあれば記録も送る（閉じていれば届かない＝それも結果）
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      cs.forEach(c => c.postMessage({ type: 'fired', asked, delay, waited }))
      resolve()
    }, delay)
  }))
})

// 通知をタップしたら実験ページへ戻す
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of cs) {
      if (c.url.includes('push_test.html')) { c.postMessage({ type: 'clicked', data: event.notification.data }); return c.focus() }
    }
    return self.clients.openWindow('./push_test.html')
  })())
})

// 本物の Web Push（サーバが要る）を受けたとき用。**いまは送る側がいないので発火しない**。
// 置いてあるのは「購読までは作れるが、突く相手がいない」ことを実機で確かめるため。
self.addEventListener('push', event => {
  let body = '（中身なし）'
  try { body = event.data ? event.data.text() : body } catch {}
  event.waitUntil(self.registration.showNotification('ぽっと通話（push）', { body, tag: 'pot-push' }))
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
