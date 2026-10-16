# SPEC — hari-pi

## 1. 針でπ (`hari-pi`) — カメラ×確率
- **一行**: 床の板目の上に爪楊枝をばらまいて撮ると、線をまたいだ本数から円周率を推定する(ビュフォンの針)。
- **核**: 「ばらまいた爪楊枝の写真から π が出てくる」という手品感。撮るたびに推定値と**95%信頼区間**が更新され、本数を増やすほど区間が縮むのが目で見える。
- **正直さ**: 区間を必ず併記し、本数が少ないときは「まだπとは言えない」と言い切る。検出に自信のない針は数えず、除外数も表示。
- **技術**: Vite+素のJS / getUserMedia + Canvas2D / 自前の線分検出(Sobel→確率的Hough) / 板目の間隔は2点タップで手動校正。src/lib 純粋関数(推定量・区間・交差判定)を Vitest。
- **公開**: Vercel
- **難所**: 爪楊枝の線分検出の頑健さ(影・重なり)。→ 検出失敗時は手動で針の両端をタップ補正できる逃げ道を用意。

---

# 共通ルール(アプリ20本量産フェーズ)

- **規模**: 1〜2日で「公開まで」行ける範囲に絞る。上の仕様で一点突破し、機能を足さない。
- **作風**: 一点突破のコンセプト / ブラウザ内で完結(サーバ不要) / カメラ・センサー・数理を使った遊び心 / 「正直さ」を設計で守る(測れないときは測れないと言う、根拠と誤差を見せる) / 純粋ロジック+テスト。
- **構成(Webアプリ)**: Vite + 素のJS + pnpm。中核ロジックは `src/lib/` の純粋関数にして Vitest で固くテストし、配線・描画と分ける。`window.__app` を公開して、ヘッドレスでも検証できるようにする。
- **カメラ/マイク/センサー**: 実機がなくても検証できるよう、合成データやデモ入力で動くモードを用意する。
- **ポート**: 下に指定した番号を `strictPort` で固定する(既存アプリとの衝突回避)。
- **参考になる既存作**: `~/ranzo_project/` 配下(例: takibiban, otomon, uchikeshi, sokomi, shikisougi)。品質の基準はこれらに合わせる。
- **公開**: GitHub(public) `Jinshin2534/<slug>` を gh で作成して push。Webアプリは Vercel に GitHub 連携でデプロイする(push で自動デプロイ)。Vercel 向きでないもの(CLI等)は簡素なLPを GitHub Pages で公開する。
- **完了時**: 公開URLを確かめたうえで、メモリ `/Users/nokokoro/.claude/projects/-Users-nokokoro-ranzo-project/memory/` に `<slug>.md` を追加し、`MEMORY.md` に既存の行と同じ形式で1行追記する(公開URL・port・テスト数・ハマりどころ)。
- **コミット**: 末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` をつける。
- **仕様は確定済み**。細部は自分で判断して進め、ユーザーに聞くのは本当に決められないときだけにする。
- **このアプリのポート**: 5830
- **slug**: `hari-pi`

# リポジトリ構成と公開手順

- このワークツリーは `app-ideas` リポジトリのブランチ `hari-pi`。アプリはこのワークツリー直下に作る。
- main から引き継いだ `README.md` はこのアプリ用に書き換え、`IDEAS.md` は削除してよい(main 側には影響しない)。
- 公開用の GitHub リポジトリはアプリごとに別に作る:
  1. `gh repo create Jinshin2534/hari-pi --public`
  2. `git remote add hari-pi https://github.com/Jinshin2534/hari-pi.git`
  3. `git push hari-pi HEAD:main`(以後の更新も `git push hari-pi HEAD:main`)
- `app-ideas` 自体には push しない。リモート名はアプリの slug にして、ほかのアプリのリモートと混ぜない。
- Vercel は GitHub の `Jinshin2534/hari-pi` を連携し、main への push で自動デプロイされるようにする。
