# vendor/ — 同梱している外部ライブラリ（v0.16.2〜）

esm.sh から実行時に読み込んでいたライブラリを、**同じ中身のまま**ここに置いて自分のドメインから配る。
理由：第三者 CDN が侵害・再ビルドされても、全利用者のページで知らないコードが動かないようにする（脅威モデル S1）。
配信鍵・名刺の鍵を扱うページなので、読み込むコードは固定する。

| ファイル | 元 | 使う所 |
| :--- | :--- | :--- |
| `trystero-0.25.4.mjs` | `https://esm.sh/trystero@0.25.4?bundle` が指す `/trystero@0.25.4/es2022/trystero.bundle.mjs` | 参加（②ライブラリの読み込み）・ロビー |
| `nostr-tools-2.10.4.mjs` | `https://esm.sh/nostr-tools@2.10.4?bundle` が指す `/nostr-tools@2.10.4/es2022/nostr-tools.bundle.mjs` | 在室の公開・名刺の Nostr の確認 |
| `qrcode-generator-1.4.4.mjs` | `https://esm.sh/qrcode-generator@1.4.4?bundle` が指す `/qrcode-generator@1.4.4/es2022/qrcode-generator.bundle.mjs` | 招待の QR |

- **中身は 1 バイトも変えない**。`SHA256SUMS` と一致することを `test/smoke.py` の T76 が確かめる（`shasum -a 256 -c SHA256SUMS`）。
- **版を上げるとき**：同じ URL から取り直し、ファイル名の版・`index.html` の import と modulepreload・`SHA256SUMS`・`LICENSES.md`・この表を揃える。
  Trystero は版で通信の形が変わりうる（`index.html` の「Trystero 0.25.x API notes」と RUNBOOK §4 を先に読む）。版が同じなら通信の形は変わらず、本番・CLI・常設ページ・泡版とそのままつながる。
- ライセンス本文は `LICENSES.md`（中に含まれる依存も含む）。
- 読み上げ（piper-plus・onnxruntime-web）はまだ jsDelivr／unpkg から読む（wasm が 60MB あるため別に判断）。
