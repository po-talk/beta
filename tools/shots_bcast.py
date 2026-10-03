#!/usr/bin/env python3
"""使い方ページ（/manual/）の「配信部屋」の節のスクリーンショットを撮る。

    python3 tools/shots_bcast.py      # images/manual/12〜14 を作り直す（約 2 分）

tools/shots.py と同じ条件（隔離した appId・iPhone 幅・昼の配色・架空の名前）。撮るもの：
  12-bc-owner     主の画面のメンバー：📣 主／🙋 通話希望の人／「🙂 ほか N 人が聞いています」
  13-bc-listener  聞き役の画面：メンバー（主と「ほか N 人」）と「通話希望」ボタン
  14-bc-quiet     通話中の部屋の一覧から配信部屋をタップしたときの確認（🤫 静かに入る）
"""
import sys, os, time, random, string, argparse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'test'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import smoke
from shots import shot, persona, setup, W, H


# 複数の要素をまとめた矩形（shot() の clip_expr に渡す。getBoundingClientRect だけ持つ偽の要素）
UNION = ("(() => { const els = [...document.querySelectorAll(%s)]; return { getBoundingClientRect: () => {"
         " const rs = els.map(e => e.getBoundingClientRect()); const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));"
         " const right = Math.max(...rs.map(r => r.right)), bottom = Math.max(...rs.map(r => r.bottom));"
         " return { x, y, width: right - x, height: bottom - y, bottom } } } })()")


def listener(r, link, name, emoji):
    t = r.open_tab(hash_=link)
    setup(t, name, emoji)
    # 聞き役は鍵を持たない（同じブラウザなので主の鍵が見えてしまう。主は鍵を読み込み済みなので消してよい）
    t.eval("localStorage.removeItem('pot-call-bcast')")
    t.call('Page.reload'); time.sleep(0.8); persona(t, name, emoji)
    t.eval("localStorage.removeItem('pot-call-bcast')")
    t.wait_for("document.getElementById('entryText').textContent.includes('🟢')", timeout=90)
    smoke.click_join(t)
    return t


def main():
    a = argparse.Namespace(url='http://localhost:8010/', port=9334, web_port=8010,
        tag='shotsbc' + ''.join(random.choice(string.ascii_lowercase) for _ in range(4)),
        no_serve=False, headful=False, real_autoplay=False, keep=False, only=None)
    r = smoke.Runner(a); srv = r.start_server(); r.start_chrome()
    try:
        O = r.open_tab(); setup(O, 'はるか', '🦉')
        assert smoke.make_bcast(r, O, '夜のラジオ'), 'bcast'
        assert O.wait_for("location.hash.includes('~pk~')", timeout=60), 'owner join'
        link = O.eval('location.hash')
        # 主が「🙋 通話希望者募集」をオン
        smoke.show_tab(O, 'settings')
        O.wait_for("!document.getElementById('reqOpenRow').hidden", timeout=15)
        O.eval("(() => { const c = document.getElementById('reqOpen'); if (!c.checked) c.click() })()")
        smoke.show_tab(O, 'members')
        # 聞き役 3 人（1 人が通話希望を出す）
        L1 = listener(r, link, 'さくら', '🌸')
        L2 = listener(r, link, 'みどり', '🐱')
        L3 = listener(r, link, 'そら', '🐧')
        for t in (L1, L2, L3):
            assert t.wait_for("document.getElementById('state').textContent.includes('通話中')", timeout=60), 'listener join'
        assert L1.wait_for("!document.getElementById('raise').hidden", timeout=40), 'raise shown'
        time.sleep(2)
        L2.call('Page.bringToFront'); time.sleep(0.5)
        L2.eval("window.scrollTo(0, 0)")
        shot(L2, '13-bc-listener', "document.getElementById('statusCard')")          # 聞き役：主と「ほか N 人」・通話希望
        L1.eval("document.getElementById('raise').click()")
        assert O.wait_for("[...document.querySelectorAll('#members .m-bc')].some(e => e.textContent === '🙋')", timeout=20), '🙋'
        O.wait_for("!!document.getElementById('membersMore')", timeout=20)
        time.sleep(1)
        shot(O, '12-bc-owner', UNION % "'#members > *'")                 # 主：📣・🙋・ほか N 人
        # 部屋に入っていない人の一覧から、配信部屋をタップ → 🤫 静かに入る
        V = r.open_tab(); setup(V, 'ゆき', '🐰')
        assert V.wait_for("[...document.querySelectorAll('#lobbyList .room')].some(b => b.textContent.includes('夜のラジオ'))", timeout=60), 'lobby'
        V.eval("[...document.querySelectorAll('#lobbyList .room')].find(b => b.textContent.includes('夜のラジオ')).click()")
        assert V.wait_for("!!document.getElementById('roomAskQuiet')", timeout=10), 'ask'
        V.eval("document.getElementById('roomAskQuiet').click()"); time.sleep(0.3)
        shot(V, '14-bc-quiet', "(() => { const a = document.getElementById('roomAsk'); const p = a.previousElementSibling; const w = document.createElement('div'); return { getBoundingClientRect: () => { const r1 = p.getBoundingClientRect(), r2 = a.getBoundingClientRect(); return { x: Math.min(r1.x, r2.x), y: r1.y, width: Math.max(r1.right, r2.right) - Math.min(r1.x, r2.x), height: r2.bottom - r1.y, bottom: r2.bottom } } } })()")
        print('done')
    finally:
        r.cleanup()
        if srv: srv.terminate()


if __name__ == '__main__':
    main()
